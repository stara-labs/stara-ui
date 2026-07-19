const { staraNativeRuntimeEnabled } = require('~/server/services/StaraNativeRuntime');

const createNativeUsageMethods = (baseMethods) => ({
  spendTokens: async (...args) =>
    staraNativeRuntimeEnabled() ? undefined : baseMethods.spendTokens(...args),
  spendStructuredTokens: async (...args) =>
    staraNativeRuntimeEnabled()
      ? { prompt: undefined, completion: undefined }
      : baseMethods.spendStructuredTokens(...args),
});

module.exports = { createNativeUsageMethods };
