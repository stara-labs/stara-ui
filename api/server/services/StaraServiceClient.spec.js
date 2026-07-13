const fetch = require('node-fetch');

jest.mock('node-fetch', () => jest.fn());

const { callStaraApiPublic } = require('./StaraServiceClient');

describe('StaraServiceClient public service calls', () => {
  const previousUrl = process.env.STARA_API_URL;
  const previousToken = process.env.STARA_API_TOKEN;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STARA_API_URL = 'http://stara-api:3081/';
    process.env.STARA_API_TOKEN = 'service-token';
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
        Authorization: 'Bearer service-token',
      },
      body: JSON.stringify({ email: 'user@example.com' }),
    });
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
