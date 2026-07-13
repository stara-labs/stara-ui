import {
  DisabledServerConfigsRepository,
  DynamicMCPServersDisabledError,
} from '~/mcp/registry/db/DisabledServerConfigsRepository';
import { MCPServersRegistry, canonicalMcpServersEnabled } from '~/mcp/registry/MCPServersRegistry';

jest.mock('~/mcp/registry/db/ServerConfigsDB', () => ({
  ServerConfigsDB: jest.fn().mockImplementation(() => {
    throw new Error('Mongo-backed MCP repository must not be constructed in canonical mode');
  }),
}));

describe('canonical MCP registry mode', () => {
  test('parses only explicit boolean environment values', () => {
    expect(canonicalMcpServersEnabled({})).toBe(false);
    expect(canonicalMcpServersEnabled({ STARA_CANONICAL_MCP_SERVERS: 'true' })).toBe(true);
    expect(canonicalMcpServersEnabled({ STARA_CANONICAL_MCP_SERVERS: '1' })).toBe(true);
    expect(canonicalMcpServersEnabled({ STARA_CANONICAL_MCP_SERVERS: 'false' })).toBe(false);
    expect(() => canonicalMcpServersEnabled({ STARA_CANONICAL_MCP_SERVERS: 'sometimes' })).toThrow(
      'must be true, false, 1, or 0',
    );
  });

  test('does not construct or read the Mongo-backed repository', async () => {
    const registry = new MCPServersRegistry(
      {} as typeof import('mongoose'),
      undefined,
      undefined,
      undefined,
      { disableDatabaseServers: true },
    );

    expect(registry.isDynamicServerManagementEnabled()).toBe(false);
    await expect(registry.getServerConfig('missing', 'user-1')).resolves.toBeUndefined();
    await expect(registry.getAllServerConfigs('user-1')).resolves.toEqual({});
  });

  test('fails closed on every dynamic mutation', async () => {
    const repository = new DisabledServerConfigsRepository();
    const config = { type: 'http' as const, url: 'https://mcp.example.com/mcp' };

    await expect(repository.add('server', config)).rejects.toBeInstanceOf(
      DynamicMCPServersDisabledError,
    );
    await expect(repository.update('server', config)).rejects.toBeInstanceOf(
      DynamicMCPServersDisabledError,
    );
    await expect(repository.upsert('server', config)).rejects.toBeInstanceOf(
      DynamicMCPServersDisabledError,
    );
    await expect(repository.remove('server')).rejects.toBeInstanceOf(
      DynamicMCPServersDisabledError,
    );
    await expect(repository.get('server')).resolves.toBeUndefined();
    await expect(repository.getAll('user-1')).resolves.toEqual({});
  });
});
