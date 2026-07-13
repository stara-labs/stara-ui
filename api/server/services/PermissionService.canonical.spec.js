jest.mock('~/models', () => ({
  getUserById: jest.fn().mockResolvedValue({
    _id: 'user_maya',
    email: 'maya@example.com',
    tenantId: 'tenant_acme',
    idOnTheSource: 'fixture:user_maya',
    emailVerified: true,
    twoFactorEnabled: true,
  }),
}));

jest.mock('~/models/canonicalAgents', () => ({
  canonicalAgentsEnabled: jest.fn(() => true),
  canonicalPermissionBits: jest.fn(() => 15),
  getCanonicalAgentAccess: jest.fn().mockResolvedValue({ permissions: ['agent.read'] }),
  hasCanonicalAgentPermission: jest.fn().mockResolvedValue(true),
  listCanonicalAgentIds: jest.fn().mockResolvedValue(['11111111-1111-4111-8111-111111111111']),
}));

jest.mock('~/models/canonicalSkills', () => ({
  canonicalSkillsEnabled: jest.fn(() => true),
  canonicalSkillPermissionBits: jest.fn(() => 1),
  getCanonicalSkillAccess: jest.fn().mockResolvedValue({
    owner: true,
    permissions: ['skill.read', 'skill.invoke', 'skill.edit', 'skill.share', 'skill.delete'],
  }),
  hasCanonicalSkillPermission: jest.fn().mockResolvedValue(true),
  listCanonicalSkillIds: jest.fn().mockResolvedValue(['22222222-2222-4222-8222-222222222222']),
}));

jest.mock('~/server/services/GraphApiService', () => ({}));

const {
  AccessRoleIds,
  PrincipalType,
  ResourceType,
  PermissionBits,
} = require('librechat-data-provider');
const {
  getCanonicalAgentAccess,
  hasCanonicalAgentPermission,
  listCanonicalAgentIds,
} = require('~/models/canonicalAgents');
const { getCanonicalSkillAccess, listCanonicalSkillIds } = require('~/models/canonicalSkills');
const {
  checkPermission,
  findAccessibleResources,
  getEffectivePermissions,
  grantPermission,
} = require('./PermissionService');

describe('PermissionService canonical agents', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps in-app reads and remote invocation to distinct canonical checks', async () => {
    await expect(
      checkPermission({
        userId: 'user_maya',
        resourceType: ResourceType.AGENT,
        resourceId: '11111111-1111-4111-8111-111111111111',
        requiredPermission: PermissionBits.VIEW,
      }),
    ).resolves.toBe(true);
    expect(hasCanonicalAgentPermission).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'user_maya' }),
      '11111111-1111-4111-8111-111111111111',
      PermissionBits.VIEW,
      false,
    );

    await checkPermission({
      userId: 'user_maya',
      resourceType: ResourceType.REMOTE_AGENT,
      resourceId: '11111111-1111-4111-8111-111111111111',
      requiredPermission: PermissionBits.VIEW,
    });
    expect(hasCanonicalAgentPermission).toHaveBeenLastCalledWith(
      expect.any(Object),
      '11111111-1111-4111-8111-111111111111',
      PermissionBits.VIEW,
      true,
    );
  });

  it('lists and evaluates permissions without querying Mongo ACL entries', async () => {
    await expect(
      findAccessibleResources({
        userId: 'user_maya',
        resourceType: ResourceType.REMOTE_AGENT,
        requiredPermissions: PermissionBits.VIEW,
      }),
    ).resolves.toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(listCanonicalAgentIds).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user_maya' }),
      PermissionBits.VIEW,
      true,
    );

    await expect(
      getEffectivePermissions({
        userId: 'user_maya',
        resourceType: ResourceType.AGENT,
        resourceId: '11111111-1111-4111-8111-111111111111',
      }),
    ).resolves.toBe(15);
    expect(getCanonicalAgentAccess).toHaveBeenCalled();
  });

  it('separates canonical skill visibility from invocation', async () => {
    await findAccessibleResources({
      userId: 'user_maya',
      resourceType: ResourceType.SKILL,
      requiredPermissions: PermissionBits.VIEW,
    });
    expect(listCanonicalSkillIds).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'user_maya' }),
      PermissionBits.VIEW,
      false,
    );

    await findAccessibleResources({
      userId: 'user_maya',
      resourceType: ResourceType.SKILL,
      requiredPermissions: PermissionBits.VIEW,
      invoke: true,
    });
    expect(listCanonicalSkillIds).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'user_maya' }),
      PermissionBits.VIEW,
      true,
    );
  });

  it('verifies canonical skill ownership without creating a Mongo ACL', async () => {
    const skillId = '22222222-2222-4222-8222-222222222222';

    await expect(
      grantPermission({
        principalType: PrincipalType.USER,
        principalId: 'user_maya',
        resourceType: ResourceType.SKILL,
        resourceId: skillId,
        accessRoleId: AccessRoleIds.SKILL_OWNER,
        grantedBy: 'user_maya',
      }),
    ).resolves.toMatchObject({ canonical: true, resourceId: skillId });
    expect(getCanonicalSkillAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user_maya' }),
      skillId,
    );
  });

  it('rejects direct canonical skill grants outside the sharing API', async () => {
    await expect(
      grantPermission({
        principalType: PrincipalType.USER,
        principalId: 'another_user',
        resourceType: ResourceType.SKILL,
        resourceId: '22222222-2222-4222-8222-222222222222',
        accessRoleId: AccessRoleIds.SKILL_VIEWER,
        grantedBy: 'user_maya',
      }),
    ).rejects.toThrow('Canonical skill grants must be managed through the sharing API');
  });
});
