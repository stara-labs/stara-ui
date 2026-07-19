const { AsyncLocalStorage } = require('node:async_hooks');

const {
  callStaraApi,
  getUserId,
  identitySubject,
  normalizeEmail,
  safeString,
} = require('~/server/services/StaraServiceClient');

const canonicalRequestUserStorage = new AsyncLocalStorage();
const canonicalGatewayContextKey = Symbol.for('@stara-labs/canonical-gateway-context');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const requireStaraUser = (user) => {
  const userId = getUserId(user);
  if (!userId) {
    const error = new Error('Authenticated user is required');
    error.status = 401;
    throw error;
  }
  return user;
};

const envEnabled = (value) => /^(1|true|yes|on)$/i.test(String(value ?? '').trim());

const isCanonicalIdentityContextEnabled = () => {
  if (envEnabled(process.env.STARA_IDENTITY_PLATFORM_AUTH)) {
    return true;
  }
  const explicit = process.env.STARA_CANONICAL_IDENTITY_CONTEXT;
  return explicit == null
    ? envEnabled(process.env.STARA_CANONICAL_WORKSPACE)
    : envEnabled(explicit);
};

const clearRequestTenant = (user) => {
  user.tenantId = undefined;
  Reflect.deleteProperty(user, canonicalGatewayContextKey);
  return user;
};

const unavailableContext = (message) => {
  const error = new Error(message);
  error.status = 503;
  error.code = 'canonical_identity_context_unavailable';
  return error;
};

const requiredCanonicalString = (value, label, maxLength = 512) => {
  const normalized = safeString(value, undefined, maxLength);
  if (!normalized || /[\r\n\0]/.test(normalized)) {
    throw unavailableContext(`The canonical ${label} is unavailable`);
  }
  return normalized;
};

const requiredCanonicalStringList = (value, label, { allowEmpty = false } = {}) => {
  if (!Array.isArray(value) || value.length > 100) {
    throw unavailableContext(`The canonical ${label} are unavailable`);
  }
  const normalized = value.map((item) => requiredCanonicalString(item, label, 256));
  if ((!allowEmpty && normalized.length === 0) || new Set(normalized).size !== normalized.length) {
    throw unavailableContext(`The canonical ${label} are unavailable`);
  }
  return Object.freeze(normalized);
};

const setCanonicalGatewayContext = (user, account, membership) => {
  const actorId = requiredCanonicalString(account?.user?.id, 'actor ID');
  if (!uuidPattern.test(actorId)) {
    throw unavailableContext('The canonical actor ID is unavailable');
  }

  const resolvedIdentitySubject = requiredCanonicalString(
    account?.user?.identity_subject,
    'identity subject',
  );
  if (resolvedIdentitySubject !== identitySubject(user)) {
    throw unavailableContext(
      'The canonical identity subject does not match the authenticated user',
    );
  }

  const identityEmail = normalizeEmail(account?.user?.email);
  if (!identityEmail || identityEmail !== normalizeEmail(user?.email)) {
    throw unavailableContext('The canonical identity email does not match the authenticated user');
  }
  if (account?.user?.status !== 'active') {
    const error = new Error('The canonical Stara identity is not active');
    error.status = 403;
    error.code = 'identity_disabled';
    throw error;
  }

  const assurance = account?.assurance;
  if (
    typeof assurance?.email_verified !== 'boolean' ||
    typeof assurance?.mfa_enrolled !== 'boolean'
  ) {
    throw unavailableContext('The canonical identity assurance is unavailable');
  }

  const context = Object.freeze({
    tenant_id: requiredCanonicalString(membership?.tenant_key, 'tenant key', 200),
    tenant_uuid: requiredCanonicalString(membership?.tenant_id, 'tenant ID', 64),
    actor_id: actorId,
    identity_subject: resolvedIdentitySubject,
    identity_email: identityEmail,
    role_key: requiredCanonicalString(membership?.role_key, 'membership role', 64),
    scope: requiredCanonicalStringList(membership?.scope_ids, 'membership scopes'),
    grants: requiredCanonicalStringList(membership?.mcp_grants, 'MCP grants', {
      allowEmpty: true,
    }),
    assurance: Object.freeze({
      email_verified: assurance.email_verified,
      mfa_enrolled: assurance.mfa_enrolled,
    }),
  });

  Object.defineProperty(user, canonicalGatewayContextKey, {
    configurable: true,
    enumerable: false,
    value: context,
  });
  return context;
};

const getCanonicalGatewayContext = (user) => user?.[canonicalGatewayContextKey];

const requireCanonicalGatewayContext = (user) => {
  const context = getCanonicalGatewayContext(user);
  if (context) {
    return context;
  }
  const error = new Error('Select an active Stara organization before using the Gateway');
  error.status = 403;
  error.code = 'active_tenant_required';
  throw error;
};

const resolveCanonicalRequestUser = async (inputUser) => {
  const user = requireStaraUser(inputUser);
  if (!isCanonicalIdentityContextEnabled()) {
    return user;
  }

  let account;
  try {
    account = await callStaraApi(user, '/v1/me');
  } catch (error) {
    if (error.code === 'identity_not_synced' && error.status === 404) {
      return clearRequestTenant(user);
    }
    throw error;
  }
  if (!Object.prototype.hasOwnProperty.call(account, 'active_tenant_id')) {
    const error = new Error('The canonical account context is unavailable');
    error.status = 503;
    throw error;
  }

  const activeTenantId = safeString(account.active_tenant_id);
  if (!activeTenantId) {
    return clearRequestTenant(user);
  }
  if (!Array.isArray(account.memberships)) {
    const error = new Error('The canonical membership context is unavailable');
    error.status = 503;
    throw error;
  }
  const activeMembership = account.memberships.find(
    (membership) =>
      membership?.membership_status === 'active' &&
      membership?.tenant_status === 'active' &&
      (membership.tenant_key === activeTenantId || membership.tenant_id === activeTenantId),
  );
  if (!activeMembership) {
    const error = new Error('The canonical active membership is unavailable');
    error.status = 503;
    throw error;
  }
  user.tenantId = safeString(activeMembership.tenant_key, activeTenantId);
  setCanonicalGatewayContext(user, account, activeMembership);
  return user;
};

const runWithCanonicalRequestUser = (user, callback) =>
  canonicalRequestUserStorage.run(requireStaraUser(user), callback);

const getCanonicalRequestUser = (expectedUserId) => {
  const user = canonicalRequestUserStorage.getStore();
  if (!user) {
    const error = new Error('Canonical request identity is unavailable');
    error.status = 401;
    throw error;
  }
  const userId = getUserId(user);
  if (expectedUserId && userId !== String(expectedUserId)) {
    const error = new Error('Canonical request identity does not match the requested actor');
    error.status = 403;
    throw error;
  }
  return user;
};

module.exports = {
  callStaraApi,
  getCanonicalGatewayContext,
  getUserId,
  getCanonicalRequestUser,
  isCanonicalIdentityContextEnabled,
  normalizeEmail,
  requireCanonicalGatewayContext,
  requireStaraUser,
  resolveCanonicalRequestUser,
  runWithCanonicalRequestUser,
  safeString,
};
