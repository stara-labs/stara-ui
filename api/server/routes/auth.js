const express = require('express');
const { createSetBalanceConfig, forceRefreshCloudFrontAuthCookies } = require('@librechat/api');
const {
  resetPasswordRequestController,
  resetPasswordController,
  registrationController,
  graphTokenController,
  refreshController,
} = require('~/server/controllers/AuthController');
const {
  regenerateBackupCodes,
  disable2FA,
  confirm2FA,
  enable2FA,
  verify2FA,
} = require('~/server/controllers/TwoFactorController');
const { verify2FAWithTempToken } = require('~/server/controllers/auth/TwoFactorAuthController');
const {
  checkIdentityPlatformSignupEligibility,
} = require('~/server/controllers/auth/IdentityPlatformAuthController');
const { logoutController } = require('~/server/controllers/auth/LogoutController');
const { loginController } = require('~/server/controllers/auth/LoginController');
const { findBalanceByUser, upsertBalanceFields } = require('~/models');
const { getAppConfig } = require('~/server/services/Config');
const middleware = require('~/server/middleware');
const requireLegacyAuthMode = require('~/server/middleware/requireLegacyAuthMode');
const { identityPlatformAuthEnabled } = require('~/server/services/IdentityPlatformService');

const setBalanceConfig = createSetBalanceConfig({
  getAppConfig,
  findBalanceByUser,
  upsertBalanceFields,
});

const router = express.Router();
const getCloudFrontAuthCookieRefreshResult = (req, res) => {
  const warmedResult = req.cloudFrontAuthCookieRefreshResult;
  if (warmedResult && (warmedResult.attempted || !warmedResult.enabled)) {
    return warmedResult;
  }

  return forceRefreshCloudFrontAuthCookies(req, res, req.user);
};

const ldapAuth = !!process.env.LDAP_URL && !!process.env.LDAP_USER_SEARCH_BASE;
//Local
router.post('/logout', middleware.requireJwtAuth, (req, res, next) => {
  if (identityPlatformAuthEnabled()) {
    return res.status(204).end();
  }
  return logoutController(req, res, next);
});
router.post(
  '/login',
  requireLegacyAuthMode,
  middleware.logHeaders,
  middleware.loginLimiter,
  middleware.checkBan,
  ldapAuth ? middleware.requireLdapAuth : middleware.requireLocalAuth,
  setBalanceConfig,
  loginController,
);
router.post('/refresh', requireLegacyAuthMode, refreshController);
router.post('/cloudfront/refresh', middleware.requireJwtAuth, (req, res) => {
  const result = getCloudFrontAuthCookieRefreshResult(req, res);
  if (!result.enabled) {
    return res.sendStatus(404);
  }

  const status = result.refreshed ? 200 : 500;
  return res.status(status).json({
    ok: result.refreshed,
    expiresInSec: result.expiresInSec,
    refreshAfterSec: result.refreshAfterSec,
  });
});
router.post(
  '/register',
  requireLegacyAuthMode,
  middleware.registerLimiter,
  middleware.checkBan,
  middleware.checkInviteUser,
  middleware.validateRegistration,
  registrationController,
);
router.post(
  '/identity-platform/signup/eligibility',
  middleware.registerLimiter,
  middleware.checkBan,
  checkIdentityPlatformSignupEligibility,
);
router.post(
  '/requestPasswordReset',
  requireLegacyAuthMode,
  middleware.resetPasswordLimiter,
  middleware.checkBan,
  middleware.validatePasswordReset,
  resetPasswordRequestController,
);
router.post(
  '/resetPassword',
  requireLegacyAuthMode,
  middleware.resetPasswordSubmissionLimiter,
  middleware.checkBan,
  middleware.validatePasswordReset,
  resetPasswordController,
);

router.post('/2fa/enable', requireLegacyAuthMode, middleware.requireJwtAuth, enable2FA);
router.post('/2fa/verify', requireLegacyAuthMode, middleware.requireJwtAuth, verify2FA);
router.post(
  '/2fa/verify-temp',
  requireLegacyAuthMode,
  middleware.setTwoFactorTempUser,
  middleware.twoFactorTempLimiter,
  middleware.checkBan,
  verify2FAWithTempToken,
);
router.post('/2fa/confirm', requireLegacyAuthMode, middleware.requireJwtAuth, confirm2FA);
router.post('/2fa/disable', requireLegacyAuthMode, middleware.requireJwtAuth, disable2FA);
router.post(
  '/2fa/backup/regenerate',
  requireLegacyAuthMode,
  middleware.requireJwtAuth,
  regenerateBackupCodes,
);

router.get('/graph-token', middleware.requireJwtAuth, graphTokenController);

module.exports = router;
