const express = require('express');
const { requireJwtAuth, requireStaraAssurance } = require('~/server/middleware');
const {
  cancelEngineeringRunController,
  createEngineeringTaskController,
  createRepositoryConnectionController,
  decideEngineeringRunController,
  getEngineeringContextController,
  getEngineeringRunController,
  resumeEngineeringRunController,
  retryEngineeringRunController,
  startEngineeringRunController,
  updateEngineeringPolicyController,
} = require('~/server/controllers/StaraEngineeringController');

const router = express.Router();

router.use(requireJwtAuth, requireStaraAssurance);

router.get('/context', getEngineeringContextController);
router.post('/repositories', createRepositoryConnectionController);
router.put('/policy', updateEngineeringPolicyController);
router.post('/tasks', createEngineeringTaskController);
router.post('/tasks/:taskId/runs', startEngineeringRunController);
router.get('/runs/:runId', getEngineeringRunController);
router.post('/runs/:runId/decisions', decideEngineeringRunController);
router.post('/runs/:runId/cancel', cancelEngineeringRunController);
router.post('/runs/:runId/retry', retryEngineeringRunController);
router.post('/runs/:runId/resume', resumeEngineeringRunController);

module.exports = router;
