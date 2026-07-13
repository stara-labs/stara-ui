const mockCallStaraApi = jest.fn();

jest.mock('@librechat/data-schemas', () => ({
  getUserId: jest.fn(() => 'mongo-user'),
}));

jest.mock('~/server/services/StaraServiceClient', () => ({
  callStaraApi: (...args) => mockCallStaraApi(...args),
  getUserId: (user) => user.id,
  safeString: (value, fallback, maxLength = 512) => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized ? normalized.slice(0, maxLength) : fallback;
  },
}));

const originalPrompts = process.env.STARA_CANONICAL_PROMPTS;
const originalWorkspace = process.env.STARA_CANONICAL_WORKSPACE;
const {
  canonicalPromptsEnabled,
  createCanonicalPromptMethods,
  getCanonicalPromptAccess,
} = require('./canonicalPrompts');

const promptId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const tenantId = '44444444-4444-4444-8444-444444444444';
const user = {
  id: 'mongo-user',
  email: 'owner@example.com',
  name: 'Prompt Owner',
  tenantId: 'tenant_acme',
  emailVerified: true,
  twoFactorEnabled: true,
};
const canonical = {
  id: promptId,
  tenant_id: tenantId,
  owner_user_id: actorId,
  owner_display_name: 'Prompt Owner',
  name: 'Release summary',
  oneliner: 'Summarize an approved release.',
  category: 'engineering',
  command: 'release-summary',
  number_of_generations: 0,
  production_version_id: versionId,
  production_version: {
    id: versionId,
    tenant_id: tenantId,
    prompt_id: promptId,
    author_user_id: actorId,
    version_number: 1,
    content: 'Use approved evidence.',
    type: 'text',
    status: 'active',
    created_at: '2026-07-13T00:00:00.000Z',
  },
  version: 1,
  status: 'active',
  created_at: '2026-07-13T00:00:00.000Z',
  updated_at: '2026-07-13T00:00:00.000Z',
};

describe('canonical prompt model adapter', () => {
  beforeAll(() => {
    process.env.STARA_CANONICAL_PROMPTS = 'true';
    process.env.STARA_CANONICAL_WORKSPACE = 'true';
  });

  afterAll(() => {
    restoreEnv('STARA_CANONICAL_PROMPTS', originalPrompts);
    restoreEnv('STARA_CANONICAL_WORKSPACE', originalWorkspace);
  });

  beforeEach(() => jest.clearAllMocks());

  it('can be explicitly disabled without disabling the rest of the workspace', () => {
    process.env.STARA_CANONICAL_PROMPTS = 'false';
    expect(canonicalPromptsEnabled()).toBe(false);
    expect(createCanonicalPromptMethods(baseMethods())).toEqual({});
    process.env.STARA_CANONICAL_PROMPTS = 'true';
  });

  it('loads Prompt Library groups from Stara without calling Mongo prompt methods', async () => {
    mockCallStaraApi.mockImplementation((_user, path) => {
      if (path === '/v1/me') return Promise.resolve({ user: { id: actorId } });
      if (path === '/v1/prompts') return Promise.resolve({ prompts: [canonical] });
      throw new Error(`Unexpected Stara request: ${path}`);
    });
    const base = baseMethods();
    const methods = createCanonicalPromptMethods(base);

    await expect(methods.getAllPromptGroups()).resolves.toEqual([
      expect.objectContaining({
        _id: promptId,
        author: 'mongo-user',
        productionId: versionId,
        isPublic: false,
      }),
    ]);
    expect(base.getUserById).toHaveBeenCalledTimes(1);
  });

  it('resolves prompt access with trusted tenant context', async () => {
    mockCallStaraApi.mockResolvedValue({
      access: { prompt_id: promptId, owner: true, permissions: ['prompt.read', 'prompt.edit'] },
    });

    await expect(getCanonicalPromptAccess(user, promptId)).resolves.toMatchObject({ owner: true });
    expect(mockCallStaraApi).toHaveBeenCalledWith(user, `/v1/prompts/${promptId}/access`, {
      tenantId: 'tenant_acme',
    });
  });
});

function baseMethods() {
  return { getUserById: jest.fn().mockResolvedValue(user) };
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
