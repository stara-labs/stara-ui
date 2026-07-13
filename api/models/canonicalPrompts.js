const { getUserId: getContextUserId } = require('@librechat/data-schemas');
const {
  canonicalPromptId,
  canonicalPromptPermissionBits,
  canonicalPromptsEnabled: promptsEnabled,
  createStaraPromptMethods,
  requiredCanonicalPromptPermissions,
} = require('@librechat/api');
const { PermissionBits } = require('librechat-data-provider');
const { callStaraApi, getUserId, safeString } = require('~/server/services/StaraServiceClient');

const canonicalPromptsEnabled = () => promptsEnabled(process.env);

const createCanonicalPromptMethods = (baseMethods) => {
  if (!canonicalPromptsEnabled()) {
    return {};
  }
  return createStaraPromptMethods({
    withActor: async (callback) => {
      const user = await loadCurrentUser(baseMethods);
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

const loadCurrentUser = async (baseMethods) => {
  const userId = getContextUserId();
  if (!userId) {
    throw httpError('Authenticated user context is required', 401);
  }
  const user = await baseMethods.getUserById(
    userId,
    '_id id email username name tenantId idOnTheSource identitySubject emailVerified twoFactorEnabled',
  );
  if (!user) {
    throw httpError('Authenticated user was not found', 401);
  }
  return { ...user, id: user.id ?? user._id?.toString() ?? userId };
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
