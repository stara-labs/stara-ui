const STARA_GATEWAY_ENDPOINT_NAME = 'Stara Gateway';
const STARA_GATEWAY_SPEC_NAME = 'stara-gateway-default';
const STARA_MCP_SERVER_NAME = 'stara-control-plane';

const PRODUCTION_STARA_MODELS = ['stara-memory-direct'];
const LOCAL_STARA_MODELS = ['stara-frontier-mock', 'stara-memory-direct', 'stara-secure-llama'];

function staraModels() {
  const environment = String(process.env.STARA_ENV ?? process.env.NODE_ENV ?? '')
    .trim()
    .toLowerCase();
  return ['local', 'development', 'test'].includes(environment)
    ? LOCAL_STARA_MODELS
    : PRODUCTION_STARA_MODELS;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function resolveUrl(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return trimTrailingSlash(value.trim());
}

function openAIBaseUrl(url) {
  if (!url) {
    return '';
  }
  return url.endsWith('/v1') ? url : `${url}/v1`;
}

function hostPort(url) {
  try {
    const parsed = new URL(url);
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    return `${parsed.hostname}:${port}`;
  } catch {
    return '';
  }
}

function appendUnique(values, value) {
  if (!value) {
    return values;
  }
  return values.includes(value) ? values : [...values, value];
}

function hasEndpoint(endpoints, name) {
  return endpoints.some((endpoint) => endpoint?.name === name);
}

function hasSpec(specs, name) {
  return specs.some((spec) => spec?.name === name);
}

function applyGatewayDefaults(config, gatewayUrl) {
  if (!gatewayUrl) {
    return config;
  }
  const models = staraModels();

  const custom = config.endpoints?.custom ?? [];
  const customWithGateway = hasEndpoint(custom, STARA_GATEWAY_ENDPOINT_NAME)
    ? custom
    : [
        ...custom,
        {
          name: STARA_GATEWAY_ENDPOINT_NAME,
          apiKey: process.env.STARA_GATEWAY_API_KEY || 'stara-local-dev-key',
          baseURL: openAIBaseUrl(gatewayUrl),
          models: {
            default: models,
            fetch: true,
          },
          titleConvo: false,
          summarize: false,
          modelDisplayLabel: 'Stara Gateway',
        },
      ];

  const allowedAddresses = appendUnique(
    config.endpoints?.allowedAddresses ?? [],
    hostPort(gatewayUrl),
  );
  const specs = config.modelSpecs?.list ?? [];
  const specWithGateway = hasSpec(specs, STARA_GATEWAY_SPEC_NAME)
    ? specs
    : [
        ...specs,
        {
          name: STARA_GATEWAY_SPEC_NAME,
          label: 'Stara Gateway',
          description: 'Policy-routed Stara control-plane model path.',
          group: 'Stara',
          groupIcon: 'openAI',
          softDefault: !specs.some((spec) => spec?.default === true || spec?.softDefault === true),
          preset: {
            endpoint: STARA_GATEWAY_ENDPOINT_NAME,
            model: models[0],
          },
          mcpServers: [STARA_MCP_SERVER_NAME],
        },
      ];

  return {
    ...config,
    endpoints: {
      ...config.endpoints,
      custom: customWithGateway,
      allowedAddresses,
    },
    interface: {
      ...config.interface,
      modelSelect: config.interface?.modelSelect ?? true,
    },
    modelSpecs: {
      ...config.modelSpecs,
      prioritize: config.modelSpecs?.prioritize ?? true,
      list: specWithGateway,
    },
  };
}

function applyMcpDefaults(config, mcpUrl) {
  if (!mcpUrl) {
    return config;
  }

  const allowedAddresses = appendUnique(
    config.mcpSettings?.allowedAddresses ?? [],
    hostPort(mcpUrl),
  );
  const defaultPinnedTools = appendUnique(
    appendUnique(config.interface?.defaultPinnedTools ?? [], 'mcp'),
    STARA_MCP_SERVER_NAME,
  );

  return {
    ...config,
    interface: {
      ...config.interface,
      defaultPinnedTools,
      mcpServers: {
        use: true,
        create: false,
        share: false,
        public: false,
        ...config.interface?.mcpServers,
      },
    },
    mcpSettings: {
      ...config.mcpSettings,
      allowedAddresses,
    },
    mcpServers: {
      ...config.mcpServers,
      [STARA_MCP_SERVER_NAME]: {
        title: 'Stara Control Plane',
        description: 'Stara memory, context, and governance tools.',
        type: 'http',
        url: `${mcpUrl}/mcp`,
        chatMenu: true,
        timeout: 60000,
        ...config.mcpServers?.[STARA_MCP_SERVER_NAME],
        startup: false,
      },
    },
  };
}

function applyStaraControlPlaneDefaults(rawConfig = {}) {
  const gatewayUrl = resolveUrl(process.env.STARA_GATEWAY_URL);
  const mcpUrl = resolveUrl(process.env.STARA_MCP_URL);

  if (!gatewayUrl && !mcpUrl) {
    return rawConfig;
  }

  return applyMcpDefaults(applyGatewayDefaults({ ...rawConfig }, gatewayUrl), mcpUrl);
}

module.exports = {
  STARA_GATEWAY_ENDPOINT_NAME,
  STARA_GATEWAY_SPEC_NAME,
  STARA_MCP_SERVER_NAME,
  applyStaraControlPlaneDefaults,
};
