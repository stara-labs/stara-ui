const express = require('express');
const { requireJwtAuth, requireStaraAssurance } = require('~/server/middleware');
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
router.post('/', requireStaraAssurance, createOrganizationController);
router.post('/:tenantId/activate', requireStaraAssurance, activateOrganizationController);
router.get('/:tenantId/members', requireStaraAssurance, listMembersController);
router.patch('/:tenantId/members/:userId', requireStaraAssurance, updateMemberController);
router.delete('/:tenantId/members/:userId', requireStaraAssurance, disableMemberController);
router.post('/:tenantId/invites', requireStaraAssurance, createInviteController);
router.post('/invites/accept', requireStaraAssurance, acceptInviteController);
router.delete('/:tenantId/invites/:inviteId', requireStaraAssurance, revokeInviteController);
router.post('/:tenantId/teams', requireStaraAssurance, createTeamController);
router.patch('/:tenantId/teams/:teamId', requireStaraAssurance, updateTeamController);
router.delete('/:tenantId/teams/:teamId', requireStaraAssurance, deleteTeamController);

module.exports = router;
