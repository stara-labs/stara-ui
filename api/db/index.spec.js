describe('api/db/index.js', () => {
  const originalNativeRuntime = process.env.STARA_NATIVE_RUNTIME;

  afterEach(() => {
    if (originalNativeRuntime == null) {
      delete process.env.STARA_NATIVE_RUNTIME;
    } else {
      process.env.STARA_NATIVE_RUNTIME = originalNativeRuntime;
    }
  });

  test('createModels is called before indexSync is loaded', () => {
    jest.resetModules();
    process.env.STARA_NATIVE_RUNTIME = 'false';

    const callOrder = [];

    jest.mock('@librechat/data-schemas', () => ({
      createModels: jest.fn((m) => {
        callOrder.push('createModels');
        m.models.Message = { name: 'Message' };
        m.models.Conversation = { name: 'Conversation' };
      }),
    }));

    jest.mock('./indexSync', () => {
      callOrder.push('indexSync');
      return jest.fn();
    });

    jest.mock('./connect', () => ({ connectDb: jest.fn() }));

    require('./index');

    expect(callOrder).toEqual(['createModels', 'indexSync']);
  });

  test('native mode registers compatibility models without loading Meili sync', async () => {
    jest.resetModules();
    process.env.STARA_NATIVE_RUNTIME = 'true';

    const callOrder = [];

    jest.mock('@librechat/data-schemas', () => ({
      createModels: jest.fn(() => callOrder.push('createModels')),
    }));
    jest.mock('./indexSync', () => {
      callOrder.push('indexSync');
      return jest.fn();
    });
    jest.mock('./connect', () => ({ connectDb: jest.fn() }));

    const { indexSync } = require('./index');

    await expect(indexSync()).resolves.toBeUndefined();
    expect(callOrder).toEqual(['createModels']);
  });
});
