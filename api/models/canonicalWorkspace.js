const { logger } = require('@librechat/data-schemas');
const { callStaraApi, getUserId, safeString } = require('~/server/services/StaraServiceClient');
const { canonicalAgentId, libreChatAgentId } = require('./canonicalAgents');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LIST_LIMIT = 100;
const DEFAULT_ENDPOINT = 'Stara Gateway';

const workspaceEnabled = () =>
  ['1', 'true', 'yes', 'on'].includes(
    String(process.env.STARA_CANONICAL_WORKSPACE ?? '')
      .trim()
      .toLowerCase(),
  );

const createCanonicalWorkspaceMethods = (baseMethods) => {
  if (!workspaceEnabled()) {
    return {};
  }

  const loadUser = async (userId) => {
    if (!userId) {
      throw new Error('User not authenticated');
    }
    const user = await baseMethods.getUserById(
      userId,
      '_id id email username name tenantId idOnTheSource emailVerified twoFactorEnabled',
    );
    if (!user) {
      const error = new Error('Authenticated user was not found');
      error.status = 401;
      throw error;
    }
    return { ...user, _id: user._id, id: user.id ?? user._id?.toString() ?? userId };
  };

  const request = (user, path, options = {}) =>
    callStaraApi(user, path, { ...options, tenantId: user.tenantId });

  const getCanonicalConversation = async (user, conversationId) => {
    const response = await request(user, `/v1/conversations/${encodeURIComponent(conversationId)}`);
    return response.conversation;
  };

  const ensureConversation = async (user, conversationId, title = 'New Chat') => {
    try {
      return await getCanonicalConversation(user, conversationId);
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
    }
    const response = await request(user, '/v1/conversations', {
      method: 'POST',
      body: {
        conversation_id: conversationId,
        title: boundedTitle(title),
        metadata: {},
      },
    });
    return response.conversation;
  };

  const saveConvo = async ({ userId }, data, metadata = {}) => {
    const conversationId = data.newConversationId ?? data.conversationId;
    requireUuid(conversationId, 'conversationId');
    const user = await loadUser(userId);
    const existing = await getCanonicalConversation(user, conversationId);
    const patch = conversationPatch(data);
    let conversation = existing;
    if (Object.keys(patch).length > 0) {
      const response = await request(
        user,
        `/v1/conversations/${encodeURIComponent(conversationId)}`,
        { method: 'PATCH', body: patch },
      );
      conversation = response.conversation;
    }
    if (metadata.context) {
      logger.debug(`[canonicalWorkspace.saveConvo] ${metadata.context}`);
    }
    return mapConversation(conversation, user);
  };

  const saveMessage = async ({ userId }, params, metadata = {}) => {
    const conversationId = params.conversationId;
    const messageId = params.newMessageId ?? params.messageId;
    requireUuid(conversationId, 'conversationId');
    requireUuid(messageId, 'messageId');
    const user = await loadUser(userId);
    await ensureConversation(user, conversationId);
    const body = appendMessageBody(params, messageId);
    let canonical;
    try {
      canonical = (
        await request(user, `/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
          method: 'POST',
          body,
        })
      ).message;
    } catch (error) {
      if (error.status !== 409 || error.code !== 'idempotency_conflict') {
        throw error;
      }
      canonical = (
        await request(
          user,
          `/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
          { method: 'PATCH', body: amendmentBody(params) },
        )
      ).message;
    }
    if (metadata.context) {
      logger.debug(`[canonicalWorkspace.saveMessage] ${metadata.context}`);
    }
    return mapMessage(canonical, user);
  };

  const getConvo = async (userId, conversationId) => {
    try {
      const user = await loadUser(userId);
      return mapConversation(await getCanonicalConversation(user, conversationId), user);
    } catch (error) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  };

  const getConvosByCursor = async (userId, options = {}) => {
    const user = await loadUser(userId);
    let conversations = await listCanonicalConversations(user);
    const archived = Boolean(options.isArchived);
    conversations = conversations.filter((conversation) =>
      archived ? conversation.status === 'archived' : conversation.status === 'active',
    );
    if (options.search) {
      const search = await request(
        user,
        `/v1/search?q=${encodeURIComponent(options.search)}&limit=${MAX_LIST_LIMIT}`,
      );
      const matchingIds = new Set(
        (search.results ?? []).map((result) => result.conversation_id).filter(Boolean),
      );
      conversations = conversations.filter((conversation) => matchingIds.has(conversation.id));
    }
    if ((options.tags?.length ?? 0) > 0 || options.projectId) {
      conversations = [];
    }
    conversations.sort(conversationComparator(options.sortBy, options.sortDirection));
    conversations = filterConversationsAfterCursor(conversations, options);
    const limit = Math.min(options.limit ?? 25, MAX_LIST_LIMIT);
    const page = conversations.slice(0, limit + 1);
    const hasMore = page.length > limit;
    if (hasMore) {
      page.pop();
    }
    return {
      conversations: page.map((conversation) => mapConversation(conversation, user)),
      nextCursor: hasMore ? conversationCursor(page.at(-1), options.sortBy) : null,
    };
  };

  const getMessages = async (filter, _select, options = {}) => {
    const user = await loadUser(filter.user);
    let canonical = [];
    if (typeof filter.conversationId === 'string') {
      canonical = await listCanonicalMessages(user, filter.conversationId);
    } else if (filter.messageId) {
      canonical = await getCanonicalMessagesById(user, messageIdsFromFilter(filter.messageId));
    }
    canonical = filterCanonicalMessages(canonical, filter.messageId);
    const mapped = canonical.map((message) => mapMessage(message, user));
    const sorted = sortMessages(mapped, options.sort);
    return options.limit != null && options.limit > 0 ? sorted.slice(0, options.limit) : sorted;
  };

  const getMessage = async ({ user: userId, messageId }) => {
    const user = await loadUser(userId);
    try {
      return mapMessage(await getCanonicalMessageById(user, messageId), user);
    } catch (error) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  };

  const getMessagesByCursor = async (filter, options = {}) => {
    const sortField = options.sortField ?? 'createdAt';
    const sortOrder = options.sortOrder ?? -1;
    let messages = await getMessages(filter, undefined, {
      sort: { [sortField]: sortOrder },
    });
    if (options.cursor) {
      messages = filterMessagesAfterCursor(messages, options.cursor, sortField, sortOrder);
    }
    const limit = options.limit ?? 25;
    const page = messages.slice(0, limit + 1);
    const hasMore = page.length > limit;
    if (hasMore) {
      page.pop();
    }
    return {
      messages: page,
      nextCursor: hasMore ? messageCursor(page.at(-1), sortField) : null,
    };
  };

  const updateMessage = async (userId, message, metadata = {}) => {
    const user = await loadUser(userId);
    const messageId = message.messageId;
    requireUuid(messageId, 'messageId');
    const existingById = message.conversationId
      ? null
      : await getCanonicalMessageById(user, messageId);
    const conversationId = message.conversationId ?? existingById?.conversation_id;
    if (!conversationId) {
      throw new Error('Message not found or user not authorized.');
    }
    const existing = existingById ?? (await getCanonicalMessage(user, conversationId, messageId));
    const response = await request(
      user,
      `/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
      { method: 'PATCH', body: amendmentBody(message, existing) },
    );
    if (metadata.context) {
      logger.debug(`[canonicalWorkspace.updateMessage] ${metadata.context}`);
    }
    return mapMessage(response.message, user);
  };

  const updateMessageText = async (userId, params) => {
    await updateMessage(userId, params);
  };

  const deleteMessages = async (filter) => {
    const user = await loadUser(filter.user);
    const targets = [];
    if (filter.messageId && typeof filter.conversationId === 'string') {
      for (const messageId of messageIdsFromFilter(filter.messageId)) {
        targets.push({ conversationId: filter.conversationId, messageId });
      }
    } else if (typeof filter.conversationId === 'string') {
      const messages = await listCanonicalMessages(user, filter.conversationId);
      targets.push(
        ...messages.map((message) => ({
          conversationId: filter.conversationId,
          messageId: message.id,
        })),
      );
    } else if (filter.messageId) {
      const messages = await getCanonicalMessagesById(user, messageIdsFromFilter(filter.messageId));
      targets.push(
        ...messages.map((message) => ({
          conversationId: message.conversation_id,
          messageId: message.id,
        })),
      );
    }
    let deletedCount = 0;
    for (const target of targets) {
      try {
        await request(
          user,
          `/v1/conversations/${encodeURIComponent(target.conversationId)}/messages/${encodeURIComponent(target.messageId)}`,
          { method: 'DELETE' },
        );
        deletedCount += 1;
      } catch (error) {
        if (error.status !== 404) {
          throw error;
        }
      }
    }
    return { acknowledged: true, deletedCount };
  };

  const deleteMessagesSince = async (userId, { messageId, conversationId }) => {
    const messages = await getMessages({ user: userId, conversationId });
    const index = messages.findIndex((message) => message.messageId === messageId);
    if (index < 0) {
      return { acknowledged: true, deletedCount: 0 };
    }
    return deleteMessages({
      user: userId,
      conversationId,
      messageId: { $in: messages.slice(index + 1).map((message) => message.messageId) },
    });
  };

  const deleteConvos = async (userId, filter = {}) => {
    const user = await loadUser(userId);
    let ids = [];
    if (typeof filter.conversationId === 'string') {
      ids = [filter.conversationId];
    } else if (Object.keys(filter).length === 0) {
      ids = (await listCanonicalConversations(user)).map((conversation) => conversation.id);
    }
    const deletedIds = [];
    for (const conversationId of ids) {
      try {
        await request(user, `/v1/conversations/${encodeURIComponent(conversationId)}`, {
          method: 'DELETE',
        });
        deletedIds.push(conversationId);
      } catch (error) {
        if (error.status !== 404) {
          throw error;
        }
      }
    }
    return {
      acknowledged: true,
      deletedCount: deletedIds.length,
      conversationIds: deletedIds,
      messages: { acknowledged: true, deletedCount: 0 },
    };
  };

  const searchMessages = async (query, searchOptions = {}) => {
    const userId = searchOptions.filter?.match?.(/user\s*=\s*"([^"]+)"/)?.[1];
    if (!userId) {
      return { hits: [] };
    }
    const user = await loadUser(userId);
    const response = await request(
      user,
      `/v1/search?q=${encodeURIComponent(query)}&limit=${MAX_LIST_LIMIT}`,
    );
    const messageIds = (response.results ?? [])
      .filter((result) => result.resource_type === 'message')
      .map((result) => result.resource_id);
    const messages = await getCanonicalMessagesById(user, messageIds);
    return { hits: messages.map((message) => mapMessage(message, user)) };
  };

  const getConvosQueried = async (userId, convoIds) => {
    const user = await loadUser(userId);
    const ids = [...new Set((convoIds ?? []).map((item) => item.conversationId).filter(Boolean))];
    const conversations = [];
    for (const conversationId of ids) {
      try {
        conversations.push(
          mapConversation(await getCanonicalConversation(user, conversationId), user),
        );
      } catch (error) {
        if (error.status !== 404) {
          throw error;
        }
      }
    }
    return {
      conversations,
      nextCursor: null,
      convoMap: Object.fromEntries(
        conversations.map((conversation) => [conversation.conversationId, conversation]),
      ),
    };
  };

  return {
    saveConvo,
    getConvo,
    getConvosByCursor,
    getConvosQueried,
    getConvoTitle: async (userId, conversationId) =>
      (await getConvo(userId, conversationId))?.title ?? null,
    getConvoRetention: async () => null,
    getConvoFiles: async () => [],
    deleteConvos,
    saveMessage,
    recordMessage: async (params) => saveMessage({ userId: params.user }, params),
    getMessages,
    getMessage,
    getMessagesByCursor,
    updateMessage,
    updateMessageText,
    deleteMessages,
    deleteMessagesSince,
    searchMessages,
  };
};

const conversationPatch = (data) => {
  const patch = {};
  if (typeof data.title === 'string' && data.title.trim()) {
    patch.title = boundedTitle(data.title);
  }
  if (typeof data.isArchived === 'boolean') {
    patch.status = data.isArchived ? 'archived' : 'active';
  }
  if (typeof data.pinned === 'boolean') {
    patch.metadata = { pinned: data.pinned };
  }
  if (data.agent_id === null) {
    patch.agent_id = null;
  } else if (canonicalAgentId(data.agent_id)) {
    patch.agent_id = canonicalAgentId(data.agent_id);
  }
  const route = safeString(data.model, undefined, 200);
  if (route) {
    patch.model_route = route;
  }
  return patch;
};

const appendMessageBody = (params, messageId) => ({
  message_id: messageId,
  ...(UUID_PATTERN.test(params.parentMessageId ?? '')
    ? { parent_message_id: params.parentMessageId }
    : {}),
  role: messageRole(params),
  content: messageContent(params),
  status: messageStatus(params),
  ...(safeString(params.model, undefined, 200) ? { model_route: params.model } : {}),
  token_usage: tokenUsage(params),
  metadata: messageMetadata(params),
});

const amendmentBody = (params, existing = null) => {
  const body = {};
  if (typeof params.text === 'string' || Array.isArray(params.content)) {
    body.content = messageContent(params);
  }
  if (params.error === true) {
    body.status = 'failed';
  } else if (params.unfinished === true) {
    body.status = 'streaming';
  } else if (params.unfinished === false || params.error === false) {
    body.status = 'complete';
  }
  if (Object.prototype.hasOwnProperty.call(params, 'model')) {
    body.model_route = safeString(params.model, null, 200);
  }
  if (
    params.tokenCount != null ||
    params.promptTokens != null ||
    params.summaryTokenCount != null
  ) {
    body.token_usage = tokenUsage(params);
  }
  const metadata = messageMetadata(params, existing?.metadata?.librechat);
  if (Object.keys(metadata.librechat).length > 0) {
    body.metadata = metadata;
  }
  return body;
};

const messageRole = (params) => {
  if (params.isCreatedByUser === true) {
    return 'user';
  }
  if (params.endpoint === 'tools' || params.sender === 'Tool') {
    return 'tool';
  }
  if (params.sender === 'System') {
    return 'system';
  }
  return 'assistant';
};

const messageStatus = (params) => {
  if (params.error) {
    return 'failed';
  }
  if (params.unfinished) {
    return 'streaming';
  }
  return 'complete';
};

const messageContent = (params) => {
  if (Array.isArray(params.content) && params.content.length > 0) {
    return params.content.map((part) =>
      part && typeof part === 'object' && safeString(part.type)
        ? part
        : { type: 'text', text: String(part ?? '') },
    );
  }
  return [{ type: 'text', text: typeof params.text === 'string' ? params.text : '' }];
};

const tokenUsage = (params) => ({
  ...(finiteNumber(params.tokenCount) ? { client_token_count: params.tokenCount } : {}),
  ...(finiteNumber(params.promptTokens) ? { input_tokens: params.promptTokens } : {}),
  ...(finiteNumber(params.summaryTokenCount)
    ? { summary_token_count: params.summaryTokenCount }
    : {}),
});

const MESSAGE_METADATA_FIELDS = [
  'sender',
  'endpoint',
  'iconURL',
  'finish_reason',
  'feedback',
  'files',
  'attachments',
  'manualSkills',
  'alwaysAppliedSkills',
  'quotes',
  'contextMeta',
  'plugin',
  'plugins',
  'thread_id',
  'isEdited',
];

const messageMetadata = (params, existing = {}) => {
  const librechat = { ...existing };
  for (const key of MESSAGE_METADATA_FIELDS) {
    if (params[key] !== undefined) {
      librechat[key] = params[key];
    }
  }
  if (Array.isArray(params.content)) {
    librechat.hasContent = true;
  }
  return { librechat };
};

const mapConversation = (conversation, user) => ({
  conversationId: conversation.id,
  user: getUserId(user),
  title: conversation.title,
  endpoint: process.env.STARA_CANONICAL_ENDPOINT ?? DEFAULT_ENDPOINT,
  endpointType: 'custom',
  model: conversation.model_route ?? undefined,
  agent_id: conversation.agent_id ? libreChatAgentId(conversation.agent_id) : undefined,
  isArchived: conversation.status === 'archived',
  pinned: Boolean(conversation.metadata?.pinned),
  createdAt: conversation.created_at,
  updatedAt: conversation.updated_at,
});

const mapMessage = (message, user) => {
  const compatibility = message.metadata?.librechat ?? {};
  const { hasContent, ...fields } = compatibility;
  const text = message.content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('');
  return {
    ...fields,
    messageId: message.id,
    conversationId: message.conversation_id,
    parentMessageId: message.parent_message_id,
    user: getUserId(user),
    isCreatedByUser: message.role === 'user',
    sender: fields.sender ?? (message.role === 'user' ? (user.name ?? 'User') : 'Assistant'),
    endpoint: fields.endpoint ?? process.env.STARA_CANONICAL_ENDPOINT ?? DEFAULT_ENDPOINT,
    model: message.model_route ?? undefined,
    text,
    ...(hasContent ? { content: message.content } : {}),
    tokenCount: message.token_usage?.client_token_count,
    summaryTokenCount: message.token_usage?.summary_token_count,
    unfinished: message.status === 'pending' || message.status === 'streaming',
    error: message.status === 'failed',
    createdAt: message.created_at,
    updatedAt: message.updated_at,
  };
};

const getCanonicalMessage = async (user, conversationId, messageId) =>
  (
    await callStaraApi(
      user,
      `/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
      { tenantId: user.tenantId },
    )
  ).message;

const getCanonicalMessageById = async (user, messageId) =>
  (
    await callStaraApi(user, `/v1/messages/${encodeURIComponent(messageId)}`, {
      tenantId: user.tenantId,
    })
  ).message;

const getCanonicalMessagesById = async (user, messageIds) => {
  const messages = await Promise.all(
    [...new Set(messageIds)].map(async (messageId) => {
      try {
        return await getCanonicalMessageById(user, messageId);
      } catch (error) {
        if (error.status === 404) {
          return null;
        }
        throw error;
      }
    }),
  );
  return messages.filter(Boolean);
};

const listCanonicalConversations = (user) =>
  collectCanonicalPages(user, '/v1/conversations', 'conversations');

const listCanonicalMessages = (user, conversationId) =>
  collectCanonicalPages(
    user,
    `/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
    'messages',
  );

const collectCanonicalPages = async (user, path, resourceKey) => {
  const resources = [];
  const seenCursors = new Set();
  let cursor = null;
  do {
    const query = new URLSearchParams({ limit: String(MAX_LIST_LIMIT) });
    if (cursor) {
      query.set('cursor', cursor);
    }
    const response = await callStaraApi(user, `${path}?${query}`, {
      tenantId: user.tenantId,
    });
    resources.push(...(response[resourceKey] ?? []));
    cursor = response.next_cursor ?? null;
    if (cursor && seenCursors.has(cursor)) {
      throw new Error(`The Stara API repeated a ${resourceKey} cursor`);
    }
    if (cursor) {
      seenCursors.add(cursor);
    }
  } while (cursor);
  return resources;
};

const messageIdsFromFilter = (messageId) => {
  if (typeof messageId === 'string') {
    return [messageId];
  }
  return Array.isArray(messageId?.$in) ? messageId.$in : [];
};

const filterCanonicalMessages = (messages, messageId) => {
  const ids = messageIdsFromFilter(messageId);
  return ids.length > 0 ? messages.filter((message) => ids.includes(message.id)) : messages;
};

const sortMessages = (messages, sort) => {
  if (sort === false) {
    return messages;
  }
  const [field, direction] = Object.entries(sort ?? { createdAt: 1 })[0];
  return [...messages].sort((left, right) => {
    const multiplier = direction === -1 ? -1 : 1;
    const primary =
      String(left[field] ?? '').localeCompare(String(right[field] ?? '')) * multiplier;
    return primary || left.messageId.localeCompare(right.messageId) * multiplier;
  });
};

const conversationComparator = (sortBy = 'updatedAt', sortDirection = 'desc') => {
  let field = 'updated_at';
  if (sortBy === 'title') {
    field = 'title';
  } else if (sortBy === 'createdAt') {
    field = 'created_at';
  }
  const direction = sortDirection === 'asc' ? 1 : -1;
  return (left, right) => {
    const primary = String(left[field] ?? '').localeCompare(String(right[field] ?? '')) * direction;
    const secondary =
      field === 'updated_at'
        ? 0
        : String(left.updated_at ?? '').localeCompare(String(right.updated_at ?? '')) * direction;
    return primary || secondary || left.id.localeCompare(right.id) * direction;
  };
};

const filterConversationsAfterCursor = (conversations, options) => {
  if (!options.cursor) {
    return conversations;
  }
  const decoded = decodeListCursor(options.cursor);
  const sortBy = options.sortBy ?? 'updatedAt';
  const cursorConversation = {
    id: decoded.id,
    title: sortBy === 'title' ? decoded.primary : '',
    created_at: sortBy === 'createdAt' ? decoded.primary : decoded.secondary,
    updated_at: decoded.secondary,
  };
  const compare = conversationComparator(sortBy, options.sortDirection);
  return conversations.filter((conversation) => compare(conversation, cursorConversation) > 0);
};

const conversationCursor = (conversation, sortBy = 'updatedAt') => {
  let primary = conversation.updated_at;
  if (sortBy === 'title') {
    primary = conversation.title;
  } else if (sortBy === 'createdAt') {
    primary = conversation.created_at;
  }
  return encodeListCursor({
    primary: String(primary ?? ''),
    secondary: String(conversation.updated_at ?? ''),
    id: conversation.id,
  });
};

const filterMessagesAfterCursor = (messages, cursor, field, direction) => {
  const decoded = decodeListCursor(cursor, true);
  const multiplier = direction === -1 ? -1 : 1;
  return messages.filter((message) => {
    const primary = String(message[field] ?? '').localeCompare(decoded.primary) * multiplier;
    const secondary = message.messageId.localeCompare(decoded.id) * multiplier;
    return primary > 0 || (primary === 0 && secondary > 0);
  });
};

const messageCursor = (message, field) =>
  encodeListCursor({
    primary: String(message?.[field] ?? ''),
    secondary: '',
    id: message?.messageId ?? '',
  });

const encodeListCursor = (value) => Buffer.from(JSON.stringify(value)).toString('base64');

const decodeListCursor = (cursor, allowLegacyValue = false) => {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString());
    if (
      typeof parsed.primary === 'string' &&
      typeof parsed.secondary === 'string' &&
      typeof parsed.id === 'string'
    ) {
      return parsed;
    }
  } catch {
    if (allowLegacyValue) {
      return { primary: cursor, secondary: '', id: '' };
    }
  }
  throw new Error('Invalid canonical workspace cursor');
};

const boundedTitle = (value) => safeString(value, 'New Chat', 300);
const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const requireUuid = (value, name) => {
  if (!UUID_PATTERN.test(value ?? '')) {
    const error = new Error(`${name} must be a UUID`);
    error.status = 400;
    throw error;
  }
};

module.exports = {
  createCanonicalWorkspaceMethods,
  mapConversation,
  mapMessage,
  workspaceEnabled,
};
