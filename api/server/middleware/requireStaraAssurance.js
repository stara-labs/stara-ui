const { logger } = require('@librechat/data-schemas');
const { getUserById } = require('~/models');
const {
  getCanonicalRequestUser,
  isCanonicalIdentityContextEnabled,
} = require('~/server/services/StaraApiClient');

const assuranceError = (assurance) => ({
  code: 'stara_assurance_required',
  message: 'Verified email and MFA are required for Stara regulated surfaces.',
  requirements: {
    emailVerified: true,
    mfaEnrolled: true,
  },
  assurance,
});

const userId = (user) => user?.id?.toString?.() ?? user?._id?.toString?.();

const loadAssuranceUser = async (requestUser) => {
  const id = userId(requestUser);
  if (!id) {
    return requestUser;
  }

  if (isCanonicalIdentityContextEnabled()) {
    return getCanonicalRequestUser(id);
  }

  try {
    const currentUser = await getUserById(id, '_id id email emailVerified twoFactorEnabled');
    return currentUser ? { ...requestUser, ...currentUser } : requestUser;
  } catch (error) {
    logger.warn('[requireStaraAssurance] Failed to refresh assurance fields', error);
    return requestUser;
  }
};

const requireStaraAssurance = async (req, res, next) => {
  const currentUser = await loadAssuranceUser(req.user);
  req.user = currentUser;

  const assurance = {
    emailVerified: Boolean(currentUser?.emailVerified),
    mfaEnrolled: Boolean(currentUser?.twoFactorEnabled),
  };

  if (!assurance.emailVerified || !assurance.mfaEnrolled) {
    return res.status(403).json(assuranceError(assurance));
  }

  return next();
};

module.exports = requireStaraAssurance;
module.exports.assuranceError = assuranceError;
