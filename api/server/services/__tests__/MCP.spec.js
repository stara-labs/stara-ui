const mockRegistry = {
  ensureConfigServers: jest.fn(),
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
  beforeEach(() => jest.clearAllMocks());

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
    process.env.STARA_MCP_BASELINE_GRANTS = 'stara.memory.read';
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
          'x-stara-grants': 'stara.memory.read',
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

  it('fails closed when canonical baseline grants are not configured', async () => {
    mockRegistry.isDynamicServerManagementEnabled.mockReturnValue(false);
    getAppConfig.mockResolvedValue({ mcpConfig: {} });
    mockRegistry.ensureConfigServers.mockResolvedValue({});
    mockRegistry.getAllServerConfigs.mockResolvedValue({
      'stara-control-plane': { type: 'http', url: 'http://stara-mcp:3083/mcp' },
    });

    await expect(resolveAllMcpConfigs('u1', { id: 'u1', role: 'user' })).rejects.toThrow(
      'STARA_MCP_BASELINE_GRANTS is required',
    );
    expect(mockCallStaraApi).not.toHaveBeenCalled();
  });

  it('fails closed when a canonical baseline grant is not header-safe', async () => {
    process.env.STARA_MCP_BASELINE_GRANTS = 'stara.memory.read,invalid grant';
    mockRegistry.isDynamicServerManagementEnabled.mockReturnValue(false);
    getAppConfig.mockResolvedValue({ mcpConfig: {} });
    mockRegistry.ensureConfigServers.mockResolvedValue({});
    mockRegistry.getAllServerConfigs.mockResolvedValue({
      'stara-control-plane': { type: 'http', url: 'http://stara-mcp:3083/mcp' },
    });

    await expect(resolveAllMcpConfigs('u1', { id: 'u1', role: 'user' })).rejects.toThrow(
      'contains an invalid grant name',
    );
    expect(mockCallStaraApi).not.toHaveBeenCalled();
  });

  it('fails closed without an active scoped canonical membership', async () => {
    process.env.STARA_MCP_BASELINE_GRANTS = 'stara.memory.read';
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
