const baseMethods = {
  spendTokens: jest.fn(),
  spendStructuredTokens: jest.fn(),
};

const { createNativeUsageMethods } = require('./nativeUsage');

const originalNativeRuntime = process.env.STARA_NATIVE_RUNTIME;

describe('native usage compatibility methods', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STARA_NATIVE_RUNTIME = 'true';
  });

  afterAll(() => {
    if (originalNativeRuntime == null) {
      delete process.env.STARA_NATIVE_RUNTIME;
    } else {
      process.env.STARA_NATIVE_RUNTIME = originalNativeRuntime;
    }
  });

  it('keeps LibreChat token accounting out of Mongo in the native runtime', async () => {
    const methods = createNativeUsageMethods(baseMethods);

    await expect(methods.spendTokens({ user: 'canonical-user' }, {})).resolves.toBeUndefined();
    await expect(methods.spendStructuredTokens({ user: 'canonical-user' }, {})).resolves.toEqual({
      prompt: undefined,
      completion: undefined,
    });
    expect(baseMethods.spendTokens).not.toHaveBeenCalled();
    expect(baseMethods.spendStructuredTokens).not.toHaveBeenCalled();
  });

  it('preserves the LibreChat accounting methods outside native mode', async () => {
    process.env.STARA_NATIVE_RUNTIME = 'false';
    baseMethods.spendTokens.mockResolvedValue('spent');
    baseMethods.spendStructuredTokens.mockResolvedValue({ prompt: 'spent' });
    const methods = createNativeUsageMethods(baseMethods);

    await expect(methods.spendTokens('tx', 'usage')).resolves.toBe('spent');
    await expect(methods.spendStructuredTokens('tx', 'usage')).resolves.toEqual({
      prompt: 'spent',
    });
    expect(baseMethods.spendTokens).toHaveBeenCalledWith('tx', 'usage');
    expect(baseMethods.spendStructuredTokens).toHaveBeenCalledWith('tx', 'usage');
  });
});
