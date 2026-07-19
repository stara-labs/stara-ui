import type { IUser } from '@librechat/data-schemas';

export const STARA_GATEWAY_ENDPOINT_NAME = 'Stara Gateway';

const canonicalGatewayContextKey = Symbol.for('@stara-labs/canonical-gateway-context');

interface CanonicalGatewayContext {
  tenant_id: string;
  actor_id: string;
  identity_subject: string;
  identity_email: string;
  scope: string[];
  grants: string[];
  assurance: {
    email_verified: boolean;
    mfa_enrolled: boolean;
  };
}

interface StaraGatewayContextHeaderOptions {
  targetName: string;
  user?: IUser;
  required?: boolean;
}

export function isStaraGatewayTarget(targetName: string): boolean {
  return targetName === STARA_GATEWAY_ENDPOINT_NAME;
}

export function getStaraGatewayContextHeaders({
  targetName,
  user,
  required = false,
}: StaraGatewayContextHeaderOptions): Record<string, string> | undefined {
  if (!isStaraGatewayTarget(targetName)) {
    return undefined;
  }

  const context = readCanonicalContext(user);
  if (!context) {
    if (required) {
      throw new Error('Canonical Stara Gateway context is unavailable.');
    }
    return undefined;
  }

  return {
    'x-stara-tenant-id': context.tenant_id,
    'x-stara-identity-subject': context.identity_subject,
    'x-stara-actor-email': context.identity_email,
    'x-stara-actor-id': context.actor_id,
    'x-stara-scope': context.scope.join(','),
    ...(context.grants.length > 0 ? { 'x-stara-grants': context.grants.join(',') } : {}),
    'x-stara-email-verified': context.assurance.email_verified ? 'true' : 'false',
    'x-stara-mfa-enrolled': context.assurance.mfa_enrolled ? 'true' : 'false',
  };
}

function readCanonicalContext(user?: IUser): CanonicalGatewayContext | undefined {
  if (!user || (typeof user !== 'object' && typeof user !== 'function')) {
    return undefined;
  }
  const raw = (user as unknown as Record<PropertyKey, unknown>)[canonicalGatewayContextKey];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const source = raw as Record<string, unknown>;
  const assurance = source.assurance as Record<string, unknown> | undefined;
  const context: CanonicalGatewayContext = {
    tenant_id: requiredHeaderValue(source.tenant_id, 'tenant ID'),
    actor_id: requiredHeaderValue(source.actor_id, 'actor ID'),
    identity_subject: requiredHeaderValue(source.identity_subject, 'identity subject'),
    identity_email: requiredEmail(source.identity_email),
    scope: requiredHeaderList(source.scope, 'scope', false),
    grants: requiredHeaderList(source.grants, 'grant', true),
    assurance: {
      email_verified: requiredBoolean(assurance?.email_verified, 'email verification'),
      mfa_enrolled: requiredBoolean(assurance?.mfa_enrolled, 'MFA enrollment'),
    },
  };
  return context;
}

function requiredHeaderValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\r\n\0,]/.test(value)) {
    throw new Error(`Canonical Stara Gateway ${label} is invalid.`);
  }
  return value.trim();
}

function requiredEmail(value: unknown): string {
  const email = requiredHeaderValue(value, 'actor email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Canonical Stara Gateway actor email is invalid.');
  }
  return email;
}

function requiredHeaderList(value: unknown, label: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(value) || value.length > 100 || (!allowEmpty && value.length === 0)) {
    throw new Error(`Canonical Stara Gateway ${label} list is invalid.`);
  }
  const normalized = value.map((item) => requiredHeaderValue(item, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Canonical Stara Gateway ${label} list is invalid.`);
  }
  return normalized;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Canonical Stara Gateway ${label} is invalid.`);
  }
  return value;
}
