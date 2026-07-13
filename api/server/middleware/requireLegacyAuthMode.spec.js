const mockIdentityPlatformAuthEnabled = jest.fn();

jest.mock('~/server/services/IdentityPlatformService', () => ({
  identityPlatformAuthEnabled: (...args) => mockIdentityPlatformAuthEnabled(...args),
}));

const requireLegacyAuthMode = require('./requireLegacyAuthMode');

describe('requireLegacyAuthMode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('allows inherited authentication routes before the cutover', () => {
    mockIdentityPlatformAuthEnabled.mockReturnValue(false);
    const next = jest.fn();

    requireLegacyAuthMode({}, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('retires inherited authentication routes after the cutover', () => {
    mockIdentityPlatformAuthEnabled.mockReturnValue(true);
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    requireLegacyAuthMode({}, response, jest.fn());

    expect(response.status).toHaveBeenCalledWith(410);
    expect(response.json).toHaveBeenCalledWith({
      error: 'identity_platform_auth_required',
      message: 'This authentication operation is managed by Google Identity Platform.',
    });
  });
});
