const mockCallStaraApiPublic = jest.fn();
let mockIdentityPlatformEnabled = true;

jest.mock('~/server/services/IdentityPlatformService', () => ({
  identityPlatformAuthEnabled: () => mockIdentityPlatformEnabled,
}));

jest.mock('~/server/services/StaraServiceClient', () => ({
  callStaraApiPublic: (...args) => mockCallStaraApiPublic(...args),
  normalizeEmail: (value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''),
  safeString: (value, fallback, maxLength = 512) =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback,
}));

const { checkIdentityPlatformSignupEligibility } = require('./IdentityPlatformAuthController');

const response = () => {
  const res = {
    statusCode: 200,
    payload: undefined,
    status: jest.fn((statusCode) => {
      res.statusCode = statusCode;
      return res;
    }),
    json: jest.fn((payload) => {
      res.payload = payload;
      return res;
    }),
  };
  return res;
};

describe('IdentityPlatformAuthController', () => {
  const previousAllowRegistration = process.env.ALLOW_REGISTRATION;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIdentityPlatformEnabled = true;
    process.env.ALLOW_REGISTRATION = 'true';
  });

  afterAll(() => {
    if (previousAllowRegistration === undefined) {
      delete process.env.ALLOW_REGISTRATION;
    } else {
      process.env.ALLOW_REGISTRATION = previousAllowRegistration;
    }
  });

  it('normalizes and forwards only signup eligibility fields', async () => {
    mockCallStaraApiPublic.mockResolvedValue({
      eligible: true,
      method: 'invitation',
    });
    const res = response();

    await checkIdentityPlatformSignupEligibility(
      { body: { email: '  User@Partner.Test ', invite_token: 'i'.repeat(24), ignored: 'value' } },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ eligible: true, method: 'invitation' });
    expect(mockCallStaraApiPublic).toHaveBeenCalledWith('/v1/signup/eligibility', {
      method: 'POST',
      body: { email: 'user@partner.test', invite_token: 'i'.repeat(24) },
    });
  });

  it('rejects invalid email before calling the canonical API', async () => {
    const res = response();

    await checkIdentityPlatformSignupEligibility({ body: { email: 'invalid' } }, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload).toMatchObject({ error: 'invalid_email' });
    expect(mockCallStaraApiPublic).not.toHaveBeenCalled();
  });

  it('passes bounded canonical denials through without exposing details', async () => {
    mockCallStaraApiPublic.mockRejectedValue(
      Object.assign(new Error('Email domain is not allowlisted.'), {
        status: 403,
        code: 'signup_not_allowlisted',
      }),
    );
    const res = response();

    await checkIdentityPlatformSignupEligibility({ body: { email: 'user@blocked.test' } }, res);

    expect(res.statusCode).toBe(403);
    expect(res.payload).toEqual({
      error: 'signup_not_allowlisted',
      message: 'Email domain is not allowlisted.',
    });
  });

  it('is unavailable when Identity Platform auth is disabled', async () => {
    mockIdentityPlatformEnabled = false;
    const res = response();

    await checkIdentityPlatformSignupEligibility({ body: { email: 'user@example.com' } }, res);

    expect(res.statusCode).toBe(404);
    expect(mockCallStaraApiPublic).not.toHaveBeenCalled();
  });

  it('is unavailable when self-service registration is disabled', async () => {
    process.env.ALLOW_REGISTRATION = 'false';
    const res = response();

    await checkIdentityPlatformSignupEligibility({ body: { email: 'user@example.com' } }, res);

    expect(res.statusCode).toBe(404);
    expect(mockCallStaraApiPublic).not.toHaveBeenCalled();
  });
});
