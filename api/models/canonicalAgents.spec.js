jest.mock('@librechat/data-schemas', () => ({
  getUserId: jest.fn(() => 'user_maya'),
}));

jest.mock('~/server/services/StaraServiceClient', () => ({
  callStaraApi: jest.fn(),
  getUserId: (user) => user?.id ?? user?._id?.toString(),
  safeString: (value, fallback, maxLength = 512) =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback,
}));

const { PermissionBits } = require('librechat-data-provider');
const { callStaraApi } = require('~/server/services/StaraServiceClient');
const {
  canonicalAgentsEnabled,
  canonicalPermissionBits,
  createCanonicalAgentMethods,
} = require('./canonicalAgents');

const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const UI_AGENT_ID = `agent_${AGENT_ID}`;
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';

describe('canonical agent model adapter', () => {
  const originalAgents = process.env.STARA_CANONICAL_AGENTS;
  const originalWorkspace = process.env.STARA_CANONICAL_WORKSPACE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STARA_CANONICAL_AGENTS = 'true';
    process.env.STARA_CANONICAL_WORKSPACE = 'true';
  });

  afterAll(() => {
    restoreEnv('STARA_CANONICAL_AGENTS', originalAgents);
    restoreEnv('STARA_CANONICAL_WORKSPACE', originalWorkspace);
  });

  it('supports an explicit flag and otherwise follows canonical workspace mode', () => {
    delete process.env.STARA_CANONICAL_AGENTS;
    expect(canonicalAgentsEnabled()).toBe(true);
    process.env.STARA_CANONICAL_AGENTS = 'false';
    expect(canonicalAgentsEnabled()).toBe(false);
    expect(createCanonicalAgentMethods(baseMethods())).toEqual({});
  });

  it('creates a governed agent while preserving the LibreChat builder contract', async () => {
    mockActorAnd(({ path, options }) => {
      expect(path).toBe('/v1/agents');
      expect(options).toMatchObject({
        method: 'POST',
        body: {
          name: 'Senior Dev',
          publish: true,
          definition: {
            instructions: 'Review changes.',
            provider: 'openAI',
            model: 'gpt-5',
            parameters: { temperature: 0.2 },
            tool_ids: ['memory', 'stara::policy'],
            skill_ids: ['skill_review'],
            compatibility: {
              name: 'Senior Dev',
              description: 'Governed reviewer',
              conversation_starters: ['Review this PR'],
              skills_enabled: true,
            },
          },
        },
      });
      return { agent: canonicalAgent(options.body) };
    });
    const legacy = baseMethods();
    const methods = createCanonicalAgentMethods(legacy);

    const created = await methods.createAgent({
      name: 'Senior Dev',
      description: 'Governed reviewer',
      instructions: 'Review changes.',
      provider: 'openAI',
      model: 'gpt-5',
      model_parameters: { temperature: 0.2 },
      tools: ['memory', 'stara::policy'],
      skills: ['skill_review'],
      skills_enabled: true,
      conversation_starters: ['Review this PR'],
    });

    expect(created).toMatchObject({
      _id: AGENT_ID,
      id: UI_AGENT_ID,
      author: 'user_maya',
      name: 'Senior Dev',
      instructions: 'Review changes.',
      tools: ['memory', 'stara::policy'],
      skills: ['skill_review'],
      skills_enabled: true,
      conversation_starters: ['Review this PR'],
      mcpServerNames: ['stara'],
      version: 1,
    });
    expect(legacy.createAgent).not.toHaveBeenCalled();
  });

  it('merges partial edits and restores history as a new canonical version', async () => {
    let version = 1;
    callStaraApi.mockImplementation(async (_user, path, options = {}) => {
      if (path === '/v1/me') return actorResponse();
      if (path === `/v1/agents/${AGENT_ID}` && !options.method) {
        return { agent: canonicalAgent({ version_number: version }) };
      }
      if (path === `/v1/agents/${AGENT_ID}` && options.method === 'PUT') {
        version += 1;
        return { agent: canonicalAgent(options.body, { version_number: version }) };
      }
      if (path === `/v1/agents/${AGENT_ID}/versions`) {
        return {
          versions: [
            canonicalVersion(2, 'Current instructions.'),
            canonicalVersion(1, 'Initial instructions.', {
              name: 'Initial name',
              conversation_starters: ['Start here'],
            }),
          ],
        };
      }
      throw new Error(`Unexpected API call: ${options.method ?? 'GET'} ${path}`);
    });
    const methods = createCanonicalAgentMethods(baseMethods());

    const updated = await methods.updateAgent(
      { id: UI_AGENT_ID },
      { description: 'Updated description', model_parameters: { temperature: 0.4 } },
    );
    expect(updated).toMatchObject({
      description: 'Updated description',
      instructions: 'Review changes.',
      model_parameters: { temperature: 0.4 },
      version: 2,
    });

    const versions = await methods.getAgentVersions({ id: UI_AGENT_ID });
    expect(versions).toEqual([
      expect.objectContaining({ version: 2, instructions: 'Current instructions.' }),
      expect.objectContaining({
        version: 1,
        name: 'Initial name',
        instructions: 'Initial instructions.',
        conversation_starters: ['Start here'],
      }),
    ]);

    const reverted = await methods.revertAgentVersion({ id: UI_AGENT_ID }, 1);
    expect(reverted).toMatchObject({
      name: 'Initial name',
      instructions: 'Initial instructions.',
      version: 3,
    });
  });

  it('filters edit lists through canonical access and maps invoke separately from read', async () => {
    const otherId = '44444444-4444-4444-8444-444444444444';
    callStaraApi.mockImplementation(async (_user, path) => {
      if (path === '/v1/me') return actorResponse();
      if (path === '/v1/agents') {
        return { agents: [canonicalAgent(), canonicalAgent({}, { id: otherId, name: 'Viewer' })] };
      }
      if (path === `/v1/agents/${AGENT_ID}/access`) return { access: ownerAccess() };
      if (path === `/v1/agents/${otherId}/access`) {
        return {
          access: {
            agent_id: otherId,
            owner: false,
            role_keys: ['viewer'],
            permissions: ['agent.read'],
          },
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    const methods = createCanonicalAgentMethods(baseMethods());

    const list = await methods.getListAgentsByAccess({
      requiredPermission: PermissionBits.EDIT,
      limit: 10,
      includeSkillConfig: true,
    });
    expect(list.data.map((agent) => agent.id)).toEqual([UI_AGENT_ID]);
    expect(canonicalPermissionBits(ownerAccess(), true)).toBe(
      PermissionBits.VIEW | PermissionBits.EDIT | PermissionBits.DELETE | PermissionBits.SHARE,
    );
    expect(
      canonicalPermissionBits(
        { permissions: ['agent.read'], role_keys: ['viewer'], owner: false },
        true,
      ),
    ).toBe(0);
  });
});

function baseMethods() {
  return {
    getUserById: jest.fn().mockResolvedValue({
      _id: 'user_maya',
      id: 'user_maya',
      email: 'maya@example.com',
      name: 'Maya',
      tenantId: 'tenant_acme',
      idOnTheSource: 'fixture:user_maya',
      emailVerified: true,
      twoFactorEnabled: true,
    }),
    createAgent: jest.fn(),
  };
}

function mockActorAnd(handler) {
  callStaraApi.mockImplementation(async (_user, path, options = {}) => {
    if (path === '/v1/me') return actorResponse();
    return handler({ path, options });
  });
}

function actorResponse() {
  return { user: { id: ACTOR_ID } };
}

function canonicalAgent(body = {}, overrides = {}) {
  const definition = body.definition ?? {
    instructions: 'Review changes.',
    provider: 'openAI',
    model: 'gpt-5',
    parameters: { temperature: 0.2 },
    tool_ids: ['memory', 'stara::policy'],
    skill_ids: ['skill_review'],
    capabilities: [],
    compatibility: {
      name: body.name ?? 'Senior Dev',
      description: body.description ?? 'Governed reviewer',
      conversation_starters: ['Review this PR'],
      skills_enabled: true,
    },
  };
  return {
    id: AGENT_ID,
    tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    owner_user_id: ACTOR_ID,
    name: body.name ?? 'Senior Dev',
    description: body.description ?? 'Governed reviewer',
    status: body.publish === false ? 'draft' : 'active',
    current_version_id: VERSION_ID,
    version_number: 1,
    version_status: 'published',
    definition,
    created_at: '2026-07-12T00:00:00.000Z',
    updated_at: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

function canonicalVersion(versionNumber, instructions, compatibility = {}) {
  return {
    id:
      versionNumber === 1
        ? '55555555-5555-4555-8555-555555555555'
        : '66666666-6666-4666-8666-666666666666',
    agent_id: AGENT_ID,
    tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    version_number: versionNumber,
    status: 'published',
    definition: {
      instructions,
      provider: 'openAI',
      model: 'gpt-5',
      parameters: { temperature: 0.2 },
      tool_ids: ['memory'],
      skill_ids: [],
      capabilities: [],
      compatibility: {
        name: 'Senior Dev',
        description: 'Governed reviewer',
        ...compatibility,
      },
    },
    created_at: `2026-07-12T00:00:0${versionNumber}.000Z`,
    published_at: `2026-07-12T00:00:0${versionNumber}.000Z`,
  };
}

function ownerAccess() {
  return {
    agent_id: AGENT_ID,
    owner: true,
    role_keys: ['owner'],
    permissions: ['agent.read', 'agent.invoke', 'agent.edit', 'agent.share', 'agent.delete'],
  };
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
