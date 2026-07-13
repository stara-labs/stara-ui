const mongoose = require('mongoose');
const { createMethods } = require('@librechat/data-schemas');
const { matchModelName, findMatchingPattern } = require('@librechat/api');
const getLogStores = require('~/cache/getLogStores');
const { createCanonicalAgentMethods } = require('./canonicalAgents');
const { createCanonicalFileMethods } = require('./canonicalFiles');
const { createCanonicalWorkspaceMethods } = require('./canonicalWorkspace');

const methods = createMethods(mongoose, {
  matchModelName,
  findMatchingPattern,
  getCache: getLogStores,
});
const canonicalWorkspaceMethods = createCanonicalWorkspaceMethods(methods);
const canonicalAgentMethods = createCanonicalAgentMethods(methods);
const canonicalFileMethods = createCanonicalFileMethods(methods);

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
  seedDatabase,
};
