const {
  disableDotenvFileLoadingForNativeRuntime,
  readBoolean,
  staraNativeRuntimeEnabled,
  validateStaraNativeRuntime,
} = require('./StaraNativeRuntime');

const validEnvironment = () => ({
  STARA_API_URL: 'http://stara-api:3081',
  STARA_CANONICAL_MCP_SERVERS: 'true',
  STARA_CANONICAL_WORKSPACE: 'true',
  STARA_IDENTITY_PLATFORM_AUTH: 'true',
  STARA_LEGACY_FILE_READ_FALLBACK: 'false',
  STARA_NATIVE_RUNTIME: 'true',
});

describe('StaraNativeRuntime', () => {
  test('is opt-in and leaves the legacy runtime unchanged when disabled', () => {
    expect(staraNativeRuntimeEnabled({})).toBe(false);
    expect(
      validateStaraNativeRuntime({
        MONGO_URI: 'mongodb://mongo/LibreChat',
        STARA_NATIVE_RUNTIME: 'false',
      }),
    ).toBe(false);
  });

  test('accepts a canonical runtime with no external legacy state', () => {
    expect(validateStaraNativeRuntime(validEnvironment())).toBe(true);
  });

  test('accepts only a matching HTTPS Cloud Run API audience', () => {
    expect(
      validateStaraNativeRuntime({
        ...validEnvironment(),
        STARA_API_URL: 'https://api.example.run.app',
        STARA_API_AUDIENCE: 'https://api.example.run.app/',
      }),
    ).toBe(true);
    expect(() =>
      validateStaraNativeRuntime({
        ...validEnvironment(),
        STARA_API_URL: 'https://api.example.run.app',
        STARA_API_AUDIENCE: 'https://other.example.run.app',
      }),
    ).toThrow('must match');
    expect(() =>
      validateStaraNativeRuntime({
        ...validEnvironment(),
        STARA_API_URL: 'https://api.example.run.app',
        STARA_API_AUDIENCE: 'http://api.example.run.app',
      }),
    ).toThrow('HTTPS origin');
  });

  test('blocks inherited packages from loading a legacy dotenv file', () => {
    const originalConfig = jest.fn();
    const dotenvModule = { config: originalConfig };

    expect(disableDotenvFileLoadingForNativeRuntime(validEnvironment(), dotenvModule)).toBe(true);
    expect(dotenvModule.config()).toEqual({ parsed: {} });
    expect(originalConfig).not.toHaveBeenCalled();
  });

  test('leaves dotenv unchanged for the legacy runtime', () => {
    const originalConfig = jest.fn();
    const dotenvModule = { config: originalConfig };

    expect(
      disableDotenvFileLoadingForNativeRuntime({ STARA_NATIVE_RUNTIME: 'false' }, dotenvModule),
    ).toBe(false);
    dotenvModule.config();
    expect(originalConfig).toHaveBeenCalledTimes(1);
  });

  test.each([
    'STARA_API_URL',
    'STARA_CANONICAL_MCP_SERVERS',
    'STARA_CANONICAL_WORKSPACE',
    'STARA_IDENTITY_PLATFORM_AUTH',
    'STARA_LEGACY_FILE_READ_FALLBACK',
  ])('requires %s for native startup', (name) => {
    const env = validEnvironment();
    delete env[name];

    expect(() => validateStaraNativeRuntime(env)).toThrow(name);
  });

  test.each([
    'STARA_CANONICAL_AGENTS',
    'STARA_CANONICAL_FILES',
    'STARA_CANONICAL_IDENTITY_CONTEXT',
    'STARA_CANONICAL_PROMPTS',
    'STARA_CANONICAL_SKILLS',
  ])('rejects an explicit %s opt-out', (name) => {
    const env = { ...validEnvironment(), [name]: 'false' };

    expect(() => validateStaraNativeRuntime(env)).toThrow(name);
  });

  test.each(['MONGO_URI', 'MEILI_HOST', 'MEILI_MASTER_KEY', 'RAG_API_URL', 'REDIS_URI'])(
    'rejects the legacy endpoint %s',
    (name) => {
      const env = { ...validEnvironment(), [name]: 'http://legacy.example' };

      expect(() => validateStaraNativeRuntime(env)).toThrow(name);
    },
  );

  test.each(['USE_REDIS', 'USE_REDIS_CLUSTER', 'USE_REDIS_STREAMS'])(
    'rejects the legacy feature flag %s',
    (name) => {
      const env = { ...validEnvironment(), [name]: 'true' };

      expect(() => validateStaraNativeRuntime(env)).toThrow(name);
    },
  );

  test('rejects malformed booleans and API URLs', () => {
    expect(() => readBoolean('FLAG', { FLAG: 'sometimes' })).toThrow('FLAG must be true or false');
    expect(() =>
      validateStaraNativeRuntime({ ...validEnvironment(), STARA_API_URL: 'postgres://stara' }),
    ).toThrow('must use http or https');
  });
});
