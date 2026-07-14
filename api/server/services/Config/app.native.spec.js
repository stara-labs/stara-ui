let capturedOptions;
const mockGetApplicableConfigs = jest.fn();
const mockGetUserPrincipals = jest.fn();

jest.mock('librechat-data-provider', () => ({ CacheKeys: {} }));
jest.mock('@librechat/data-schemas', () => ({
  AppService: jest.fn(),
  logger: { error: jest.fn() },
}));
jest.mock('@librechat/api', () => ({
  clearMcpConfigCache: jest.fn(),
  createAppConfigService: jest.fn((options) => {
    capturedOptions = options;
    return {
      clearAppConfigCache: jest.fn(),
      clearOverrideCache: jest.fn(),
      getAppConfig: jest.fn(),
    };
  }),
}));
jest.mock('./getCachedTools', () => ({
  invalidateCachedTools: jest.fn(),
  setCachedTools: jest.fn(),
}));
jest.mock('~/server/services/start/tools', () => ({ loadAndFormatTools: jest.fn() }));
jest.mock('./loadCustomConfig', () => jest.fn());
jest.mock('./staraDefaults', () => ({ applyStaraControlPlaneDefaults: jest.fn() }));
jest.mock('~/cache/getLogStores', () => jest.fn());
jest.mock('~/config/paths', () => ({}));
jest.mock('~/models', () => ({
  getApplicableConfigs: (...args) => mockGetApplicableConfigs(...args),
  getUserPrincipals: (...args) => mockGetUserPrincipals(...args),
}));
jest.mock('~/server/services/StaraNativeRuntime', () => ({
  staraNativeRuntimeEnabled: () => true,
}));

describe('native application configuration', () => {
  beforeAll(() => {
    require('./app');
  });

  test('uses deployment config without querying Mongo principal overrides', async () => {
    await expect(capturedOptions.getApplicableConfigs()).resolves.toEqual([]);
    await expect(capturedOptions.getUserPrincipals()).resolves.toEqual([]);
    expect(mockGetApplicableConfigs).not.toHaveBeenCalled();
    expect(mockGetUserPrincipals).not.toHaveBeenCalled();
  });
});
