const fetch = require('node-fetch');

jest.mock('node-fetch', () => jest.fn());
const mockGetRequestHeaders = jest.fn();
const mockGetIdTokenClient = jest.fn(async () => ({
  getRequestHeaders: mockGetRequestHeaders,
}));
jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn(() => ({ getIdTokenClient: mockGetIdTokenClient })),
}));

const { callStaraApiPublic } = require('./StaraServiceClient');

describe('StaraServiceClient public service calls', () => {
  const previousUrl = process.env.STARA_API_URL;
  const previousToken = process.env.STARA_API_TOKEN;
  const previousAudience = process.env.STARA_API_AUDIENCE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STARA_API_URL = 'http://stara-api:3081/';
    process.env.STARA_API_TOKEN = 'service-token';
    delete process.env.STARA_API_AUDIENCE;
  });

  afterAll(() => {
    if (previousUrl === undefined) {
      delete process.env.STARA_API_URL;
    } else {
      process.env.STARA_API_URL = previousUrl;
    }
    if (previousToken === undefined) {
      delete process.env.STARA_API_TOKEN;
    } else {
      process.env.STARA_API_TOKEN = previousToken;
    }
    if (previousAudience === undefined) {
      delete process.env.STARA_API_AUDIENCE;
    } else {
      process.env.STARA_API_AUDIENCE = previousAudience;
    }
  });

  it('forwards only service authentication and the bounded request body', async () => {
    fetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue('{"eligible":true,"method":"allowlisted_domain"}'),
    });

    await expect(
      callStaraApiPublic('/v1/signup/eligibility', {
        method: 'POST',
        body: { email: 'user@example.com' },
      }),
    ).resolves.toEqual({ eligible: true, method: 'allowlisted_domain' });

    expect(fetch).toHaveBeenCalledWith('http://stara-api:3081/v1/signup/eligibility', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-stara-service-token': 'service-token',
      },
      body: JSON.stringify({ email: 'user@example.com' }),
    });
  });

  it('separates private Cloud Run IAM from Stara service authentication', async () => {
    process.env.STARA_API_URL = 'https://api.example.run.app/';
    process.env.STARA_API_AUDIENCE = 'https://api.example.run.app';
    mockGetRequestHeaders.mockResolvedValue({
      Authorization: 'Bearer cloud.api.signature',
    });
    fetch.mockResolvedValue({ ok: true, text: jest.fn().mockResolvedValue('{"eligible":true}') });

    await callStaraApiPublic('/v1/signup/eligibility', {
      method: 'POST',
      body: { email: 'user@example.com' },
    });

    expect(mockGetIdTokenClient).toHaveBeenCalledWith('https://api.example.run.app');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.run.app/v1/signup/eligibility',
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer cloud.api.signature',
          'x-stara-service-token': 'service-token',
        },
      }),
    );
  });

  it('fails closed before transport when the audience does not match the API', async () => {
    process.env.STARA_API_URL = 'https://api.example.run.app';
    process.env.STARA_API_AUDIENCE = 'https://other.example.run.app';

    await expect(callStaraApiPublic('/v1/signup/eligibility')).rejects.toThrow(/must match/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps canonical error status and code without response internals', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: jest
        .fn()
        .mockResolvedValue('{"error":"signup_not_allowlisted","message":"Signup is blocked."}'),
    });

    await expect(
      callStaraApiPublic('/v1/signup/eligibility', {
        method: 'POST',
        body: { email: 'user@blocked.test' },
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'signup_not_allowlisted',
      message: 'Signup is blocked.',
    });
  });
});
