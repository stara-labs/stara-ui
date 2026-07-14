const mongoose = require('mongoose');
const { createModels } = require('@librechat/data-schemas');
const { connectDb } = require('./connect');
const { staraNativeRuntimeEnabled } = require('../server/services/StaraNativeRuntime');

// createModels MUST run before requiring indexSync.
// indexSync.js captures mongoose.models.Message and mongoose.models.Conversation
// at module load time. If those models are not registered first, all MeiliSearch
// sync operations will silently fail on every startup.
createModels(mongoose);

// Registering the schemas keeps inherited LibreChat modules import-compatible. Native Stara
// persistence never loads the Meili synchronization module or starts its background work.
const indexSync = staraNativeRuntimeEnabled()
  ? async function skipLegacyIndexSync() {}
  : require('./indexSync');

module.exports = { connectDb, indexSync };
