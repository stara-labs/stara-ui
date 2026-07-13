const deploymentId = '507f1f77bcf86cd799439011';
const canonicalId = '11111111-1111-4111-8111-111111111111';
const missingId = '22222222-2222-4222-8222-222222222222';
const mockFindAccessibleResources = jest.fn();
const mockMergeDeploymentSkillIds = jest.fn((ids) => [...ids, deploymentId]);

jest.mock('@librechat/api', () => ({
  MAX_SKILL_STATES: 100,
  toSkillStatesRecord: jest.fn((value) => value),
  validateSkillStatesPayload: jest.fn(() => null),
  pruneOrphanSkillStates: jest.fn(),
  getDeploymentSkillIds: jest.fn(() => [deploymentId]),
  mergeDeploymentSkillIds: (...args) => mockMergeDeploymentSkillIds(...args),
}));

jest.mock('~/server/services/PermissionService', () => ({
  findAccessibleResources: (...args) => mockFindAccessibleResources(...args),
}));

jest.mock('~/models', () => ({
  updateUser: jest.fn(),
  getUserById: jest.fn(),
}));

jest.mock('~/models/canonicalSkills', () => ({
  canonicalSkillsEnabled: jest.fn(() => true),
}));

const { PermissionBits, ResourceType } = require('librechat-data-provider');
const { buildPruneDeps } = require('./SkillStatesController');

describe('SkillStatesController canonical pruning', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindAccessibleResources.mockResolvedValue([canonicalId]);
  });

  it('retains canonical UUIDs and deployment IDs without querying the Mongo Skill model', async () => {
    const deps = buildPruneDeps({ id: 'user-1', role: 'USER' });

    await expect(
      deps.findExistingSkillIds([canonicalId, missingId, deploymentId]),
    ).resolves.toEqual([canonicalId, missingId, deploymentId]);

    await expect(deps.findAccessibleSkillIds()).resolves.toEqual([canonicalId, deploymentId]);
    expect(mockFindAccessibleResources).toHaveBeenCalledWith({
      userId: 'user-1',
      role: 'USER',
      resourceType: ResourceType.SKILL,
      requiredPermissions: PermissionBits.VIEW,
      invoke: true,
    });
  });
});
