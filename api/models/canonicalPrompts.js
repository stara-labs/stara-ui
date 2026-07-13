const { getUserId: getContextUserId } = require('@librechat/data-schemas');
const {
  canonicalPromptId,
  canonicalPromptPermissionBits,
  createStaraPromptMethods,
  requiredCanonicalPromptPermissions,
} = require('@librechat/api');
const { PermissionBits } = require('librechat-data-provider');
const { callStaraApi, getUserId, safeString } = require('~/server/services/StaraServiceClient');
const { getCanonicalRequestUser } = require('~/server/services/StaraApiClient');

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

const canonicalPromptsEnabled = () => {
  const explicit = process.env.STARA_CANONICAL_PROMPTS;
  const value = explicit == null ? process.env.STARA_CANONICAL_WORKSPACE : explicit;
  return TRUE_VALUES.has(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );
};

const createCanonicalPromptMethods = (_baseMethods) => {
  if (!canonicalPromptsEnabled()) {
    return {};
  }
  return createStaraPromptMethods({
    withActor: async (callback) => {
      const user = await loadCurrentUser();
      const me = await request(user, '/v1/me');
      return callback(user, me.user);
    },
    request,
    getUserId,
    safeString,
  });
};

const getCanonicalPromptAccess = async (user, promptId) =>
  (
    await request(
      user,
      `/v1/prompts/${encodeURIComponent(requireCanonicalPromptId(promptId))}/access`,
    )
  ).access;

const listCanonicalPromptIds = async (user, requiredPermission, invoke = false) => {
  const prompts = (await request(user, '/v1/prompts')).prompts ?? [];
  if (requiredPermission === PermissionBits.VIEW && !invoke) {
    return prompts.map((prompt) => prompt.id);
  }
  const checked = await Promise.all(
    prompts.map(async (prompt) => ({
      id: prompt.id,
      allowed: await hasCanonicalPromptPermission(user, prompt.id, requiredPermission, invoke),
    })),
  );
  return checked.filter(({ allowed }) => allowed).map(({ id }) => id);
};

const hasCanonicalPromptPermission = async (user, promptId, requiredPermission, invoke = false) => {
  try {
    const access = await getCanonicalPromptAccess(user, promptId);
    return requiredCanonicalPromptPermissions(requiredPermission, invoke).every((permission) =>
      access.permissions.includes(permission),
    );
  } catch (error) {
    if (error.status === 404) {
      return false;
    }
    throw error;
  }
};

const loadCurrentUser = async () => {
  const userId = getContextUserId();
  if (!userId) {
    throw httpError('Authenticated user context is required', 401);
  }
  return getCanonicalRequestUser(userId);
};

const request = (user, path, options = {}) =>
  callStaraApi(user, path, { ...options, tenantId: user.tenantId });

const requireCanonicalPromptId = (value) => {
  const id = canonicalPromptId(value);
  if (!id) {
    throw httpError('A canonical prompt UUID is required', 400);
  }
  return id;
};

const httpError = (message, status) => Object.assign(new Error(message), { status });

module.exports = {
  canonicalPromptId,
  canonicalPromptPermissionBits,
  canonicalPromptsEnabled,
  createCanonicalPromptMethods,
  getCanonicalPromptAccess,
  hasCanonicalPromptPermission,
  listCanonicalPromptIds,
  requiredCanonicalPromptPermissions,
};
