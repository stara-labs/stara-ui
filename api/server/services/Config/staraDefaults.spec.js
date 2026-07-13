const {
  STARA_GATEWAY_ENDPOINT_NAME,
  STARA_GATEWAY_SPEC_NAME,
  STARA_MCP_SERVER_NAME,
  applyStaraControlPlaneDefaults,
} = require('./staraDefaults');

describe('applyStaraControlPlaneDefaults', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.STARA_GATEWAY_URL;
    delete process.env.STARA_GATEWAY_API_KEY;
    delete process.env.STARA_MCP_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns config unchanged when Stara service URLs are not configured', () => {
    const config = { interface: { modelSelect: false } };

    expect(applyStaraControlPlaneDefaults(config)).toBe(config);
  });

  it('adds the Stara Gateway custom endpoint and soft default model spec', () => {
    process.env.STARA_GATEWAY_URL = 'http://stara-gateway:3082';

    const result = applyStaraControlPlaneDefaults({});

    expect(result.endpoints.custom).toEqual([
      expect.objectContaining({
        name: STARA_GATEWAY_ENDPOINT_NAME,
        apiKey: 'stara-local-dev-key',
        baseURL: 'http://stara-gateway:3082/v1',
        modelDisplayLabel: 'Stara Gateway',
      }),
    ]);
    expect(result.endpoints.allowedAddresses).toContain('stara-gateway:3082');
    expect(result.interface.modelSelect).toBe(true);
    expect(result.modelSpecs.list).toEqual([
      expect.objectContaining({
        name: STARA_GATEWAY_SPEC_NAME,
        softDefault: true,
        preset: {
          endpoint: STARA_GATEWAY_ENDPOINT_NAME,
          model: 'stara-frontier-mock',
        },
        mcpServers: [STARA_MCP_SERVER_NAME],
      }),
    ]);
  });

  it('adds the Stara MCP server and pinned MCP prompt control', () => {
    process.env.STARA_MCP_URL = 'http://stara-mcp:3083/';

    const result = applyStaraControlPlaneDefaults({});

    expect(result.mcpSettings.allowedAddresses).toContain('stara-mcp:3083');
    expect(result.interface.defaultPinnedTools).toEqual(['mcp', STARA_MCP_SERVER_NAME]);
    expect(result.interface.mcpServers).toEqual({
      use: true,
      create: false,
      share: false,
      public: false,
    });
    expect(result.mcpServers[STARA_MCP_SERVER_NAME]).toEqual(
      expect.objectContaining({
        title: 'Stara Control Plane',
        type: 'http',
        url: 'http://stara-mcp:3083/mcp',
        chatMenu: true,
        startup: false,
      }),
    );
  });

  it('does not duplicate configured Stara entries', () => {
    process.env.STARA_GATEWAY_URL = 'http://stara-gateway:3082';
    process.env.STARA_MCP_URL = 'http://stara-mcp:3083';

    const result = applyStaraControlPlaneDefaults({
      endpoints: {
        custom: [
          {
            name: STARA_GATEWAY_ENDPOINT_NAME,
            apiKey: 'custom',
            baseURL: 'https://example.test/v1',
          },
        ],
        allowedAddresses: ['stara-gateway:3082'],
      },
      interface: {
        defaultPinnedTools: ['mcp'],
        mcpServers: { create: true },
      },
      modelSpecs: {
        list: [
          {
            name: STARA_GATEWAY_SPEC_NAME,
            label: 'Custom',
            preset: { endpoint: 'Custom', model: 'x' },
          },
        ],
      },
      mcpServers: {
        [STARA_MCP_SERVER_NAME]: { type: 'http', url: 'https://mcp.example.test/mcp' },
      },
    });

    expect(result.endpoints.custom).toHaveLength(1);
    expect(result.endpoints.allowedAddresses).toEqual(['stara-gateway:3082']);
    expect(result.interface.defaultPinnedTools).toEqual(['mcp', STARA_MCP_SERVER_NAME]);
    expect(result.interface.mcpServers.create).toBe(true);
    expect(result.modelSpecs.list).toHaveLength(1);
    expect(result.mcpServers[STARA_MCP_SERVER_NAME].url).toBe('https://mcp.example.test/mcp');
  });
});
