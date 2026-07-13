const mongoose = require('mongoose');
const { createMethods } = require('@librechat/data-schemas');
const { matchModelName, findMatchingPattern } = require('@librechat/api');
const getLogStores = require('~/cache/getLogStores');
const { createCanonicalAgentMethods } = require('./canonicalAgents');
const { createCanonicalFileMethods } = require('./canonicalFiles');
const { createCanonicalPromptMethods } = require('./canonicalPrompts');
const { createCanonicalSkillMethods } = require('./canonicalSkills');
const { createCanonicalWorkspaceMethods } = require('./canonicalWorkspace');

const methods = createMethods(mongoose, {
  matchModelName,
  findMatchingPattern,
  getCache: getLogStores,
});
const canonicalWorkspaceMethods = createCanonicalWorkspaceMethods(methods);
const canonicalAgentMethods = createCanonicalAgentMethods(methods);
const canonicalFileMethods = createCanonicalFileMethods(methods);
const canonicalPromptMethods = createCanonicalPromptMethods(methods);
const canonicalSkillMethods = createCanonicalSkillMethods({ ...methods, ...canonicalAgentMethods });

const seedDatabase = async () => {
  await methods.initializeRoles();
  await methods.seedDefaultRoles();
  await methods.ensureDefaultCategories();
  await methods.seedSystemGrants();
};

module.exports = {
  ...methods,
  ...canonicalWorkspaceMethods,
  ...canonicalAgentMethods,
  ...canonicalFileMethods,
  ...canonicalPromptMethods,
  ...canonicalSkillMethods,
  seedDatabase,
};
