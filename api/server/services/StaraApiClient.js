const { AsyncLocalStorage } = require('node:async_hooks');

const {
  callStaraApi,
  getUserId,
  normalizeEmail,
  safeString,
} = require('~/server/services/StaraServiceClient');

const canonicalRequestUserStorage = new AsyncLocalStorage();

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
  return user;
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
  getUserId,
  getCanonicalRequestUser,
  isCanonicalIdentityContextEnabled,
  normalizeEmail,
  requireStaraUser,
  resolveCanonicalRequestUser,
  runWithCanonicalRequestUser,
  safeString,
};
