const express = require('express');
const { createToolFavoritesHandlers } = require('@librechat/api');
const {
  updateFavoritesController,
  getFavoritesController,
} = require('~/server/controllers/FavoritesController');
const {
  getSkillStatesController,
  updateSkillStatesController,
} = require('~/server/controllers/SkillStatesController');
const {
  getStaraOnboardingContextController,
  saveStaraOnboardingController,
  acceptStaraTenantInviteController,
  activateStaraTenantController,
} = require('~/server/controllers/StaraOnboardingController');
const { requireJwtAuth } = require('~/server/middleware');
const { getToolFavorites, addToolFavorite, removeToolFavorite } = require('~/models');

const router = express.Router();

const toolFavorites = createToolFavoritesHandlers({
  getToolFavorites,
  addToolFavorite,
  removeToolFavorite,
});

router.get('/favorites/tools', requireJwtAuth, toolFavorites.listToolFavorites);
router.put('/favorites/tools/:itemType/:itemId', requireJwtAuth, toolFavorites.addToolFavorite);
router.delete(
  '/favorites/tools/:itemType/:itemId',
  requireJwtAuth,
  toolFavorites.removeToolFavorite,
);
router.get('/favorites', requireJwtAuth, getFavoritesController);
router.post('/favorites', requireJwtAuth, updateFavoritesController);
router.get('/skills/active', requireJwtAuth, getSkillStatesController);
router.post('/skills/active', requireJwtAuth, updateSkillStatesController);
router.get('/onboarding/stara/context', requireJwtAuth, getStaraOnboardingContextController);
router.put('/onboarding/stara', requireJwtAuth, saveStaraOnboardingController);
router.post(
  '/onboarding/stara/invites/:inviteId/accept',
  requireJwtAuth,
  acceptStaraTenantInviteController,
);
router.post(
  '/onboarding/stara/tenants/:tenantId/activate',
  requireJwtAuth,
  activateStaraTenantController,
);

module.exports = router;
