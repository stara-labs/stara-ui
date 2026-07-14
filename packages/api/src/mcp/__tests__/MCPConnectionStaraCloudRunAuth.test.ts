const mockGetStaraCloudRunIdentityHeaders = jest.fn();

jest.mock('~/utils/staraCloudRunAuth', () => ({
  getStaraCloudRunIdentityHeaders: (...args: unknown[]) =>
    mockGetStaraCloudRunIdentityHeaders(...args),
}));

import { MCPConnection } from '~/mcp/connection';

type ConnectionWithTransportHeaders = {
  getTransportRequestHeaders(targetUrl: string): Promise<Record<string, string>>;
};

describe('MCPConnection Stara Cloud Run identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStaraCloudRunIdentityHeaders.mockResolvedValue({
      'x-serverless-authorization': 'Bearer header.payload.signature',
    });
  });

  it('adds refreshed Cloud Run identity after configured request headers', async () => {
    const connection = new MCPConnection({
      serverName: 'stara-control-plane',
      serverConfig: {
        type: 'streamable-http',
        url: 'https://mcp.example.run.app/mcp',
      },
    });
    connection.setRequestHeaders({
      'X-Tenant': 'tenant-a',
      'X-Serverless-Authorization': 'Bearer config-must-not-win',
    });

    const headers = await (
      connection as unknown as ConnectionWithTransportHeaders
    ).getTransportRequestHeaders('https://mcp.example.run.app/mcp');

    expect(headers).toEqual({
      'x-tenant': 'tenant-a',
      'x-serverless-authorization': 'Bearer header.payload.signature',
    });
    expect(mockGetStaraCloudRunIdentityHeaders).toHaveBeenCalledWith({
      service: 'mcp',
      targetName: 'stara-control-plane',
      targetUrl: 'https://mcp.example.run.app/mcp',
    });
  });
});
