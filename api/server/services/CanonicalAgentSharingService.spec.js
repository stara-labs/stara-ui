const mockCallStaraApi = jest.fn();

jest.mock('~/models/canonicalAgents', () => ({
  canonicalAgentsEnabled: jest.fn(() => true),
  canonicalAgentId: jest.fn((value) => String(value).replace(/^agent_/, '')),
}));

jest.mock('~/server/services/StaraServiceClient', () => ({
  callStaraApi: (...args) => mockCallStaraApi(...args),
  safeString: (value, fallback, maxLength = 512) => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized ? normalized.slice(0, maxLength) : fallback;
  },
}));

const { AccessRoleIds, PrincipalType, ResourceType } = require('librechat-data-provider');
const {
  getCanonicalAgentPermissions,
  getCanonicalAgentRoles,
  searchCanonicalPrincipals,
  updateCanonicalAgentPermissions,
} = require('./CanonicalAgentSharingService');

const agentId = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';
const ownerId = '33333333-3333-4333-8333-333333333333';
const memberId = '44444444-4444-4444-8444-444444444444';
const teamId = '55555555-5555-4555-8555-555555555555';
const user = { id: 'mongo-user', tenantId: 'tenant_acme', email: 'owner@example.com' };

const agent = { id: agentId, tenant_id: tenantId, owner_user_id: ownerId };
const members = [
  { user_id: ownerId, display_name: 'Owner Person', email: 'owner@example.com' },
  { user_id: memberId, display_name: 'Member Person', email: 'member@example.com' },
];
const teams = [
  {
    team_id: teamId,
    name: 'Engineering',
    description: 'Product engineering',
    member_ids: [ownerId, memberId],
  },
];

const installSharingResponses = (grants = []) => {
  mockCallStaraApi.mockImplementation((_user, path, options = {}) => {
    if (path === `/v1/agents/${agentId}`) return Promise.resolve({ agent });
    if (path === `/v1/agents/${agentId}/grants` && options.method !== 'PUT') {
      return Promise.resolve({ grants });
    }
    if (path === `/v1/orgs/${tenantId}/members`) return Promise.resolve({ members });
    if (path === `/v1/orgs/${tenantId}/teams`) return Promise.resolve({ teams });
    if (path === `/v1/agents/${agentId}/grants` && options.method === 'PUT') {
      return Promise.resolve({ grants: options.body.grants });
    }
    throw new Error(`Unexpected Stara request: ${options.method ?? 'GET'} ${path}`);
  });
};

describe('CanonicalAgentSharingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps every canonical role bundle into the LibreChat picker contract', async () => {
    mockCallStaraApi.mockResolvedValue({
      roles: [
        { role_key: 'viewer', label: 'Can view', permissions: ['agent.read'] },
        { role_key: 'operator', label: 'Can use', permissions: ['agent.read', 'agent.invoke'] },
        { role_key: 'editor', label: 'Can edit', permissions: ['agent.read', 'agent.edit'] },
        {
          role_key: 'owner',
          label: 'Full access',
          permissions: ['agent.read', 'agent.edit', 'agent.share', 'agent.delete'],
        },
      ],
    });

    await expect(getCanonicalAgentRoles(user)).resolves.toEqual([
      expect.objectContaining({ accessRoleId: AccessRoleIds.AGENT_VIEWER }),
      expect.objectContaining({ accessRoleId: AccessRoleIds.AGENT_OPERATOR }),
      expect.objectContaining({ accessRoleId: AccessRoleIds.AGENT_EDITOR }),
      expect.objectContaining({ accessRoleId: AccessRoleIds.AGENT_OWNER }),
    ]);
  });

  it('returns the immutable canonical owner plus resolved member and team grants', async () => {
    installSharingResponses([
      { principal_type: 'user', principal_id: memberId, role_key: 'operator' },
      { principal_type: 'team', principal_id: teamId, role_key: 'editor' },
    ]);

    const result = await getCanonicalAgentPermissions(user, agentId);

    expect(result).toMatchObject({
      resourceType: ResourceType.AGENT,
      resourceId: agentId,
      public: false,
      publicSupported: false,
    });
    expect(result.principals).toEqual([
      expect.objectContaining({
        id: ownerId,
        accessRoleId: AccessRoleIds.AGENT_OWNER,
        isCanonicalOwner: true,
      }),
      expect.objectContaining({ id: memberId, accessRoleId: AccessRoleIds.AGENT_OPERATOR }),
      expect.objectContaining({
        id: teamId,
        type: PrincipalType.GROUP,
        accessRoleId: AccessRoleIds.AGENT_EDITOR,
      }),
    ]);
  });

  it('reconciles all changed grants in one canonical API request', async () => {
    installSharingResponses([
      { principal_type: 'user', principal_id: memberId, role_key: 'viewer' },
    ]);

    await updateCanonicalAgentPermissions(user, agentId, {
      removed: [
        {
          type: PrincipalType.USER,
          id: memberId,
          idOnTheSource: memberId,
          accessRoleId: AccessRoleIds.AGENT_VIEWER,
        },
      ],
      updated: [
        {
          type: PrincipalType.GROUP,
          id: teamId,
          idOnTheSource: teamId,
          accessRoleId: AccessRoleIds.AGENT_OPERATOR,
        },
      ],
      public: false,
    });

    expect(mockCallStaraApi).toHaveBeenCalledWith(user, `/v1/agents/${agentId}/grants`, {
      method: 'PUT',
      tenantId: 'tenant_acme',
      body: {
        grants: [{ principal_type: 'team', principal_id: teamId, role_key: 'operator' }],
      },
    });
  });

  it('rejects attempts to change the canonical owner', async () => {
    installSharingResponses([]);

    await expect(
      updateCanonicalAgentPermissions(user, agentId, {
        removed: [
          {
            type: PrincipalType.USER,
            id: ownerId,
            idOnTheSource: ownerId,
            accessRoleId: AccessRoleIds.AGENT_OWNER,
          },
        ],
      }),
    ).rejects.toThrow('canonical agent owner cannot be removed');
  });

  it('searches canonical active-tenant members and teams', async () => {
    mockCallStaraApi.mockImplementation((_user, path) => {
      if (path === '/v1/me') {
        return Promise.resolve({
          memberships: [
            {
              tenant_id: tenantId,
              tenant_key: 'tenant_acme',
              membership_status: 'active',
            },
          ],
        });
      }
      if (path === `/v1/orgs/${tenantId}/members`) return Promise.resolve({ members });
      if (path === `/v1/orgs/${tenantId}/teams`) return Promise.resolve({ teams });
      throw new Error(`Unexpected Stara request: ${path}`);
    });

    const result = await searchCanonicalPrincipals(user, {
      query: 'eng',
      limit: 20,
      typeFilters: null,
    });

    expect(result.results).toEqual([
      expect.objectContaining({ id: teamId, name: 'Engineering', type: PrincipalType.GROUP }),
    ]);
  });
});
