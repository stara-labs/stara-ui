const mockCallStaraApi = jest.fn();

jest.mock('~/models/canonicalAgents', () => ({
  canonicalAgentsEnabled: jest.fn(() => false),
  canonicalAgentId: jest.fn(() => null),
}));

jest.mock('~/models/canonicalSkills', () => ({
  canonicalSkillsEnabled: jest.fn(() => true),
  canonicalSkillId: jest.fn((value) => String(value)),
}));

jest.mock('~/models/canonicalPrompts', () => ({
  canonicalPromptsEnabled: jest.fn(() => true),
  canonicalPromptId: jest.fn((value) => String(value)),
}));

jest.mock('~/server/services/StaraServiceClient', () => ({
  callStaraApi: (...args) => mockCallStaraApi(...args),
  safeString: (value, fallback, maxLength = 512) => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized ? normalized.slice(0, maxLength) : fallback;
  },
}));

const {
  AccessRoleIds,
  PermissionBits,
  PrincipalType,
  ResourceType,
} = require('librechat-data-provider');
const {
  getCanonicalResourcePermissions,
  getCanonicalResourceRoles,
  hasCanonicalResourcePermission,
  updateCanonicalResourcePermissions,
} = require('./CanonicalResourceSharingService');

const skillId = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';
const ownerId = '33333333-3333-4333-8333-333333333333';
const memberId = '44444444-4444-4444-8444-444444444444';
const teamId = '55555555-5555-4555-8555-555555555555';
const user = { id: 'mongo-user', tenantId: 'tenant_acme', email: 'owner@example.com' };
const skill = { id: skillId, tenant_id: tenantId, owner_user_id: ownerId };
const members = [
  { user_id: ownerId, display_name: 'Owner Person', email: 'owner@example.com' },
  { user_id: memberId, display_name: 'Member Person', email: 'member@example.com' },
];
const teams = [{ team_id: teamId, name: 'Engineering', member_ids: [ownerId, memberId] }];

const installSharingResponses = (grants = []) => {
  mockCallStaraApi.mockImplementation((_user, path, options = {}) => {
    if (path === `/v1/skills/${skillId}`) return Promise.resolve({ skill });
    if (path === `/v1/skills/${skillId}/grants` && options.method !== 'PUT') {
      return Promise.resolve({ grants });
    }
    if (path === `/v1/orgs/${tenantId}/members`) return Promise.resolve({ members });
    if (path === `/v1/orgs/${tenantId}/teams`) return Promise.resolve({ teams });
    if (path === `/v1/skills/${skillId}/grants` && options.method === 'PUT') {
      return Promise.resolve({ grants: options.body.grants });
    }
    throw new Error(`Unexpected Stara request: ${options.method ?? 'GET'} ${path}`);
  });
};

describe('CanonicalResourceSharingService skills', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps all canonical skill roles into picker options', async () => {
    mockCallStaraApi.mockResolvedValue({
      roles: [
        { role_key: 'viewer', label: 'Can view', permissions: ['skill.read'] },
        { role_key: 'operator', label: 'Can use', permissions: ['skill.read', 'skill.invoke'] },
        {
          role_key: 'editor',
          label: 'Can edit',
          permissions: ['skill.read', 'skill.invoke', 'skill.edit'],
        },
        {
          role_key: 'owner',
          label: 'Full access',
          permissions: ['skill.read', 'skill.invoke', 'skill.edit', 'skill.share', 'skill.delete'],
        },
      ],
    });

    await expect(getCanonicalResourceRoles(user, ResourceType.SKILL)).resolves.toEqual([
      expect.objectContaining({ accessRoleId: AccessRoleIds.SKILL_VIEWER }),
      expect.objectContaining({ accessRoleId: AccessRoleIds.SKILL_OPERATOR }),
      expect.objectContaining({ accessRoleId: AccessRoleIds.SKILL_EDITOR }),
      expect.objectContaining({ accessRoleId: AccessRoleIds.SKILL_OWNER }),
    ]);
  });

  it('returns the immutable owner and resolved user and team grants', async () => {
    installSharingResponses([
      { principal_type: 'user', principal_id: memberId, role_key: 'operator' },
      { principal_type: 'team', principal_id: teamId, role_key: 'editor' },
    ]);

    const result = await getCanonicalResourcePermissions(user, ResourceType.SKILL, skillId);

    expect(result).toMatchObject({
      resourceType: ResourceType.SKILL,
      resourceId: skillId,
      public: false,
      publicSupported: false,
    });
    expect(result.principals).toEqual([
      expect.objectContaining({ id: ownerId, accessRoleId: AccessRoleIds.SKILL_OWNER }),
      expect.objectContaining({ id: memberId, accessRoleId: AccessRoleIds.SKILL_OPERATOR }),
      expect.objectContaining({
        id: teamId,
        type: PrincipalType.GROUP,
        accessRoleId: AccessRoleIds.SKILL_EDITOR,
      }),
    ]);
  });

  it('checks sharing access through the canonical resource access endpoint', async () => {
    mockCallStaraApi.mockResolvedValue({
      access: { permissions: ['skill.read', 'skill.invoke', 'skill.share'] },
    });

    await expect(
      hasCanonicalResourcePermission(user, ResourceType.SKILL, skillId, PermissionBits.SHARE),
    ).resolves.toBe(true);
    expect(mockCallStaraApi).toHaveBeenCalledWith(user, `/v1/skills/${skillId}/access`, {
      tenantId: 'tenant_acme',
    });

    mockCallStaraApi.mockResolvedValue({ access: { permissions: ['skill.read'] } });
    await expect(
      hasCanonicalResourcePermission(user, ResourceType.SKILL, skillId, PermissionBits.SHARE),
    ).resolves.toBe(false);
  });

  it('reconciles skill grants through the canonical API and rejects public sharing', async () => {
    installSharingResponses([]);
    await updateCanonicalResourcePermissions(user, ResourceType.SKILL, skillId, {
      updated: [
        {
          type: PrincipalType.USER,
          id: memberId,
          accessRoleId: AccessRoleIds.SKILL_OPERATOR,
        },
      ],
      public: false,
    });
    expect(mockCallStaraApi).toHaveBeenCalledWith(user, `/v1/skills/${skillId}/grants`, {
      method: 'PUT',
      tenantId: 'tenant_acme',
      body: {
        grants: [{ principal_type: 'user', principal_id: memberId, role_key: 'operator' }],
      },
    });

    await expect(
      updateCanonicalResourcePermissions(user, ResourceType.SKILL, skillId, { public: true }),
    ).rejects.toThrow('Public skill sharing is not supported');
  });
});

describe('CanonicalResourceSharingService prompts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps the canonical prompt operator role into the permission picker', async () => {
    mockCallStaraApi.mockImplementation((_user, path) => {
      if (path !== '/v1/access/roles?resource_type=prompt') {
        throw new Error(`Unexpected Stara request: GET ${path}`);
      }
      return Promise.resolve({
        roles: [
          { role_key: 'viewer', label: 'Can view', permissions: ['prompt.read'] },
          {
            role_key: 'operator',
            label: 'Can use',
            permissions: ['prompt.read', 'prompt.use'],
          },
          {
            role_key: 'editor',
            label: 'Can edit',
            permissions: ['prompt.read', 'prompt.use', 'prompt.edit'],
          },
          {
            role_key: 'owner',
            label: 'Full access',
            permissions: [
              'prompt.read',
              'prompt.use',
              'prompt.edit',
              'prompt.share',
              'prompt.delete',
            ],
          },
        ],
      });
    });

    await expect(getCanonicalResourceRoles(user, ResourceType.PROMPTGROUP)).resolves.toEqual([
      expect.objectContaining({ accessRoleId: AccessRoleIds.PROMPTGROUP_VIEWER }),
      expect.objectContaining({ accessRoleId: AccessRoleIds.PROMPTGROUP_OPERATOR }),
      expect.objectContaining({ accessRoleId: AccessRoleIds.PROMPTGROUP_EDITOR }),
      expect.objectContaining({ accessRoleId: AccessRoleIds.PROMPTGROUP_OWNER }),
    ]);
  });
});
