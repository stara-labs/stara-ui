jest.mock('~/server/services/StaraServiceClient', () => ({
  callStaraApi: jest.fn(),
  getUserId: (user) => user?.id ?? user?._id?.toString(),
  safeString: (value, fallback, maxLength = 512) =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback,
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const { callStaraApi } = require('~/server/services/StaraServiceClient');
const { createCanonicalWorkspaceMethods } = require('./canonicalWorkspace');

const USER_ID = 'user_maya';
const TENANT_ID = 'tenant_acme';
const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';

describe('canonical workspace model adapter', () => {
  const originalEnabled = process.env.STARA_CANONICAL_WORKSPACE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STARA_CANONICAL_WORKSPACE = 'true';
  });

  afterAll(() => restoreEnv('STARA_CANONICAL_WORKSPACE', originalEnabled));

  it('stays inactive until the canonical workspace flag is enabled', () => {
    process.env.STARA_CANONICAL_WORKSPACE = 'false';
    expect(createCanonicalWorkspaceMethods(baseMethods())).toEqual({});
  });

  it('creates the canonical conversation before storing structured messages', async () => {
    callStaraApi.mockImplementation(async (_user, path, options = {}) => {
      if (path === `/v1/conversations/${CONVERSATION_ID}`) {
        throw apiError(404, 'conversation_not_found');
      }
      if (path === '/v1/conversations') {
        return { conversation: canonicalConversation() };
      }
      if (path === `/v1/conversations/${CONVERSATION_ID}/messages`) {
        return {
          message: canonicalMessage({
            content: options.body.content,
            metadata: options.body.metadata,
          }),
        };
      }
      throw new Error(`Unexpected Stara API call: ${options.method ?? 'GET'} ${path}`);
    });
    const methods = createCanonicalWorkspaceMethods(baseMethods());

    const saved = await methods.saveMessage(
      { userId: USER_ID },
      {
        messageId: MESSAGE_ID,
        conversationId: CONVERSATION_ID,
        parentMessageId: '33333333-3333-4333-8333-333333333333',
        isCreatedByUser: false,
        sender: 'Stara',
        endpoint: 'Stara Gateway',
        model: 'secure-model',
        content: [
          { type: 'text', text: 'Governed response' },
          { type: 'tool_call', name: 'check_policy', arguments: { scope: 'finance' } },
        ],
        tokenCount: 12,
      },
    );

    expect(callStaraApi).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tenantId: TENANT_ID }),
      '/v1/conversations',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(callStaraApi).toHaveBeenNthCalledWith(
      3,
      expect.any(Object),
      `/v1/conversations/${CONVERSATION_ID}/messages`,
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          role: 'assistant',
          model_route: 'secure-model',
          token_usage: { client_token_count: 12 },
          content: expect.arrayContaining([
            { type: 'tool_call', name: 'check_policy', arguments: { scope: 'finance' } },
          ]),
        }),
      }),
    );
    expect(saved).toMatchObject({
      messageId: MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      endpoint: 'Stara Gateway',
      model: 'secure-model',
      tokenCount: 12,
      content: [
        { type: 'text', text: 'Governed response' },
        { type: 'tool_call', name: 'check_policy', arguments: { scope: 'finance' } },
      ],
    });
  });

  it('amends an existing canonical message instead of writing a Mongo copy', async () => {
    callStaraApi.mockImplementation(async (_user, path, options = {}) => {
      if (path === `/v1/conversations/${CONVERSATION_ID}`) {
        return { conversation: canonicalConversation() };
      }
      if (path === `/v1/conversations/${CONVERSATION_ID}/messages`) {
        throw apiError(409, 'idempotency_conflict');
      }
      if (path.endsWith(`/messages/${MESSAGE_ID}`) && options.method === 'PATCH') {
        return {
          message: canonicalMessage({
            content: options.body.content,
            token_usage: options.body.token_usage,
            metadata: options.body.metadata,
          }),
        };
      }
      throw new Error(`Unexpected Stara API call: ${options.method ?? 'GET'} ${path}`);
    });
    const legacy = baseMethods();
    const methods = createCanonicalWorkspaceMethods(legacy);

    const saved = await methods.saveMessage(
      { userId: USER_ID },
      {
        messageId: MESSAGE_ID,
        conversationId: CONVERSATION_ID,
        isCreatedByUser: true,
        text: 'Updated user message',
        tokenCount: 8,
      },
    );

    expect(callStaraApi).toHaveBeenLastCalledWith(
      expect.any(Object),
      `/v1/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}`,
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(saved.text).toBe('Updated user message');
    expect(legacy.saveMessage).not.toHaveBeenCalled();
  });

  it('reads, searches, archives, and deletes through canonical routes', async () => {
    callStaraApi.mockImplementation(async (_user, path, options = {}) => {
      if (path === '/v1/conversations?limit=100') {
        return {
          conversations: [
            canonicalConversation(),
            canonicalConversation({
              id: '44444444-4444-4444-8444-444444444444',
              title: 'Archived',
              status: 'archived',
            }),
          ],
        };
      }
      if (path.startsWith('/v1/search?')) {
        return { results: [{ resource_type: 'message', conversation_id: CONVERSATION_ID }] };
      }
      if (path === `/v1/conversations/${CONVERSATION_ID}` && options.method === 'PATCH') {
        return { conversation: canonicalConversation({ status: 'archived' }) };
      }
      if (path === `/v1/conversations/${CONVERSATION_ID}` && options.method === 'DELETE') {
        return {};
      }
      if (path === `/v1/conversations/${CONVERSATION_ID}`) {
        return { conversation: canonicalConversation() };
      }
      throw new Error(`Unexpected Stara API call: ${options.method ?? 'GET'} ${path}`);
    });
    const methods = createCanonicalWorkspaceMethods(baseMethods());

    const listed = await methods.getConvosByCursor(USER_ID, { search: 'release' });
    expect(listed.conversations).toEqual([
      expect.objectContaining({ conversationId: CONVERSATION_ID, endpoint: 'Stara Gateway' }),
    ]);

    const archived = await methods.saveConvo(
      { userId: USER_ID },
      { conversationId: CONVERSATION_ID, isArchived: true },
    );
    expect(archived.isArchived).toBe(true);

    const deleted = await methods.deleteConvos(USER_ID, { conversationId: CONVERSATION_ID });
    expect(deleted).toMatchObject({ deletedCount: 1, conversationIds: [CONVERSATION_ID] });
  });

  it('traverses every canonical API page and rejects a repeated upstream cursor', async () => {
    const secondConversationId = '44444444-4444-4444-8444-444444444444';
    callStaraApi.mockImplementation(async (_user, path) => {
      if (path === '/v1/conversations?limit=100') {
        return {
          conversations: [canonicalConversation()],
          next_cursor: 'api-page-2',
        };
      }
      if (path === '/v1/conversations?limit=100&cursor=api-page-2') {
        return {
          conversations: [
            canonicalConversation({ id: secondConversationId, title: 'Second page' }),
          ],
          next_cursor: null,
        };
      }
      throw new Error(`Unexpected Stara API call: ${path}`);
    });
    const methods = createCanonicalWorkspaceMethods(baseMethods());

    await expect(methods.getConvosByCursor(USER_ID)).resolves.toMatchObject({
      conversations: [
        expect.objectContaining({ conversationId: secondConversationId }),
        expect.objectContaining({ conversationId: CONVERSATION_ID }),
      ],
      nextCursor: null,
    });
    expect(callStaraApi).toHaveBeenCalledWith(
      expect.any(Object),
      '/v1/conversations?limit=100&cursor=api-page-2',
      expect.objectContaining({ tenantId: TENANT_ID }),
    );

    callStaraApi.mockResolvedValue({ conversations: [], next_cursor: 'repeated' });
    await expect(methods.getConvosByCursor(USER_ID)).rejects.toThrow(
      'The Stara API repeated a conversations cursor',
    );
  });

  it('reads and updates by owner-scoped message ID without scanning conversations', async () => {
    callStaraApi.mockImplementation(async (_user, path, options = {}) => {
      if (path === `/v1/messages/${MESSAGE_ID}`) {
        return { message: canonicalMessage() };
      }
      if (
        path === `/v1/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}` &&
        options.method === 'PATCH'
      ) {
        return {
          message: canonicalMessage({
            content: options.body.content,
            metadata: options.body.metadata,
          }),
        };
      }
      throw new Error(`Unexpected Stara API call: ${options.method ?? 'GET'} ${path}`);
    });
    const methods = createCanonicalWorkspaceMethods(baseMethods());

    await expect(
      methods.getMessage({ user: USER_ID, messageId: MESSAGE_ID }),
    ).resolves.toMatchObject({
      messageId: MESSAGE_ID,
      conversationId: CONVERSATION_ID,
    });
    await expect(
      methods.updateMessage(USER_ID, { messageId: MESSAGE_ID, text: 'Updated directly' }),
    ).resolves.toMatchObject({ text: 'Updated directly' });
    expect(callStaraApi.mock.calls.some(([, path]) => path.startsWith('/v1/conversations?'))).toBe(
      false,
    );
  });
});

function baseMethods() {
  return {
    getUserById: jest.fn().mockResolvedValue({
      _id: USER_ID,
      id: USER_ID,
      email: 'maya@example.com',
      name: 'Maya',
      tenantId: TENANT_ID,
      idOnTheSource: 'fixture:user_maya',
      emailVerified: true,
      twoFactorEnabled: true,
    }),
    saveMessage: jest.fn(),
  };
}

function canonicalConversation(overrides = {}) {
  return {
    id: CONVERSATION_ID,
    tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    owner_user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    title: 'Release review',
    status: 'active',
    agent_id: null,
    model_route: 'secure-model',
    metadata: {},
    created_at: '2026-07-12T00:00:00.000Z',
    updated_at: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

function canonicalMessage(overrides = {}) {
  return {
    id: MESSAGE_ID,
    tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    conversation_id: CONVERSATION_ID,
    parent_message_id: '33333333-3333-4333-8333-333333333333',
    author_user_id: null,
    role: 'assistant',
    content: [{ type: 'text', text: 'Governed response' }],
    status: 'complete',
    attempt_of_message_id: null,
    model_route: 'secure-model',
    token_usage: { client_token_count: 12 },
    metadata: { librechat: { hasContent: true, endpoint: 'Stara Gateway' } },
    created_at: '2026-07-12T00:00:00.000Z',
    updated_at: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

function apiError(status, code) {
  const error = new Error(code);
  error.status = status;
  error.code = code;
  return error;
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
