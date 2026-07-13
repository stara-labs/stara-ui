const { ResourceType } = require('librechat-data-provider');
const {
  getCanonicalResourcePermissions,
  getCanonicalResourceRoles,
  isCanonicalResourceSharing,
  searchCanonicalPrincipals,
  updateCanonicalResourcePermissions,
} = require('./CanonicalResourceSharingService');

module.exports = {
  getCanonicalAgentPermissions: (user, resourceId) =>
    getCanonicalResourcePermissions(user, ResourceType.AGENT, resourceId),
  getCanonicalAgentRoles: (user) => getCanonicalResourceRoles(user, ResourceType.AGENT),
  isCanonicalAgentSharing: (resourceType) =>
    resourceType === ResourceType.AGENT && isCanonicalResourceSharing(resourceType),
  searchCanonicalPrincipals,
  updateCanonicalAgentPermissions: (user, resourceId, input) =>
    updateCanonicalResourcePermissions(user, ResourceType.AGENT, resourceId, input),
};
