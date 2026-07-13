import type { IServerConfigsRepositoryInterface } from '~/mcp/registry/ServerConfigsRepositoryInterface';
import type { AddServerResult, ParsedServerConfig } from '~/mcp/types';

export class DynamicMCPServersDisabledError extends Error {
  readonly code = 'MCP_DYNAMIC_SERVERS_DISABLED';

  constructor() {
    super('Dynamic MCP server management is disabled in canonical Stara mode.');
    this.name = 'DynamicMCPServersDisabledError';
  }
}

/**
 * Canonical Stara mode executes only operator-managed config-source servers.
 * Postgres metadata and Secret Manager references are not materialized in the UI process.
 */
export class DisabledServerConfigsRepository implements IServerConfigsRepositoryInterface {
  async add(
    _serverName: string,
    _config: ParsedServerConfig,
    _userId?: string,
    _reservedServerNames?: Iterable<string>,
  ): Promise<AddServerResult> {
    throw new DynamicMCPServersDisabledError();
  }

  async update(_serverName: string, _config: ParsedServerConfig, _userId?: string): Promise<void> {
    throw new DynamicMCPServersDisabledError();
  }

  async upsert(_serverName: string, _config: ParsedServerConfig, _userId?: string): Promise<void> {
    throw new DynamicMCPServersDisabledError();
  }

  async remove(_serverName: string, _userId?: string): Promise<void> {
    throw new DynamicMCPServersDisabledError();
  }

  async get(_serverName: string, _userId?: string): Promise<ParsedServerConfig | undefined> {
    return undefined;
  }

  async getAll(_userId?: string, _role?: string): Promise<Record<string, ParsedServerConfig>> {
    return {};
  }

  async reset(): Promise<void> {}
}
