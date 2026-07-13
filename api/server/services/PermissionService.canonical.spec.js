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

jest.mock('~/server/services/GraphApiService', () => ({}));

const { ResourceType, PermissionBits } = require('librechat-data-provider');
const {
  getCanonicalAgentAccess,
  hasCanonicalAgentPermission,
  listCanonicalAgentIds,
} = require('~/models/canonicalAgents');
const {
  checkPermission,
  findAccessibleResources,
  getEffectivePermissions,
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
});
