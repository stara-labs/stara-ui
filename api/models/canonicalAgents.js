const { getUserId: getContextUserId } = require('@librechat/data-schemas');
const { PermissionBits } = require('librechat-data-provider');
const { callStaraApi, getUserId, safeString } = require('~/server/services/StaraServiceClient');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const DEFINITION_METADATA_FIELDS = new Set([
  '_id',
  'id',
  'author',
  'createdAt',
  'updatedAt',
  'versions',
  'version',
  'isPublic',
  'mcpServerNames',
  'owner_contact',
  'current_version_id',
  'action_version_id',
]);

const canonicalAgentsEnabled = () => {
  const explicit = process.env.STARA_CANONICAL_AGENTS;
  const value = explicit == null ? process.env.STARA_CANONICAL_WORKSPACE : explicit;
  return TRUE_VALUES.has(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );
};

const createCanonicalAgentMethods = (baseMethods) => {
  if (!canonicalAgentsEnabled()) {
    return {};
  }

  const withActor = async (callback) => {
    // Mongo remains the auth profile directory; all agent state is loaded from Stara API.
    const user = await loadCurrentUser(baseMethods);
    const me = await request(user, '/v1/me');
    return callback(user, me.user);
  };

  const getCanonical = async (user, id) => {
    const canonicalId = canonicalAgentId(id);
    if (!canonicalId) {
      return null;
    }
    try {
      return (await request(user, `/v1/agents/${encodeURIComponent(canonicalId)}`)).agent;
    } catch (error) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  };

  const getAgent = async (searchParameter = {}) =>
    withActor(async (user, actor) => {
      const canonical = await getCanonical(user, agentIdFromSearch(searchParameter));
      return canonical ? mapCanonicalAgent(canonical, user, actor.id) : null;
    });

  const getAgentWithVersionCount = async (searchParameter = {}) => getAgent(searchParameter);

  const createAgent = async (agentData) =>
    withActor(async (user, actor) => {
      const response = await request(user, '/v1/agents', {
        method: 'POST',
        body: canonicalMutationBody(agentData, true, true),
      });
      return mapCanonicalAgent(response.agent, user, actor.id);
    });

  const updateAgent = async (searchParameter, updateData) =>
    withActor(async (user, actor) => {
      const id = canonicalAgentId(agentIdFromSearch(searchParameter));
      if (!id) return null;
      const canonical = await getCanonical(user, id);
      if (!canonical) {
        return null;
      }
      const current = mapCanonicalAgent(canonical, user, actor.id);
      const next = applyAgentUpdate(current, updateData);
      const response = await request(user, `/v1/agents/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: canonicalMutationBody(next, canonical.status === 'active'),
      });
      return mapCanonicalAgent(response.agent, user, actor.id);
    });

  const deleteAgent = async (searchParameter = {}) =>
    withActor(async (user, actor) => {
      const id = canonicalAgentId(agentIdFromSearch(searchParameter));
      if (!id) return null;
      const canonical = await getCanonical(user, id);
      if (!canonical) {
        return null;
      }
      await request(user, `/v1/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return mapCanonicalAgent(canonical, user, actor.id);
    });

  const getAgentVersions = async (searchParameter = {}) =>
    withActor(async (user, actor) => {
      const id = canonicalAgentId(agentIdFromSearch(searchParameter));
      if (!id) return null;
      const canonical = await getCanonical(user, id);
      if (!canonical) {
        return null;
      }
      const response = await request(user, `/v1/agents/${encodeURIComponent(id)}/versions`);
      return (response.versions ?? []).map((version) =>
        mapCanonicalVersion(version, canonical, user, actor.id),
      );
    });

  const revertAgentVersion = async (searchParameter = {}, versionIndex) =>
    withActor(async (user, actor) => {
      const id = canonicalAgentId(agentIdFromSearch(searchParameter));
      if (!id) throw new Error('Agent not found');
      const canonical = await getCanonical(user, id);
      if (!canonical) {
        throw new Error('Agent not found');
      }
      const response = await request(user, `/v1/agents/${encodeURIComponent(id)}/versions`);
      const version = response.versions?.[versionIndex];
      if (!version) {
        throw new Error(`Version ${versionIndex} not found`);
      }
      const snapshot = mapCanonicalVersion(version, canonical, user, actor.id);
      const updated = await request(user, `/v1/agents/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: canonicalMutationBody(snapshot, canonical.status === 'active'),
      });
      return mapCanonicalAgent(updated.agent, user, actor.id);
    });

  const getAgents = async (searchParameter = {}) =>
    withActor(async (user, actor) => {
      const response = await request(user, '/v1/agents');
      return (response.agents ?? [])
        .map((agent) => mapCanonicalAgent(agent, user, actor.id))
        .filter((agent) => matchesSearch(agent, searchParameter));
    });

  const getListAgentsByAccess = async ({
    otherParams = {},
    limit,
    after,
    includeSkillConfig = false,
    requiredPermission = PermissionBits.VIEW,
  } = {}) =>
    withActor(async (user, actor) => {
      const response = await request(user, '/v1/agents');
      let agents = (response.agents ?? []).map((agent) => mapCanonicalAgent(agent, user, actor.id));
      agents = agents.filter((agent) => matchesSearch(agent, otherParams));
      if (requiredPermission !== PermissionBits.VIEW) {
        const checked = await Promise.all(
          agents.map(async (agent) => ({
            agent,
            allowed: await hasCanonicalAgentPermission(user, agent.id, requiredPermission),
          })),
        );
        agents = checked.filter(({ allowed }) => allowed).map(({ agent }) => agent);
      }
      agents.sort(agentComparator);
      agents = filterAgentsAfterCursor(agents, after);
      const normalizedLimit = normalizeLimit(limit);
      const page = normalizedLimit == null ? agents : agents.slice(0, normalizedLimit + 1);
      const hasMore = normalizedLimit != null && page.length > normalizedLimit;
      const data = hasMore ? page.slice(0, normalizedLimit) : page;
      if (!includeSkillConfig) {
        data.forEach((agent) => {
          delete agent.skills;
          delete agent.skills_enabled;
        });
      }
      return {
        object: 'list',
        data,
        first_id: data[0]?.id ?? null,
        last_id: data.at(-1)?.id ?? null,
        has_more: hasMore,
        after: hasMore ? encodeAgentCursor(data.at(-1)) : null,
      };
    });

  const addAgentResourceFile = async ({ agent_id, tool_resource, file_id }) => {
    const agent = await getAgent({ id: agent_id });
    if (!agent) {
      throw new Error('Agent not found for adding resource file');
    }
    const resources = structuredClone(agent.tool_resources ?? {});
    const resource = resources[tool_resource] ?? {};
    resource.file_ids = [...new Set([...(resource.file_ids ?? []), file_id])];
    resources[tool_resource] = resource;
    return updateAgent(
      { id: agent_id },
      { tool_resources: resources, tools: [...new Set([...(agent.tools ?? []), tool_resource])] },
    );
  };

  const removeAgentResourceFiles = async ({ agent_id, files }) => {
    const agent = await getAgent({ id: agent_id });
    if (!agent) {
      throw new Error('Agent not found for removing resource files');
    }
    const resources = structuredClone(agent.tool_resources ?? {});
    for (const { tool_resource, file_id } of files) {
      const resource = resources[tool_resource];
      if (resource?.file_ids) {
        resource.file_ids = resource.file_ids.filter((id) => id !== file_id);
      }
    }
    return updateAgent({ id: agent_id }, { tool_resources: resources });
  };

  const getCategoriesWithCounts = async () => {
    const agents = await getAgents({});
    const counts = new Map();
    for (const agent of agents) {
      const value = safeString(agent.category, 'general', 100);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([value, agentCount]) => ({
        value,
        label: value === 'general' ? 'General' : value,
        description: '',
        agentCount,
      }));
  };

  return {
    createAgent,
    getAgent,
    getAgentWithVersionCount,
    getAgentVersions,
    getAgents,
    updateAgent,
    deleteAgent,
    revertAgentVersion,
    getListAgentsByAccess,
    addAgentResourceFile,
    removeAgentResourceFiles,
    getCategoriesWithCounts,
    countPromotedAgents: async () => (await getAgents({ is_promoted: true })).length,
    hasAgentWithMCPServerName: async ({ agentIds, serverName }) =>
      (await getAgents({ _id: { $in: agentIds } })).some((agent) =>
        (agent.mcpServerNames ?? []).includes(serverName),
      ),
    getMCPServerNamesByAgentIds: async (agentIds) => [
      ...new Set(
        (await getAgents({ _id: { $in: agentIds } })).flatMap(
          (agent) => agent.mcpServerNames ?? [],
        ),
      ),
    ],
  };
};

const loadCurrentUser = async (baseMethods) => {
  const userId = getContextUserId();
  if (!userId) {
    const error = new Error('User not authenticated');
    error.status = 401;
    throw error;
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
  return { ...user, id: user.id ?? user._id?.toString() ?? userId };
};

const request = (user, path, options = {}) =>
  callStaraApi(user, path, { ...options, tenantId: user.tenantId });

const getCanonicalAgentAccess = async (user, agentId) =>
  (await request(user, `/v1/agents/${encodeURIComponent(requireCanonicalAgentId(agentId))}/access`))
    .access;

const listCanonicalAgentIds = async (user, requiredPermission, invoke = false) => {
  const response = await request(user, '/v1/agents');
  const agents = response.agents ?? [];
  if (requiredPermission === PermissionBits.VIEW && !invoke) {
    return agents.map((agent) => agent.id);
  }
  const checked = await Promise.all(
    agents.map(async (agent) => ({
      id: agent.id,
      allowed: await hasCanonicalAgentPermission(user, agent.id, requiredPermission, invoke),
    })),
  );
  return checked.filter(({ allowed }) => allowed).map(({ id }) => id);
};

const hasCanonicalAgentPermission = async (user, agentId, requiredPermission, invoke = false) => {
  try {
    const access = await getCanonicalAgentAccess(user, agentId);
    return requiredCanonicalPermissions(requiredPermission, invoke).every((permission) =>
      access.permissions.includes(permission),
    );
  } catch (error) {
    if (error.status === 404) {
      return false;
    }
    throw error;
  }
};

const requiredCanonicalPermissions = (requiredPermission, invoke = false) => {
  const permissions = [];
  // LibreChat reuses VIEW for remote execution; canonical policy keeps read and invoke distinct.
  if ((requiredPermission & PermissionBits.VIEW) !== 0) {
    permissions.push(invoke ? 'agent.invoke' : 'agent.read');
  }
  if ((requiredPermission & PermissionBits.EDIT) !== 0) permissions.push('agent.edit');
  if ((requiredPermission & PermissionBits.DELETE) !== 0) permissions.push('agent.delete');
  if ((requiredPermission & PermissionBits.SHARE) !== 0) permissions.push('agent.share');
  return permissions;
};

const canonicalPermissionBits = (access, invoke = false) => {
  let bits = 0;
  if (access.permissions.includes(invoke ? 'agent.invoke' : 'agent.read'))
    bits |= PermissionBits.VIEW;
  if (access.permissions.includes('agent.edit')) bits |= PermissionBits.EDIT;
  if (access.permissions.includes('agent.delete')) bits |= PermissionBits.DELETE;
  if (access.permissions.includes('agent.share')) bits |= PermissionBits.SHARE;
  return bits;
};

const canonicalMutationBody = (agentData, publish, includeId = false) => ({
  ...(includeId && canonicalAgentId(agentData.id)
    ? { agent_id: canonicalAgentId(agentData.id) }
    : {}),
  name: safeString(agentData.name, 'New Agent', 200),
  ...(typeof agentData.description === 'string'
    ? { description: agentData.description.slice(0, 2000) }
    : {}),
  definition: agentDefinition(agentData),
  publish,
});

const agentDefinition = (agentData) => {
  // Normalized execution fields stay queryable; the bounded compatibility object preserves builder UI fidelity.
  const compatibility = {};
  for (const [key, value] of Object.entries(agentData ?? {})) {
    if (
      value !== undefined &&
      !DEFINITION_METADATA_FIELDS.has(key) &&
      ![
        'instructions',
        'provider',
        'model',
        'model_parameters',
        'tools',
        'skills',
        'capabilities',
      ].includes(key)
    ) {
      compatibility[key] = value;
    }
  }
  compatibility.name = safeString(agentData.name, 'New Agent', 200);
  compatibility.description =
    typeof agentData.description === 'string' ? agentData.description.slice(0, 2000) : null;
  return {
    instructions: typeof agentData.instructions === 'string' ? agentData.instructions : '',
    ...(safeString(agentData.provider, undefined, 100)
      ? { provider: safeString(agentData.provider, undefined, 100) }
      : {}),
    ...(safeString(agentData.model, undefined, 200)
      ? { model: safeString(agentData.model, undefined, 200) }
      : {}),
    parameters: plainObject(agentData.model_parameters),
    tool_ids: stringArray(agentData.tools, 100),
    skill_ids: stringArray(agentData.skills, 100),
    capabilities: stringArray(agentData.capabilities, 100),
    compatibility,
  };
};

const mapCanonicalAgent = (agent, user, actorId) => {
  const definition = agent.definition ?? {};
  const compatibility = plainObject(definition.compatibility);
  const tools = stringArray(definition.tool_ids, 100);
  return {
    ...compatibility,
    _id: agent.id,
    id: libreChatAgentId(agent.id),
    author: agent.owner_user_id === actorId ? getUserId(user) : agent.owner_user_id,
    name: agent.name,
    description: agent.description,
    instructions: definition.instructions ?? '',
    provider: definition.provider,
    model: definition.model ?? null,
    model_parameters: plainObject(definition.parameters),
    tools,
    skills: stringArray(definition.skill_ids, 100),
    capabilities: stringArray(definition.capabilities, 100),
    mcpServerNames: mcpServerNames(tools),
    isPublic: false,
    version: agent.version_number,
    createdAt: agent.created_at,
    updatedAt: agent.updated_at,
  };
};

const mapCanonicalVersion = (version, current, user, actorId) => {
  const compatibility = plainObject(version.definition?.compatibility);
  return {
    ...mapCanonicalAgent(
      {
        ...current,
        definition: version.definition,
        version_number: version.version_number,
        updated_at: version.created_at,
      },
      user,
      actorId,
    ),
    _id: version.id,
    id: libreChatAgentId(current.id),
    name: compatibility.name ?? current.name,
    description: compatibility.description ?? current.description,
    createdAt: version.created_at,
    updatedAt: version.created_at,
  };
};

const applyAgentUpdate = (current, updateData = {}) => {
  const next = { ...current };
  for (const [key, value] of Object.entries(updateData)) {
    if (!key.startsWith('$')) {
      next[key] = value;
    }
  }
  for (const [path, value] of Object.entries(updateData.$set ?? {})) {
    setPath(next, path, value);
  }
  return next;
};

const matchesSearch = (agent, search = {}) => {
  for (const [key, expected] of Object.entries(search ?? {})) {
    if (key === '$or') {
      if (!expected.some((condition) => matchesSearch(agent, condition))) return false;
      continue;
    }
    const actual = agent[key];
    if (expected instanceof RegExp) {
      if (!expected.test(String(actual ?? ''))) return false;
    } else if (expected?.$in) {
      const values = expected.$in.map((value) => value?.toString?.() ?? String(value));
      if (!values.includes(actual?.toString?.() ?? String(actual))) return false;
    } else if (expected?.$ne !== undefined) {
      if (actual === expected.$ne) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
};

const agentIdFromSearch = (search = {}) => {
  if (typeof search.id === 'string') return search.id;
  if (typeof search._id === 'string') return search._id;
  return '';
};
const canonicalAgentId = (value) => {
  if (typeof value !== 'string') return null;
  const withoutRuntimeSuffix = value.replace(/____\d+$/, '');
  const candidate = withoutRuntimeSuffix.startsWith('agent_')
    ? withoutRuntimeSuffix.slice('agent_'.length)
    : withoutRuntimeSuffix;
  return UUID_PATTERN.test(candidate) ? candidate : null;
};
const requireCanonicalAgentId = (value) => {
  const id = canonicalAgentId(value);
  if (id) return id;
  const error = new Error('Agent not found');
  error.status = 404;
  throw error;
};
// LibreChat treats IDs without this prefix as ephemeral, while Postgres stores raw UUIDs.
const libreChatAgentId = (value) =>
  typeof value === 'string' && value.startsWith('agent_') ? value : `agent_${value}`;
const stringArray = (value, max) =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, max) : [];
const plainObject = (value) =>
  value != null && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
const mcpServerNames = (tools) => [
  ...new Set(tools.filter((tool) => tool.includes('::')).map((tool) => tool.split('::')[0])),
];
const normalizeLimit = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : null;
};
const agentComparator = (left, right) =>
  String(right.updatedAt).localeCompare(String(left.updatedAt)) || left.id.localeCompare(right.id);
const encodeAgentCursor = (agent) =>
  Buffer.from(JSON.stringify({ updatedAt: agent.updatedAt, id: agent.id })).toString('base64');
const filterAgentsAfterCursor = (agents, cursor) => {
  if (!cursor) return agents;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
    return agents.filter(
      (agent) =>
        String(agent.updatedAt).localeCompare(String(decoded.updatedAt)) < 0 ||
        (String(agent.updatedAt) === String(decoded.updatedAt) && agent.id > decoded.id),
    );
  } catch {
    const error = new Error('Invalid canonical agent cursor');
    error.status = 400;
    throw error;
  }
};
const setPath = (target, path, value) => {
  const segments = path.split('.');
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    cursor[segment] = plainObject(cursor[segment]);
    cursor = cursor[segment];
  }
  cursor[segments.at(-1)] = value;
};

module.exports = {
  canonicalAgentsEnabled,
  canonicalPermissionBits,
  canonicalAgentId,
  createCanonicalAgentMethods,
  getCanonicalAgentAccess,
  hasCanonicalAgentPermission,
  listCanonicalAgentIds,
  libreChatAgentId,
  mapCanonicalAgent,
  requiredCanonicalPermissions,
};
