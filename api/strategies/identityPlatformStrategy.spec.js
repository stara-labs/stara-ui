const mockVerifyIdentityPlatformToken = jest.fn();

jest.mock('~/server/services/IdentityPlatformService', () => ({
  verifyIdentityPlatformToken: (...args) => mockVerifyIdentityPlatformToken(...args),
}));

const { IdentityPlatformStrategy, bearerToken } = require('./identityPlatformStrategy');

describe('identityPlatformStrategy', () => {
  beforeEach(() => jest.clearAllMocks());

  it('extracts a strict bearer token', () => {
    expect(bearerToken({ headers: { authorization: 'Bearer token-value' } })).toBe('token-value');
    expect(bearerToken({ headers: { authorization: 'Basic token-value' } })).toBeUndefined();
    expect(bearerToken({ headers: { authorization: 'Bearer two values' } })).toBeUndefined();
  });

  it('authenticates a verified Identity Platform principal', async () => {
    const principal = { id: 'identity-user-1', email: 'owner@example.com' };
    mockVerifyIdentityPlatformToken.mockResolvedValue(principal);
    const strategy = harness();

    await strategy.authenticate({ headers: { authorization: 'Bearer verified-token' } });

    expect(mockVerifyIdentityPlatformToken).toHaveBeenCalledWith('verified-token');
    expect(strategy.success).toHaveBeenCalledWith(principal);
    expect(strategy.fail).not.toHaveBeenCalled();
  });

  it('returns a generic 401 for missing or invalid credentials', async () => {
    const missing = harness();
    await missing.authenticate({ headers: {} });
    expect(missing.fail).toHaveBeenCalledWith({ message: 'Unauthorized' }, 401);

    mockVerifyIdentityPlatformToken.mockRejectedValueOnce(new Error('token details'));
    const invalid = harness();
    await invalid.authenticate({ headers: { authorization: 'Bearer invalid-token' } });
    expect(invalid.fail).toHaveBeenCalledWith({ message: 'Unauthorized' }, 401);
  });

  it('surfaces server configuration failures without exposing them as auth details', async () => {
    const failure = Object.assign(new Error('Identity Platform project ID is required'), {
      status: 503,
    });
    mockVerifyIdentityPlatformToken.mockRejectedValueOnce(failure);
    const strategy = harness();

    await strategy.authenticate({ headers: { authorization: 'Bearer token' } });

    expect(strategy.error).toHaveBeenCalledWith(failure);
    expect(strategy.fail).not.toHaveBeenCalled();
  });
});

function harness() {
  const strategy = new IdentityPlatformStrategy();
  strategy.success = jest.fn();
  strategy.fail = jest.fn();
  strategy.error = jest.fn();
  return strategy;
}
