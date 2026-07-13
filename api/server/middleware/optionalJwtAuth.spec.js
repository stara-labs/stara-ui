let mockIdentityPlatformEnabled = false;
let mockCanonicalIdentityEnabled = false;
const mockResolveCanonicalRequestUser = jest.fn(async (user) => user);
const mockRunWithCanonicalRequestUser = jest.fn((_user, callback) => callback());
const mockTenantContextMiddleware = jest.fn((_req, _res, next) => next());

jest.mock('passport', () => ({
  _strategy: jest.fn(() => ({})),
  authenticate: jest.fn((strategy, _options, callback) => (req, res, next) => {
    const result = req._mockStrategies?.[strategy] ?? {};
    return callback(
      result.err ?? null,
      result.user ?? false,
      result.info,
      result.status,
      req,
      res,
      next,
    );
  }),
}));

jest.mock('@librechat/api', () => ({
  isEnabled: (value) => /^(1|true|yes|on)$/i.test(String(value ?? '')),
  tenantContextMiddleware: (...args) => mockTenantContextMiddleware(...args),
}));

jest.mock('~/server/services/StaraApiClient', () => ({
  isCanonicalIdentityContextEnabled: () => mockCanonicalIdentityEnabled,
  resolveCanonicalRequestUser: (...args) => mockResolveCanonicalRequestUser(...args),
  runWithCanonicalRequestUser: (...args) => mockRunWithCanonicalRequestUser(...args),
}));

jest.mock('~/server/services/IdentityPlatformService', () => ({
  identityPlatformAuthEnabled: () => mockIdentityPlatformEnabled,
}));

const passport = require('passport');
const optionalJwtAuth = require('./optionalJwtAuth');

describe('optionalJwtAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIdentityPlatformEnabled = false;
    mockCanonicalIdentityEnabled = false;
    mockResolveCanonicalRequestUser.mockImplementation(async (user) => user);
  });

  it('uses Identity Platform and establishes canonical request context when enabled', async () => {
    mockIdentityPlatformEnabled = true;
    mockCanonicalIdentityEnabled = true;
    const user = { id: 'identity-user-1', email: 'owner@example.com' };
    const req = {
      headers: { authorization: 'Bearer token' },
      _mockStrategies: { identityPlatformJwt: { user } },
    };
    const next = jest.fn();

    await optionalJwtAuth(req, {}, next);

    expect(passport.authenticate).toHaveBeenCalledWith(
      'identityPlatformJwt',
      { session: false },
      expect.any(Function),
    );
    expect(mockResolveCanonicalRequestUser).toHaveBeenCalledWith(user);
    expect(mockRunWithCanonicalRequestUser).toHaveBeenCalledWith(user, expect.any(Function));
    expect(req.authStrategy).toBe('identityPlatformJwt');
    expect(mockTenantContextMiddleware).toHaveBeenCalled();
  });

  it('does not fall back to a legacy JWT when optional Identity Platform auth fails', async () => {
    mockIdentityPlatformEnabled = true;
    const req = {
      headers: { authorization: 'Bearer invalid' },
      _mockStrategies: {
        identityPlatformJwt: { user: false },
        jwt: { user: { id: 'legacy-user' } },
      },
    };
    const next = jest.fn();

    await optionalJwtAuth(req, {}, next);

    expect(passport.authenticate).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('retains the legacy JWT path while cutover mode is disabled', async () => {
    const user = { id: 'legacy-user' };
    const req = { headers: {}, _mockStrategies: { jwt: { user } } };

    await optionalJwtAuth(req, {}, jest.fn());

    expect(passport.authenticate).toHaveBeenCalledWith(
      'jwt',
      { session: false },
      expect.any(Function),
    );
    expect(req.user).toBe(user);
  });
});
