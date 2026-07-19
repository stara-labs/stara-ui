import type { IUser } from '@librechat/data-schemas';
import { getStaraGatewayContextHeaders, isStaraGatewayTarget } from './staraGatewayContext';

const contextKey = Symbol.for('@stara-labs/canonical-gateway-context');

describe('Stara Gateway canonical request headers', () => {
  it('renders only server-established canonical authority for the exact Gateway target', () => {
    const user = canonicalUser();

    expect(getStaraGatewayContextHeaders({ targetName: 'Stara Gateway', user })).toEqual({
      'x-stara-tenant-id': 'tenant_acme',
      'x-stara-identity-subject': 'identity-owner',
      'x-stara-actor-email': 'owner@example.com',
      'x-stara-actor-id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'x-stara-scope': 'org:acme,project:alpha',
      'x-stara-grants': 'stara.memory.read,stara.engineering.read',
      'x-stara-email-verified': 'true',
      'x-stara-mfa-enrolled': 'true',
    });
  });

  it('does not expose canonical context to similarly named custom endpoints', () => {
    expect(isStaraGatewayTarget('Stara Gateway')).toBe(true);
    expect(isStaraGatewayTarget('stara gateway')).toBe(false);
    expect(
      getStaraGatewayContextHeaders({ targetName: 'Stara Gateway Preview', user: canonicalUser() }),
    ).toBeUndefined();
  });

  it('omits the unavailable Gateway during discovery and fails closed for execution', () => {
    const user = { id: 'librechat-user' } as IUser;
    expect(getStaraGatewayContextHeaders({ targetName: 'Stara Gateway', user })).toBeUndefined();
    expect(() =>
      getStaraGatewayContextHeaders({ targetName: 'Stara Gateway', user, required: true }),
    ).toThrow('Canonical Stara Gateway context is unavailable');
  });

  it('rejects malformed canonical values before they become HTTP headers', () => {
    const user = canonicalUser({ scope: ['org:acme\r\nx-injected: true'] });
    expect(() =>
      getStaraGatewayContextHeaders({ targetName: 'Stara Gateway', user, required: true }),
    ).toThrow('scope is invalid');
  });
});

function canonicalUser(overrides: Record<string, unknown> = {}): IUser {
  const user = { id: 'librechat-user' } as IUser;
  Object.defineProperty(user, contextKey, {
    value: {
      tenant_id: 'tenant_acme',
      actor_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      identity_subject: 'identity-owner',
      identity_email: 'owner@example.com',
      scope: ['org:acme', 'project:alpha'],
      grants: ['stara.memory.read', 'stara.engineering.read'],
      assurance: { email_verified: true, mfa_enrolled: true },
      ...overrides,
    },
  });
  return user;
}
