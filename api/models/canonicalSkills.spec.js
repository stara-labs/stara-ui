jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  getUserId: jest.fn(() => 'user_maya'),
}));

jest.mock('~/server/services/StaraServiceClient', () => ({
  callStaraApi: jest.fn(),
  getUserId: (user) => user?.id ?? user?._id?.toString(),
  safeString: (value, fallback, maxLength = 512) =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback,
}));

const mockGetCanonicalRequestUser = jest.fn();
jest.mock('~/server/services/StaraApiClient', () => ({
  getCanonicalRequestUser: (...args) => mockGetCanonicalRequestUser(...args),
}));

const { PermissionBits } = require('librechat-data-provider');
const { callStaraApi } = require('~/server/services/StaraServiceClient');
const {
  canonicalSkillPermissionBits,
  canonicalSkillsEnabled,
  createCanonicalSkillMethods,
  listCanonicalSkillIds,
} = require('./canonicalSkills');

const SKILL_ID = '11111111-1111-4111-8111-111111111111';
const VIEWER_SKILL_ID = '22222222-2222-4222-8222-222222222222';
const FILE_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';

describe('canonical skill model adapter', () => {
  const originalSkills = process.env.STARA_CANONICAL_SKILLS;
  const originalWorkspace = process.env.STARA_CANONICAL_WORKSPACE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STARA_CANONICAL_SKILLS = 'true';
    process.env.STARA_CANONICAL_WORKSPACE = 'true';
    mockGetCanonicalRequestUser.mockReturnValue(baseUser());
  });

  afterAll(() => {
    restoreEnv('STARA_CANONICAL_SKILLS', originalSkills);
    restoreEnv('STARA_CANONICAL_WORKSPACE', originalWorkspace);
  });

  it('supports an explicit flag and otherwise follows canonical workspace mode', () => {
    delete process.env.STARA_CANONICAL_SKILLS;
    expect(canonicalSkillsEnabled()).toBe(true);
    process.env.STARA_CANONICAL_SKILLS = 'false';
    expect(canonicalSkillsEnabled()).toBe(false);
    expect(createCanonicalSkillMethods(baseMethods())).toEqual({});
  });

  it('creates a canonical skill while preserving the builder contract', async () => {
    mockActorAnd(({ path, options }) => {
      expect(path).toBe('/v1/skills');
      expect(options).toMatchObject({
        method: 'POST',
        body: {
          name: 'release-notes',
          description: 'Draft release notes from approved changes.',
          activate: true,
          definition: {
            body: 'Use only approved changes.',
            display_title: 'Release notes',
            disable_model_invocation: false,
            user_invocable: true,
            allowed_tools: ['search'],
            always_apply: true,
            file_ids: [],
          },
        },
      });
      return { skill: canonicalSkill(options.body) };
    });
    const methods = createCanonicalSkillMethods(baseMethods());

    const result = await methods.createSkill({
      name: 'release-notes',
      displayTitle: 'Release notes',
      description: 'Draft release notes from approved changes.',
      body: 'Use only approved changes.',
      frontmatter: { 'allowed-tools': ['search'], 'always-apply': true },
      author: 'user_maya',
      authorName: 'Maya',
    });

    expect(result.skill).toMatchObject({
      _id: SKILL_ID,
      author: 'user_maya',
      name: 'release-notes',
      displayTitle: 'Release notes',
      version: 1,
      allowedTools: ['search'],
      alwaysApply: true,
      fileCount: 0,
    });
    expect(result.warnings).toEqual([]);
    expect(mockGetCanonicalRequestUser).toHaveBeenCalledWith('user_maya');
  });

  it('returns the authoritative skill on an optimistic version conflict', async () => {
    let reads = 0;
    callStaraApi.mockImplementation(async (_user, path, options = {}) => {
      if (path === '/v1/me') return actorResponse();
      if (path === `/v1/skills/${SKILL_ID}` && !options.method) {
        reads += 1;
        return {
          skill: canonicalSkill(
            {},
            { version: reads === 1 ? 1 : 2, description: 'Concurrent edit' },
          ),
        };
      }
      if (path === `/v1/skills/${SKILL_ID}` && options.method === 'PUT') {
        throw Object.assign(new Error('Reload before saving'), {
          status: 409,
          code: 'skill_version_conflict',
        });
      }
      throw new Error(`Unexpected API call: ${options.method ?? 'GET'} ${path}`);
    });
    const methods = createCanonicalSkillMethods(baseMethods());

    const result = await methods.updateSkill({
      id: SKILL_ID,
      expectedVersion: 1,
      update: { description: 'My edit' },
    });

    expect(result).toMatchObject({
      status: 'conflict',
      current: { version: 2, description: 'Concurrent edit' },
    });
  });

  it('keeps read and invoke access distinct', async () => {
    callStaraApi.mockImplementation(async (_user, path) => {
      if (path === '/v1/skills') {
        return {
          skills: [canonicalSkill(), canonicalSkill({}, { id: VIEWER_SKILL_ID, name: 'viewer' })],
        };
      }
      if (path === `/v1/skills/${SKILL_ID}/access`) {
        return { access: skillAccess(SKILL_ID, ['skill.read', 'skill.invoke']) };
      }
      if (path === `/v1/skills/${VIEWER_SKILL_ID}/access`) {
        return { access: skillAccess(VIEWER_SKILL_ID, ['skill.read']) };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    const user = { ...baseUser() };

    await expect(listCanonicalSkillIds(user, PermissionBits.VIEW, true)).resolves.toEqual([
      SKILL_ID,
    ]);
    expect(canonicalSkillPermissionBits(skillAccess(SKILL_ID, ['skill.read']), false)).toBe(
      PermissionBits.VIEW,
    );
    expect(canonicalSkillPermissionBits(skillAccess(SKILL_ID, ['skill.read']), true)).toBe(0);
  });

  it('stores file associations in the canonical definition and deletes bytes through the file API', async () => {
    let skill = canonicalSkill();
    callStaraApi.mockImplementation(async (_user, path, options = {}) => {
      if (path === '/v1/me') return actorResponse();
      if (path === `/v1/skills/${SKILL_ID}` && !options.method) return { skill };
      if (path === `/v1/skills/${SKILL_ID}` && options.method === 'PUT') {
        skill = canonicalSkill(options.body, {
          version: skill.version + 1,
          definition: options.body.definition,
        });
        return { skill };
      }
      if (path === `/v1/files/${FILE_ID}` && options.method === 'DELETE') return {};
      throw new Error(`Unexpected API call: ${options.method ?? 'GET'} ${path}`);
    });
    const methods = createCanonicalSkillMethods(baseMethods());

    const file = await methods.upsertSkillFile({
      skillId: SKILL_ID,
      relativePath: 'references/guide.txt',
      file_id: FILE_ID,
      filename: 'guide.txt',
      source: 'stara',
      mimeType: 'text/plain',
      bytes: 42,
      author: 'user_maya',
    });
    expect(file).toMatchObject({
      _id: FILE_ID,
      skillId: SKILL_ID,
      relativePath: 'references/guide.txt',
      source: 'stara',
      category: 'reference',
    });
    expect(skill.definition.file_ids).toEqual([FILE_ID]);
    expect(skill.definition.compatibility.skill_files).toHaveLength(1);

    await expect(methods.deleteSkillFile(SKILL_ID, 'references/guide.txt')).resolves.toEqual({
      deleted: true,
    });
    expect(skill.definition.file_ids).toEqual([]);
    expect(callStaraApi).toHaveBeenCalledWith(
      expect.anything(),
      `/v1/files/${FILE_ID}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

function baseMethods() {
  return {
    getUserById: jest.fn(),
    getAgents: jest.fn().mockResolvedValue([]),
    updateAgent: jest.fn(),
  };
}

function baseUser() {
  return {
    _id: 'user_maya',
    id: 'user_maya',
    email: 'maya@example.com',
    name: 'Maya',
    tenantId: 'tenant_acme',
    idOnTheSource: 'fixture:user_maya',
    emailVerified: true,
    twoFactorEnabled: true,
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

function canonicalSkill(body = {}, overrides = {}) {
  const definition = overrides.definition ??
    body.definition ?? {
      body: 'Use only approved changes.',
      frontmatter: { 'allowed-tools': ['search'] },
      display_title: 'Release notes',
      disable_model_invocation: false,
      user_invocable: true,
      allowed_tools: ['search'],
      category: 'engineering',
      source: 'inline',
      source_metadata: {},
      always_apply: true,
      file_ids: [],
      compatibility: { author_name: 'Maya', skill_files: [] },
    };
  return {
    id: SKILL_ID,
    tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    owner_user_id: ACTOR_ID,
    name: body.name ?? 'release-notes',
    description: body.description ?? 'Draft release notes from approved changes.',
    definition,
    version: 1,
    status: body.activate === false ? 'draft' : 'active',
    created_at: '2026-07-13T00:00:00.000Z',
    updated_at: '2026-07-13T00:00:00.000Z',
    ...overrides,
  };
}

function skillAccess(skillId, permissions) {
  return { skill_id: skillId, owner: false, role_keys: ['viewer'], permissions };
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
