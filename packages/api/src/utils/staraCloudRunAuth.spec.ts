const mockGetRequestHeaders = jest.fn();
const mockGetIdTokenClient = jest.fn();

jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({
    getIdTokenClient: (...args: unknown[]) => mockGetIdTokenClient(...args),
  })),
}));

import {
  getStaraCloudRunIdentityHeaders,
  normalizeStaraCloudRunAudience,
  resetStaraCloudRunAuthForTesting,
  validateStaraCloudRunAudience,
} from './staraCloudRunAuth';

const ORIGINAL_GATEWAY_AUDIENCE = process.env.STARA_GATEWAY_AUDIENCE;
const ORIGINAL_MCP_AUDIENCE = process.env.STARA_MCP_AUDIENCE;

describe('Stara Cloud Run identity', () => {
  beforeEach(() => {
    resetStaraCloudRunAuthForTesting();
    jest.clearAllMocks();
    delete process.env.STARA_GATEWAY_AUDIENCE;
    delete process.env.STARA_MCP_AUDIENCE;
    mockGetRequestHeaders.mockResolvedValue({
      Authorization: 'Bearer header.payload.signature',
    });
    mockGetIdTokenClient.mockResolvedValue({ getRequestHeaders: mockGetRequestHeaders });
  });

  afterAll(() => {
    if (ORIGINAL_GATEWAY_AUDIENCE == null) {
      delete process.env.STARA_GATEWAY_AUDIENCE;
    } else {
      process.env.STARA_GATEWAY_AUDIENCE = ORIGINAL_GATEWAY_AUDIENCE;
    }
    if (ORIGINAL_MCP_AUDIENCE == null) {
      delete process.env.STARA_MCP_AUDIENCE;
    } else {
      process.env.STARA_MCP_AUDIENCE = ORIGINAL_MCP_AUDIENCE;
    }
  });

  it('accepts only origin-shaped HTTPS audiences that match the service URL', () => {
    expect(
      normalizeStaraCloudRunAudience('https://gateway.example.run.app/', 'STARA_GATEWAY_AUDIENCE'),
    ).toBe('https://gateway.example.run.app');
    expect(
      validateStaraCloudRunAudience(
        'https://gateway.example.run.app/v1',
        'https://gateway.example.run.app',
        'STARA_GATEWAY_AUDIENCE',
      ),
    ).toBe('https://gateway.example.run.app');
    expect(() =>
      normalizeStaraCloudRunAudience(
        'https://gateway.example.run.app/v1',
        'STARA_GATEWAY_AUDIENCE',
      ),
    ).toThrow('HTTPS origin');
    expect(() =>
      validateStaraCloudRunAudience(
        'https://gateway.example.run.app/v1',
        'https://other.example.run.app',
        'STARA_GATEWAY_AUDIENCE',
      ),
    ).toThrow('must match');
  });

  it('does not mint identity locally or for a non-Stara target', async () => {
    await expect(
      getStaraCloudRunIdentityHeaders({
        service: 'gateway',
        targetName: 'Stara Gateway',
        targetUrl: 'http://stara-gateway:3082/v1',
      }),
    ).resolves.toEqual({});

    process.env.STARA_GATEWAY_AUDIENCE = 'https://gateway.example.run.app';
    await expect(
      getStaraCloudRunIdentityHeaders({
        service: 'gateway',
        targetName: 'Other Gateway',
        targetUrl: 'https://attacker.example/v1',
      }),
    ).resolves.toEqual({});
    expect(mockGetIdTokenClient).not.toHaveBeenCalled();
  });

  it('mints a fresh header through a cached audience client', async () => {
    process.env.STARA_GATEWAY_AUDIENCE = 'https://gateway.example.run.app';
    const params = {
      service: 'gateway' as const,
      targetName: 'Stara Gateway',
      targetUrl: 'https://gateway.example.run.app/v1',
    };

    await expect(getStaraCloudRunIdentityHeaders(params)).resolves.toEqual({
      'x-serverless-authorization': 'Bearer header.payload.signature',
    });
    await expect(getStaraCloudRunIdentityHeaders(params)).resolves.toEqual({
      'x-serverless-authorization': 'Bearer header.payload.signature',
    });

    expect(mockGetIdTokenClient).toHaveBeenCalledTimes(1);
    expect(mockGetIdTokenClient).toHaveBeenCalledWith('https://gateway.example.run.app');
    expect(mockGetRequestHeaders).toHaveBeenCalledTimes(2);
  });

  it('fails closed for mismatched destinations and malformed identity tokens', async () => {
    process.env.STARA_MCP_AUDIENCE = 'https://mcp.example.run.app';
    await expect(
      getStaraCloudRunIdentityHeaders({
        service: 'mcp',
        targetName: 'stara-control-plane',
        targetUrl: 'https://other.example.run.app/mcp',
      }),
    ).rejects.toThrow('STARA_MCP_AUDIENCE must match');

    mockGetRequestHeaders.mockResolvedValueOnce({ Authorization: 'Bearer opaque-token' });
    await expect(
      getStaraCloudRunIdentityHeaders({
        service: 'mcp',
        targetName: 'stara-control-plane',
        targetUrl: 'https://mcp.example.run.app/mcp',
      }),
    ).rejects.toThrow('invalid stara-control-plane audience token');
  });
});
