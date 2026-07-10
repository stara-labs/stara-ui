const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const {
  getOrganizationsContextController,
  createOrganizationController,
  activateOrganizationController,
  listMembersController,
  updateMemberController,
  disableMemberController,
  createInviteController,
  acceptInviteController,
  revokeInviteController,
  createTeamController,
  updateTeamController,
  deleteTeamController,
} = require('~/server/controllers/StaraOrganizationsController');

const router = express.Router();

router.use(requireJwtAuth);

router.get('/context', getOrganizationsContextController);
router.post('/', createOrganizationController);
router.post('/:tenantId/activate', activateOrganizationController);
router.get('/:tenantId/members', listMembersController);
router.patch('/:tenantId/members/:userId', updateMemberController);
router.delete('/:tenantId/members/:userId', disableMemberController);
router.post('/:tenantId/invites', createInviteController);
router.post('/invites/accept', acceptInviteController);
router.delete('/:tenantId/invites/:inviteId', revokeInviteController);
router.post('/:tenantId/teams', createTeamController);
router.patch('/:tenantId/teams/:teamId', updateTeamController);
router.delete('/:tenantId/teams/:teamId', deleteTeamController);

module.exports = router;
