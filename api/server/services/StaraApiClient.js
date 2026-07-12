const db = require('~/models');
const {
  callStaraApi,
  getUserId,
  normalizeEmail,
  safeString,
} = require('~/server/services/StaraServiceClient');

const loadStaraUser = async (user) => {
  const userId = getUserId(user);
  if (!userId) {
    const error = new Error('Authenticated user is required');
    error.status = 401;
    throw error;
  }
  const latest = await db.getUserById(
    userId,
    '_id id email username name tenantId idOnTheSource emailVerified twoFactorEnabled',
  );
  return { ...(latest ?? user), _id: latest?._id ?? user?._id, id: latest?.id ?? user?.id };
};

const setCompatibilityTenant = async (user, tenantId) => {
  if ((user?.tenantId ?? null) === (tenantId ?? null)) {
    return;
  }
  await db.updateUser(getUserId(user), { tenantId: tenantId ?? null });
  user.tenantId = tenantId ?? null;
};

module.exports = {
  callStaraApi,
  getUserId,
  loadStaraUser,
  normalizeEmail,
  safeString,
  setCompatibilityTenant,
};
