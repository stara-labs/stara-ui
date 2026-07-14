import { GoogleAuth } from 'google-auth-library';

const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const STARA_CLOUD_RUN_SERVICES = {
  gateway: {
    audienceEnvironmentVariable: 'STARA_GATEWAY_AUDIENCE',
    targetName: 'Stara Gateway',
  },
  mcp: {
    audienceEnvironmentVariable: 'STARA_MCP_AUDIENCE',
    targetName: 'stara-control-plane',
  },
} as const;

type StaraCloudRunService = keyof typeof STARA_CLOUD_RUN_SERVICES;
type HeaderSource = { get(name: string): unknown } | Record<string, unknown>;

const clients = new Map<string, ReturnType<GoogleAuth['getIdTokenClient']>>();
let auth: GoogleAuth | undefined;

function readAuthorization(headers: HeaderSource): string | undefined {
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const value = (headers as { get(name: string): unknown }).get('authorization');
    return typeof value === 'string' ? value : undefined;
  }

  const record = headers as Record<string, unknown>;
  const value = record.Authorization ?? record.authorization;
  return typeof value === 'string' ? value : undefined;
}

export function normalizeStaraCloudRunAudience(value: string, environmentVariable: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(
      `${environmentVariable} must be an HTTPS origin without credentials, path, query, or fragment.`,
    );
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error(
      `${environmentVariable} must be an HTTPS origin without credentials, path, query, or fragment.`,
    );
  }
  return url.origin;
}

export function validateStaraCloudRunAudience(
  serviceUrl: string,
  rawAudience: string,
  environmentVariable: string,
): string {
  let serviceOrigin: string;
  try {
    serviceOrigin = new URL(serviceUrl).origin;
  } catch {
    throw new Error(`The Stara service URL for ${environmentVariable} must be valid.`);
  }

  const audience = normalizeStaraCloudRunAudience(rawAudience, environmentVariable);
  if (serviceOrigin !== audience) {
    throw new Error(`${environmentVariable} must match the configured Stara service origin.`);
  }
  return audience;
}

export async function getStaraCloudRunIdentityHeaders({
  service,
  targetName,
  targetUrl,
}: {
  service: StaraCloudRunService;
  targetName: string;
  targetUrl: string;
}): Promise<Record<string, string>> {
  const config = STARA_CLOUD_RUN_SERVICES[service];
  if (targetName !== config.targetName) {
    return {};
  }

  const rawAudience = process.env[config.audienceEnvironmentVariable]?.trim();
  if (!rawAudience) {
    return {};
  }

  const audience = validateStaraCloudRunAudience(
    targetUrl,
    rawAudience,
    config.audienceEnvironmentVariable,
  );
  let client = clients.get(audience);
  if (!client) {
    auth ??= new GoogleAuth();
    client = auth.getIdTokenClient(audience);
    clients.set(audience, client);
  }

  const headers = await (await client).getRequestHeaders();
  const token = readAuthorization(headers as HeaderSource)?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!token || !JWT_PATTERN.test(token)) {
    throw new Error(`Cloud Run identity returned an invalid ${config.targetName} audience token.`);
  }

  return { 'x-serverless-authorization': `Bearer ${token}` };
}

export function resetStaraCloudRunAuthForTesting(): void {
  clients.clear();
  auth = undefined;
}
