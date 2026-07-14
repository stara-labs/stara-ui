const mockVerifyIdToken = jest.fn();
const mockGetApps = jest.fn(() => []);
const mockInitializeApp = jest.fn(() => ({ name: 'stara-identity-platform' }));
const mockApplicationDefault = jest.fn(() => ({ kind: 'adc' }));

jest.mock('firebase-admin/app', () => ({
  applicationDefault: (...args) => mockApplicationDefault(...args),
  getApps: (...args) => mockGetApps(...args),
  initializeApp: (...args) => mockInitializeApp(...args),
}));

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(() => ({ verifyIdToken: (...args) => mockVerifyIdToken(...args) })),
}));

const {
  identityPlatformAuthEnabled,
  identityPlatformProjectId,
  identityPlatformWebConfig,
  identityPlatformUser,
  verifyIdentityPlatformToken,
} = require('./IdentityPlatformService');

const originalEnvironment = {
  auth: process.env.STARA_IDENTITY_PLATFORM_AUTH,
  projectId: process.env.STARA_IDENTITY_PLATFORM_PROJECT_ID,
  googleProject: process.env.GOOGLE_CLOUD_PROJECT,
  tenantId: process.env.STARA_IDENTITY_PLATFORM_TENANT_ID,
  checkRevoked: process.env.STARA_IDENTITY_PLATFORM_CHECK_REVOKED,
  webApiKey: process.env.STARA_IDENTITY_PLATFORM_WEB_API_KEY,
  authDomain: process.env.STARA_IDENTITY_PLATFORM_AUTH_DOMAIN,
  appId: process.env.STARA_IDENTITY_PLATFORM_APP_ID,
  emulatorUrl: process.env.STARA_IDENTITY_PLATFORM_EMULATOR_URL,
};

describe('IdentityPlatformService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STARA_IDENTITY_PLATFORM_AUTH = 'true';
    process.env.STARA_IDENTITY_PLATFORM_PROJECT_ID = 'stara-production';
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.STARA_IDENTITY_PLATFORM_TENANT_ID;
    delete process.env.STARA_IDENTITY_PLATFORM_CHECK_REVOKED;
    process.env.STARA_IDENTITY_PLATFORM_WEB_API_KEY = 'public-browser-key';
    delete process.env.STARA_IDENTITY_PLATFORM_AUTH_DOMAIN;
    delete process.env.STARA_IDENTITY_PLATFORM_APP_ID;
    delete process.env.STARA_IDENTITY_PLATFORM_EMULATOR_URL;
  });

  afterAll(() => {
    restoreEnv('STARA_IDENTITY_PLATFORM_AUTH', originalEnvironment.auth);
    restoreEnv('STARA_IDENTITY_PLATFORM_PROJECT_ID', originalEnvironment.projectId);
    restoreEnv('GOOGLE_CLOUD_PROJECT', originalEnvironment.googleProject);
    restoreEnv('STARA_IDENTITY_PLATFORM_TENANT_ID', originalEnvironment.tenantId);
    restoreEnv('STARA_IDENTITY_PLATFORM_CHECK_REVOKED', originalEnvironment.checkRevoked);
    restoreEnv('STARA_IDENTITY_PLATFORM_WEB_API_KEY', originalEnvironment.webApiKey);
    restoreEnv('STARA_IDENTITY_PLATFORM_AUTH_DOMAIN', originalEnvironment.authDomain);
    restoreEnv('STARA_IDENTITY_PLATFORM_APP_ID', originalEnvironment.appId);
    restoreEnv('STARA_IDENTITY_PLATFORM_EMULATOR_URL', originalEnvironment.emulatorUrl);
  });

  it('uses the explicit enable flag and Cloud Run project fallback', () => {
    expect(identityPlatformAuthEnabled()).toBe(true);
    process.env.STARA_IDENTITY_PLATFORM_AUTH = 'false';
    expect(identityPlatformAuthEnabled()).toBe(false);

    delete process.env.STARA_IDENTITY_PLATFORM_PROJECT_ID;
    process.env.GOOGLE_CLOUD_PROJECT = 'stara-cloud-run';
    expect(identityPlatformProjectId()).toBe('stara-cloud-run');
  });

  it('returns only the public browser bootstrap configuration', () => {
    process.env.STARA_IDENTITY_PLATFORM_TENANT_ID = 'workforce-tenant';
    process.env.STARA_IDENTITY_PLATFORM_APP_ID = 'browser-app-id';
    process.env.STARA_IDENTITY_PLATFORM_EMULATOR_URL = 'http://127.0.0.1:9099';

    expect(identityPlatformWebConfig()).toEqual({
      enabled: true,
      apiKey: 'public-browser-key',
      projectId: 'stara-production',
      authDomain: 'stara-production.firebaseapp.com',
      tenantId: 'workforce-tenant',
      appId: 'browser-app-id',
      emulatorUrl: 'http://127.0.0.1:9099',
    });
  });

  it('fails closed when cutover is enabled without browser configuration', () => {
    delete process.env.STARA_IDENTITY_PLATFORM_WEB_API_KEY;

    expect(() => identityPlatformWebConfig()).toThrow(
      'Identity Platform browser configuration is incomplete',
    );
  });

  it('verifies revocation and maps only trusted token claims into the request principal', async () => {
    mockVerifyIdToken.mockResolvedValue(identityClaims());

    await expect(verifyIdentityPlatformToken('verified-token')).resolves.toEqual({
      id: 'identity-user-1',
      identitySubject: 'identity-user-1',
      idOnTheSource: 'identity-user-1',
      email: 'owner@example.com',
      name: 'Owner',
      provider: 'identity-platform',
      role: 'USER',
      emailVerified: true,
      twoFactorEnabled: true,
    });

    expect(mockVerifyIdToken).toHaveBeenCalledWith('verified-token', true);
    expect(mockInitializeApp).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'stara-production' }),
      'stara-identity-platform',
    );
  });

  it('allows revocation checks to be disabled only through the explicit emulator switch', async () => {
    process.env.STARA_IDENTITY_PLATFORM_CHECK_REVOKED = 'false';
    mockVerifyIdToken.mockResolvedValue(identityClaims());

    await verifyIdentityPlatformToken('emulator-token');

    expect(mockVerifyIdToken).toHaveBeenCalledWith('emulator-token', false);
  });

  it('enforces the configured Identity Platform tenant and required identity claims', () => {
    process.env.STARA_IDENTITY_PLATFORM_TENANT_ID = 'different-tenant';
    expect(() => identityPlatformUser(identityClaims())).toThrow(
      'Identity Platform tenant does not match',
    );
    delete process.env.STARA_IDENTITY_PLATFORM_TENANT_ID;
    expect(() => identityPlatformUser({ ...identityClaims(), sub: '' })).toThrow(
      'Identity Platform subject is required',
    );
    expect(() => identityPlatformUser({ ...identityClaims(), email: '' })).toThrow(
      'Identity Platform email is required',
    );
  });

  it('ignores the local MFA assurance claim outside the Identity emulator', () => {
    const claims = identityClaims({ includeSecondFactor: false });

    expect(identityPlatformUser({ ...claims, stara_mfa_enrolled: true })).toMatchObject({
      twoFactorEnabled: false,
    });
  });

  it('accepts the local MFA assurance claim only with the Identity emulator configured', () => {
    process.env.STARA_IDENTITY_PLATFORM_EMULATOR_URL = 'http://127.0.0.1:9099';
    const claims = identityClaims({ includeSecondFactor: false });

    expect(identityPlatformUser({ ...claims, stara_mfa_enrolled: true })).toMatchObject({
      twoFactorEnabled: true,
    });
    expect(identityPlatformUser({ ...claims, stara_mfa_enrolled: 'true' })).toMatchObject({
      twoFactorEnabled: false,
    });
  });

  it('fails closed when no project is configured', async () => {
    delete process.env.STARA_IDENTITY_PLATFORM_PROJECT_ID;
    delete process.env.GOOGLE_CLOUD_PROJECT;

    await expect(verifyIdentityPlatformToken('verified-token')).rejects.toMatchObject({
      status: 503,
    });
  });
});

function identityClaims({ includeSecondFactor = true } = {}) {
  return {
    sub: 'identity-user-1',
    email: 'Owner@Example.com',
    name: 'Owner',
    email_verified: true,
    firebase: {
      tenant: 'workforce-tenant',
      ...(includeSecondFactor ? { sign_in_second_factor: 'totp' } : {}),
    },
  };
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
