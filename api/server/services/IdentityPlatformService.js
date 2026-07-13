const { SystemRoles } = require('librechat-data-provider');
const { normalizeEmail, safeString } = require('~/server/services/StaraServiceClient');

const APP_NAME = 'stara-identity-platform';

const envEnabled = (value) => /^(1|true|yes|on)$/i.test(String(value ?? '').trim());

const identityPlatformAuthEnabled = () => envEnabled(process.env.STARA_IDENTITY_PLATFORM_AUTH);

const identityPlatformProjectId = () =>
  safeString(
    process.env.STARA_IDENTITY_PLATFORM_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT,
    undefined,
    128,
  );

const identityPlatformWebConfig = () => {
  if (!identityPlatformAuthEnabled()) {
    return undefined;
  }

  const projectId = identityPlatformProjectId();
  const apiKey = safeString(process.env.STARA_IDENTITY_PLATFORM_WEB_API_KEY, undefined, 512);
  if (!projectId || !apiKey) {
    const error = new Error('Identity Platform browser configuration is incomplete');
    error.status = 503;
    throw error;
  }

  return {
    enabled: true,
    apiKey,
    projectId,
    authDomain: safeString(
      process.env.STARA_IDENTITY_PLATFORM_AUTH_DOMAIN,
      `${projectId}.firebaseapp.com`,
      512,
    ),
    tenantId: safeString(process.env.STARA_IDENTITY_PLATFORM_TENANT_ID, undefined, 128),
    appId: safeString(process.env.STARA_IDENTITY_PLATFORM_APP_ID, undefined, 256),
    emulatorUrl: safeString(process.env.STARA_IDENTITY_PLATFORM_EMULATOR_URL, undefined, 512),
  };
};

const getIdentityPlatformAuth = () => {
  const { applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const projectId = identityPlatformProjectId();
  if (!projectId) {
    const error = new Error('Identity Platform project ID is required');
    error.status = 503;
    throw error;
  }
  const existing = getApps().find((app) => app.name === APP_NAME);
  const app =
    existing ??
    initializeApp(
      {
        credential: applicationDefault(),
        projectId,
      },
      APP_NAME,
    );
  return getAuth(app);
};

const requireIdentityClaim = (value, message, maxLength = 512) => {
  const normalized = safeString(value, undefined, maxLength);
  if (!normalized) {
    const error = new Error(message);
    error.status = 401;
    throw error;
  }
  return normalized;
};

const assertIdentityPlatformTenant = (decodedToken) => {
  const expectedTenantId = safeString(process.env.STARA_IDENTITY_PLATFORM_TENANT_ID);
  if (!expectedTenantId) {
    return;
  }
  const tokenTenantId = safeString(decodedToken?.firebase?.tenant);
  if (tokenTenantId !== expectedTenantId) {
    const error = new Error('Identity Platform tenant does not match');
    error.status = 401;
    throw error;
  }
};

const identityPlatformUser = (decodedToken) => {
  assertIdentityPlatformTenant(decodedToken);
  const identitySubject = requireIdentityClaim(
    decodedToken?.sub ?? decodedToken?.uid,
    'Identity Platform subject is required',
    128,
  );
  const email = normalizeEmail(decodedToken?.email);
  if (!email) {
    const error = new Error('Identity Platform email is required');
    error.status = 401;
    throw error;
  }
  const secondFactor = safeString(decodedToken?.firebase?.sign_in_second_factor);

  return {
    id: identitySubject,
    identitySubject,
    idOnTheSource: identitySubject,
    email,
    name: safeString(decodedToken?.name, email, 256),
    provider: 'identity-platform',
    role: SystemRoles.USER,
    emailVerified: decodedToken?.email_verified === true,
    twoFactorEnabled: Boolean(secondFactor),
  };
};

const verifyIdentityPlatformToken = async (rawToken) => {
  const token = requireIdentityClaim(rawToken, 'Identity Platform token is required', 16384);
  const checkRevoked = !/^(0|false|no|off)$/i.test(
    String(process.env.STARA_IDENTITY_PLATFORM_CHECK_REVOKED ?? '').trim(),
  );
  const decodedToken = await getIdentityPlatformAuth().verifyIdToken(token, checkRevoked);
  return identityPlatformUser(decodedToken);
};

module.exports = {
  identityPlatformAuthEnabled,
  identityPlatformProjectId,
  identityPlatformWebConfig,
  identityPlatformUser,
  verifyIdentityPlatformToken,
};
