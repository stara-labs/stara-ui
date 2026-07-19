const mockRegistry = {
  ensureConfigServers: jest.fn(),
  getServerConfig: jest.fn(),
  getAllServerConfigs: jest.fn(),
  isDynamicServerManagementEnabled: jest.fn().mockReturnValue(true),
};
const mockCallStaraApi = jest.fn();

jest.mock('~/config', () => ({
  getMCPServersRegistry: jest.fn(() => mockRegistry),
  getMCPManager: jest.fn(),
  getFlowStateManager: jest.fn(),
  getOAuthReconnectionManager: jest.fn(),
}));

jest.mock('@librechat/data-schemas', () => ({
  getTenantId: jest.fn(() => 'tenant-1'),
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn(),
  setCachedTools: jest.fn(),
  getCachedTools: jest.fn(),
  getMCPServerTools: jest.fn(),
  loadCustomConfig: jest.fn(),
}));

jest.mock('../StaraServiceClient', () => ({
  callStaraApi: (...args) => mockCallStaraApi(...args),
  identitySubject: (user) => user?.identitySubject ?? `librechat:${user?.id}`,
}));

jest.mock('@librechat/api', () => ({
  sendEvent: jest.fn(),
  MCPOAuthHandler: jest.fn(),
  isMCPDomainAllowed: jest.fn(),
  normalizeServerName: jest.fn((name) => name),
  normalizeJsonSchema: jest.fn((schema) => schema),
  GenerationJobManager: jest.fn(),
  resolveJsonSchemaRefs: jest.fn((schema) => schema),
  buildOAuthToolCallName: jest.fn((name) => name),
}));

jest.mock('~/cache', () => ({ getLogStores: jest.fn() }));
jest.mock('~/models', () => ({
  findToken: jest.fn(),
  createToken: jest.fn(),
  updateToken: jest.fn(),
}));
jest.mock('~/server/services/GraphTokenService', () => ({
  getGraphApiToken: jest.fn(),
}));
jest.mock('~/server/services/OboTokenService', () => ({
  exchangeOboToken: jest.fn(),
}));
jest.mock('~/server/services/OboPolicyService', () => ({
  createOboTrustChecker: jest.fn(() => async () => true),
}));
jest.mock('~/server/services/Tools/mcp', () => ({
  reinitMCPServer: jest.fn(),
}));

const { getAppConfig } = require('~/server/services/Config');
const { resolveConfigServers, resolveMcpConfigNames, resolveAllMcpConfigs } = require('../MCP');

describe('resolveConfigServers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRegistry.isDynamicServerManagementEnabled.mockReturnValue(true);
    mockRegistry.getServerConfig.mockResolvedValue(undefined);
  });

  it('resolves config servers for the current request context', async () => {
    getAppConfig.mockResolvedValue({ mcpConfig: { srv: { url: 'http://a' } } });
    mockRegistry.ensureConfigServers.mockResolvedValue({ srv: { name: 'srv' } });

    const result = await resolveConfigServers({ user: { id: 'u1', role: 'admin' } });

    expect(result).toEqual({ srv: { name: 'srv' } });
    expect(getAppConfig).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin', userId: 'u1' }),
    );
    expect(mockRegistry.ensureConfigServers).toHaveBeenCalledWith({ srv: { url: 'http://a' } });
  });

  it('returns {} when ensureConfigServers throws', async () => {
    getAppConfig.mockResolvedValue({ mcpConfig: { srv: {} } });
    mockRegistry.ensureConfigServers.mockRejectedValue(new Error('inspect failed'));

    const result = await resolveConfigServers({ user: { id: 'u1' } });

    expect(result).toEqual({});
  });

  it('returns {} when getAppConfig throws', async () => {
    getAppConfig.mockRejectedValue(new Error('db timeout'));

    const result = await resolveConfigServers({ user: { id: 'u1' } });

    expect(result).toEqual({});
  });

  it('passes empty mcpConfig when appConfig has none', async () => {
    getAppConfig.mockResolvedValue({});
    mockRegistry.ensureConfigServers.mockResolvedValue({});

    await resolveConfigServers({ user: { id: 'u1' } });

    expect(mockRegistry.ensureConfigServers).toHaveBeenCalledWith({});
  });

  it('injects canonical Stara headers for agent tool loading', async () => {
    mockRegistry.isDynamicServerManagementEnabled.mockReturnValue(false);
    getAppConfig.mockResolvedValue({
      mcpConfig: {
        'stara-control-plane': { type: 'http', url: 'http://stara-mcp:3083/mcp' },
      },
    });
    mockRegistry.ensureConfigServers.mockResolvedValue({
      'stara-control-plane': { type: 'http', url: 'http://stara-mcp:3083/mcp' },
    });
    mockCallStaraApi.mockResolvedValue({
      user: { id: 'canonical-user-1' },
      memberships: [
        {
          tenant_key: 'tenant-1',
          tenant_id: 'canonical-tenant-1',
          membership_status: 'active',
          role_key: 'member',
          scope_ids: ['team:operations'],
          mcp_grants: ['stara.memory.read'],
        },
      ],
      assurance: { email_verified: true, mfa_enrolled: true },
    });

    const result = await resolveConfigServers({
      user: { id: 'u1', role: 'user', identitySubject: 'fixture:user_maya' },
    });

    expect(result['stara-control-plane'].headers).toMatchObject({
      'x-stara-tenant-id': 'tenant-1',
      'x-stara-identity-subject': 'fixture:user_maya',
      'x-stara-actor-id': 'canonical-user-1',
      'x-stara-grants': 'stara.memory.read',
    });
  });

  it('loads and secures the fixed Stara server when it is not a config override', async () => {
    getAppConfig.mockResolvedValue({ mcpConfig: {} });
    mockRegistry.ensureConfigServers.mockResolvedValue({});
    mockRegistry.getServerConfig.mockResolvedValue({
      type: 'http',
      url: 'http://stara-mcp:3083/mcp',
    });
    mockCallStaraApi.mockResolvedValue({
      user: { id: 'canonical-user-1' },
      memberships: [
        {
          tenant_key: 'tenant-1',
          tenant_id: 'canonical-tenant-1',
          membership_status: 'active',
          role_key: 'member',
          scope_ids: ['team:operations'],
          mcp_grants: ['stara.memory.read'],
        },
      ],
      assurance: { email_verified: true, mfa_enrolled: true },
    });

    const result = await resolveConfigServers({ user: { id: 'u1', role: 'user' } });

    expect(mockRegistry.getServerConfig).toHaveBeenCalledWith('stara-control-plane', 'u1', {});
    expect(result['stara-control-plane'].headers['x-stara-tenant-id']).toBe('tenant-1');
  });
});

describe('resolveMcpConfigNames', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resolves current request config server names', async () => {
    getAppConfig.mockResolvedValue({ mcpConfig: { cfg_srv: {}, yaml_srv: {} } });

    const result = await resolveMcpConfigNames({ user: { id: 'u1', role: 'admin' } });

    expect(result).toEqual(['cfg_srv', 'yaml_srv']);
    expect(getAppConfig).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin', userId: 'u1' }),
    );
  });

  it('returns [] when mcpConfig is absent', async () => {
    getAppConfig.mockResolvedValue({});

    const result = await resolveMcpConfigNames({ user: { id: 'u1' } });

    expect(result).toEqual([]);
  });

  it('propagates getAppConfig failures for write-path callers', async () => {
    getAppConfig.mockRejectedValue(new Error('db timeout'));

    await expect(resolveMcpConfigNames({ user: { id: 'u1' } })).rejects.toThrow('db timeout');
  });
});

describe('resolveAllMcpConfigs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRegistry.isDynamicServerManagementEnabled.mockReturnValue(true);
    delete process.env.STARA_MCP_BASELINE_GRANTS;
  });

  it('merges config servers with base servers', async () => {
    getAppConfig.mockResolvedValue({ mcpConfig: { cfg_srv: {} } });
    mockRegistry.ensureConfigServers.mockResolvedValue({ cfg_srv: { name: 'cfg_srv' } });
    mockRegistry.getAllServerConfigs.mockResolvedValue({
      cfg_srv: { name: 'cfg_srv' },
      yaml_srv: { name: 'yaml_srv' },
    });

    const result = await resolveAllMcpConfigs('u1', { id: 'u1', role: 'user' });

    expect(result).toEqual({
      cfg_srv: { name: 'cfg_srv' },
      yaml_srv: { name: 'yaml_srv' },
    });
    expect(mockRegistry.getAllServerConfigs).toHaveBeenCalledWith(
      'u1',
      {
        cfg_srv: { name: 'cfg_srv' },
      },
      'user',
    );
  });

  it('continues with empty configServers when ensureConfigServers fails', async () => {
    getAppConfig.mockResolvedValue({ mcpConfig: { srv: {} } });
    mockRegistry.ensureConfigServers.mockRejectedValue(new Error('inspect failed'));
    mockRegistry.getAllServerConfigs.mockResolvedValue({ yaml_srv: { name: 'yaml_srv' } });

    const result = await resolveAllMcpConfigs('u1', { id: 'u1' });

    expect(result).toEqual({ yaml_srv: { name: 'yaml_srv' } });
    expect(mockRegistry.getAllServerConfigs).toHaveBeenCalledWith('u1', {});
  });

  it('propagates getAllServerConfigs failures', async () => {
    getAppConfig.mockResolvedValue({ mcpConfig: {} });
    mockRegistry.ensureConfigServers.mockResolvedValue({});
    mockRegistry.getAllServerConfigs.mockRejectedValue(new Error('redis down'));

    await expect(resolveAllMcpConfigs('u1', { id: 'u1' })).rejects.toThrow('redis down');
  });

  it('propagates getAppConfig failures', async () => {
    getAppConfig.mockRejectedValue(new Error('mongo down'));

    await expect(resolveAllMcpConfigs('u1', { id: 'u1' })).rejects.toThrow('mongo down');
  });

  it('injects canonical actor context only into the fixed Stara MCP server', async () => {
    mockRegistry.isDynamicServerManagementEnabled.mockReturnValue(false);
    getAppConfig.mockResolvedValue({ mcpConfig: {} });
    mockRegistry.ensureConfigServers.mockResolvedValue({});
    mockRegistry.getAllServerConfigs.mockResolvedValue({
      'stara-control-plane': {
        type: 'http',
        url: 'http://stara-mcp:3083/mcp',
        headers: { 'x-operator-header': 'preserved' },
      },
      'other-server': { type: 'http', url: 'https://other.example/mcp' },
    });
    mockCallStaraApi.mockResolvedValue({
      user: { id: 'canonical-user-1' },
      memberships: [
        {
          tenant_key: 'tenant-1',
          tenant_id: 'canonical-tenant-1',
          membership_status: 'active',
          role_key: 'member',
          scope_ids: ['team:operations'],
          mcp_grants: [
            'stara.memory.read',
            'stara.engineering.read',
            'stara.engineering.write',
            'stara.connectors.read',
            'stara.connectors.execute',
          ],
        },
      ],
      assurance: { email_verified: true, mfa_enrolled: true },
    });

    const result = await resolveAllMcpConfigs('u1', { id: 'u1', role: 'user' });

    expect(mockCallStaraApi).toHaveBeenCalledWith({ id: 'u1', role: 'user' }, '/v1/me', {
      tenantId: 'tenant-1',
    });
    expect(result['stara-control-plane']).toEqual(
      expect.objectContaining({
        startup: false,
        headers: {
          'x-operator-header': 'preserved',
          'x-stara-tenant-id': 'tenant-1',
          'x-stara-identity-subject': 'librechat:u1',
          'x-stara-actor-id': 'canonical-user-1',
          'x-stara-actor-email': '{{LIBRECHAT_USER_EMAIL}}',
          'x-stara-scope': 'team:operations',
          'x-stara-role-ids': 'member',
          'x-stara-grants':
            'stara.memory.read,stara.engineering.read,stara.engineering.write,stara.connectors.read,stara.connectors.execute',
          'x-stara-email-verified': '{{LIBRECHAT_USER_EMAILVERIFIED}}',
          'x-stara-mfa-enrolled': '{{LIBRECHAT_USER_TWOFACTORENABLED}}',
        },
      }),
    );
    expect(result['other-server']).toEqual({
      type: 'http',
      url: 'https://other.example/mcp',
    });
  });

  it('fails closed when canonical membership grants are missing', async () => {
    mockRegistry.isDynamicServerManagementEnabled.mockReturnValue(false);
    getAppConfig.mockResolvedValue({ mcpConfig: {} });
    mockRegistry.ensureConfigServers.mockResolvedValue({});
    mockRegistry.getAllServerConfigs.mockResolvedValue({
      'stara-control-plane': { type: 'http', url: 'http://stara-mcp:3083/mcp' },
    });
    mockCallStaraApi.mockResolvedValue({
      user: { id: 'canonical-user-1' },
      memberships: [
        {
          tenant_key: 'tenant-1',
          membership_status: 'active',
          role_key: 'member',
          scope_ids: ['team:operations'],
        },
      ],
      assurance: { email_verified: true, mfa_enrolled: true },
    });

    await expect(resolveAllMcpConfigs('u1', { id: 'u1', role: 'user' })).rejects.toThrow(
      'API-issued grants for the active membership',
    );
    expect(mockCallStaraApi).toHaveBeenCalledTimes(1);
  });

  it('fails closed when an API-issued grant is not header-safe', async () => {
    mockRegistry.isDynamicServerManagementEnabled.mockReturnValue(false);
    getAppConfig.mockResolvedValue({ mcpConfig: {} });
    mockRegistry.ensureConfigServers.mockResolvedValue({});
    mockRegistry.getAllServerConfigs.mockResolvedValue({
      'stara-control-plane': { type: 'http', url: 'http://stara-mcp:3083/mcp' },
    });
    mockCallStaraApi.mockResolvedValue({
      user: { id: 'canonical-user-1' },
      memberships: [
        {
          tenant_key: 'tenant-1',
          membership_status: 'active',
          role_key: 'member',
          scope_ids: ['team:operations'],
          mcp_grants: ['stara.memory.read', 'invalid grant'],
        },
      ],
      assurance: { email_verified: true, mfa_enrolled: true },
    });

    await expect(resolveAllMcpConfigs('u1', { id: 'u1', role: 'user' })).rejects.toThrow(
      'invalid API-issued grant name',
    );
    expect(mockCallStaraApi).toHaveBeenCalledTimes(1);
  });

  it('does not expand viewer grants from deployment configuration', async () => {
    process.env.STARA_MCP_BASELINE_GRANTS = 'stara.engineering.approve,stara.connectors.execute';
    mockRegistry.isDynamicServerManagementEnabled.mockReturnValue(false);
    getAppConfig.mockResolvedValue({ mcpConfig: {} });
    mockRegistry.ensureConfigServers.mockResolvedValue({});
    mockRegistry.getAllServerConfigs.mockResolvedValue({
      'stara-control-plane': { type: 'http', url: 'http://stara-mcp:3083/mcp' },
    });
    mockCallStaraApi.mockResolvedValue({
      user: { id: 'canonical-user-1' },
      memberships: [
        {
          tenant_key: 'tenant-1',
          membership_status: 'active',
          role_key: 'viewer',
          scope_ids: ['org:acme'],
          mcp_grants: ['stara.memory.read', 'stara.engineering.read', 'stara.connectors.read'],
        },
      ],
      assurance: { email_verified: true, mfa_enrolled: true },
    });

    const result = await resolveAllMcpConfigs('u1', { id: 'u1', role: 'user' });

    expect(result['stara-control-plane'].headers['x-stara-grants']).toBe(
      'stara.memory.read,stara.engineering.read,stara.connectors.read',
    );
    delete process.env.STARA_MCP_BASELINE_GRANTS;
  });

  it('fails closed without an active scoped canonical membership', async () => {
    mockRegistry.isDynamicServerManagementEnabled.mockReturnValue(false);
    getAppConfig.mockResolvedValue({ mcpConfig: {} });
    mockRegistry.ensureConfigServers.mockResolvedValue({});
    mockRegistry.getAllServerConfigs.mockResolvedValue({
      'stara-control-plane': { type: 'http', url: 'http://stara-mcp:3083/mcp' },
    });
    mockCallStaraApi.mockResolvedValue({
      user: { id: 'canonical-user-1' },
      memberships: [],
      assurance: { email_verified: true, mfa_enrolled: true },
    });

    await expect(resolveAllMcpConfigs('u1', { id: 'u1', role: 'user' })).rejects.toThrow(
      'active membership with assigned scopes',
    );
  });
});
