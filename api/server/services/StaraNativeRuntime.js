const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

const REQUIRED_FLAGS = [
  'STARA_CANONICAL_WORKSPACE',
  'STARA_CANONICAL_MCP_SERVERS',
  'STARA_IDENTITY_PLATFORM_AUTH',
];

const CANONICAL_OVERRIDE_FLAGS = [
  'STARA_CANONICAL_AGENTS',
  'STARA_CANONICAL_FILES',
  'STARA_CANONICAL_IDENTITY_CONTEXT',
  'STARA_CANONICAL_PROMPTS',
  'STARA_CANONICAL_SKILLS',
];

const LEGACY_ENDPOINT_VARIABLES = [
  'MONGO_URI',
  'MEILI_HOST',
  'MEILI_MASTER_KEY',
  'RAG_API_URL',
  'REDIS_URI',
];

const LEGACY_FEATURE_FLAGS = ['USE_REDIS', 'USE_REDIS_CLUSTER', 'USE_REDIS_STREAMS'];

function readBoolean(name, env = process.env, defaultValue = false) {
  const rawValue = env[name];
  if (rawValue == null || String(rawValue).trim() === '') {
    return defaultValue;
  }

  const value = String(rawValue).trim().toLowerCase();
  if (TRUE_VALUES.has(value)) {
    return true;
  }
  if (FALSE_VALUES.has(value)) {
    return false;
  }

  throw new Error(`${name} must be true or false.`);
}

function staraNativeRuntimeEnabled(env = process.env) {
  return readBoolean('STARA_NATIVE_RUNTIME', env);
}

function disableDotenvFileLoadingForNativeRuntime(
  env = process.env,
  dotenvModule = require('dotenv'),
) {
  if (!staraNativeRuntimeEnabled(env)) {
    return false;
  }

  // @librechat/agents loads the repository .env from several modules at import time. Native
  // deployments receive configuration from the process environment and must not ingest that file.
  dotenvModule.config = () => ({ parsed: {} });
  return true;
}

function validateStaraNativeRuntime(env = process.env) {
  if (!staraNativeRuntimeEnabled(env)) {
    return false;
  }

  const errors = [];
  const readFlag = (name, defaultValue = false) => {
    try {
      return readBoolean(name, env, defaultValue);
    } catch (error) {
      errors.push(error.message);
      return false;
    }
  };

  for (const name of REQUIRED_FLAGS) {
    if (!readFlag(name)) {
      errors.push(`${name}=true is required.`);
    }
  }

  for (const name of CANONICAL_OVERRIDE_FLAGS) {
    if (Object.prototype.hasOwnProperty.call(env, name) && !readFlag(name)) {
      errors.push(`${name} cannot disable a canonical adapter.`);
    }
  }

  const apiUrl = String(env.STARA_API_URL ?? '').trim();
  if (!apiUrl) {
    errors.push('STARA_API_URL is required.');
  } else {
    try {
      const parsed = new URL(apiUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        errors.push('STARA_API_URL must use http or https.');
      }
    } catch {
      errors.push('STARA_API_URL must be a valid URL.');
    }
  }

  for (const name of LEGACY_ENDPOINT_VARIABLES) {
    if (String(env[name] ?? '').trim()) {
      errors.push(`${name} must be unset.`);
    }
  }

  for (const name of LEGACY_FEATURE_FLAGS) {
    if (readFlag(name)) {
      errors.push(`${name} must be false or unset.`);
    }
  }

  if (readFlag('STARA_LEGACY_FILE_READ_FALLBACK', true)) {
    errors.push('STARA_LEGACY_FILE_READ_FALLBACK must be false.');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid Stara native runtime configuration:\n- ${errors.join('\n- ')}`);
  }

  return true;
}

module.exports = {
  disableDotenvFileLoadingForNativeRuntime,
  readBoolean,
  staraNativeRuntimeEnabled,
  validateStaraNativeRuntime,
};
