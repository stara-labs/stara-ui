describe('telemetry bootstrap', () => {
  const originalEnv = process.env;
  const mockDotenvConfig = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.OTEL_SDK_DISABLED;
    delete process.env.OTEL_TRACING_ENABLED;
    delete process.env.STARA_NATIVE_RUNTIME;
    jest.doMock('dotenv', () => ({
      config: mockDotenvConfig,
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.dontMock('dotenv');
    jest.dontMock('@librechat/api/telemetry');
    jest.resetModules();
  });

  it('does not load OpenTelemetry packages by default', () => {
    jest.doMock(
      '@librechat/api/telemetry',
      () => {
        throw new Error('telemetry package should not load when tracing is disabled');
      },
      { virtual: true },
    );

    const telemetry = require('./telemetry');

    expect(telemetry.enabled).toBe(false);
    expect(telemetry.status).toBe('disabled');
    expect(mockDotenvConfig).toHaveBeenCalledTimes(1);
  });

  it('does not load a dotenv file in native mode', () => {
    process.env.STARA_NATIVE_RUNTIME = 'true';

    const telemetry = require('./telemetry');

    expect(telemetry.enabled).toBe(false);
    expect(mockDotenvConfig).not.toHaveBeenCalled();
  });

  it('does not load OpenTelemetry packages when the SDK is disabled', () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    process.env.OTEL_TRACING_ENABLED = 'true';
    jest.doMock(
      '@librechat/api/telemetry',
      () => {
        throw new Error('telemetry package should not load when the SDK is disabled');
      },
      { virtual: true },
    );

    const telemetry = require('./telemetry');

    expect(telemetry.enabled).toBe(false);
    expect(telemetry.status).toBe('disabled');
  });

  it('loads and exposes telemetry middleware when tracing is enabled', () => {
    process.env.OTEL_TRACING_ENABLED = 'true';
    let enabled = true;
    let status = 'starting';
    const telemetryMiddleware = jest.fn();
    const telemetryErrorMiddleware = jest.fn();
    const initializeTelemetry = jest.fn(() => ({
      get enabled() {
        return enabled;
      },
      get status() {
        return status;
      },
      shutdown: jest.fn(),
    }));
    jest.doMock(
      '@librechat/api/telemetry',
      () => ({
        initializeTelemetry,
        telemetryMiddleware,
        telemetryErrorMiddleware,
      }),
      { virtual: true },
    );

    const telemetry = require('./telemetry');

    expect(initializeTelemetry).toHaveBeenCalledTimes(1);
    expect(telemetry.enabled).toBe(true);
    expect(telemetry.status).toBe('starting');
    expect(telemetry.telemetryMiddleware).toBe(telemetryMiddleware);
    expect(telemetry.telemetryErrorMiddleware).toBe(telemetryErrorMiddleware);

    enabled = false;
    status = 'failed';
    expect(telemetry.enabled).toBe(false);
    expect(telemetry.status).toBe('failed');
  });
});
