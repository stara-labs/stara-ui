const { getUserId: getContextUserId } = require('@librechat/data-schemas');
const {
  canonicalFilesEnabled,
  listCanonicalFiles,
} = require('~/server/services/CanonicalFileService');

const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

const createCanonicalFileMethods = (baseMethods) => {
  if (!canonicalFilesEnabled()) {
    return {};
  }

  const loadCurrentUser = async () => {
    const userId = getContextUserId();
    if (!userId) {
      const error = new Error('User not authenticated');
      error.status = 401;
      throw error;
    }
    const user = await baseMethods.getUserById(
      userId,
      '_id id email username name tenantId idOnTheSource emailVerified twoFactorEnabled',
    );
    if (!user) {
      const error = new Error('Authenticated user was not found');
      error.status = 401;
      throw error;
    }
    return { ...user, id: user.id ?? user._id?.toString() ?? userId };
  };

  const getFiles = async (filter = {}, sortOptions, selectFields) => {
    const user = await loadCurrentUser();
    const canonical = (await listCanonicalFiles(user)).filter((file) =>
      matchesFilter(file, filter),
    );
    if (!legacyFileReadFallbackEnabled()) {
      return sortFiles(canonical, sortOptions);
    }
    const legacy = (await baseMethods.getFiles(filter, sortOptions, selectFields)) ?? [];
    const canonicalIds = new Set(canonical.map((file) => file.file_id));
    return sortFiles(
      [...canonical, ...legacy.filter((file) => !canonicalIds.has(file.file_id))],
      sortOptions,
    );
  };

  const findFileById = async (fileId, options = {}) => {
    const files = await getFiles({ file_id: fileId, ...options });
    return files[0] ?? null;
  };

  return { findFileById, getFiles };
};

const legacyFileReadFallbackEnabled = () => {
  const value = process.env.STARA_LEGACY_FILE_READ_FALLBACK;
  return value == null || !FALSE_VALUES.has(String(value).trim().toLowerCase());
};

const matchesFilter = (file, filter) => {
  if (!filter || typeof filter !== 'object') {
    return true;
  }
  if (
    Array.isArray(filter.$or) &&
    !filter.$or.some((candidate) => matchesFilter(file, candidate))
  ) {
    return false;
  }
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') {
      return true;
    }
    return matchesValue(readPath(file, key), expected);
  });
};

const matchesValue = (actual, expected) => {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if (Array.isArray(expected.$in) && !expected.$in.includes(actual)) {
      return false;
    }
    if ('$ne' in expected && actual === expected.$ne) {
      return false;
    }
    if (
      '$exists' in expected &&
      (actual !== undefined && actual !== null) !== Boolean(expected.$exists)
    ) {
      return false;
    }
    return true;
  }
  return String(actual ?? '') === String(expected ?? '');
};

const readPath = (value, dottedPath) =>
  dottedPath.split('.').reduce((current, segment) => current?.[segment], value);

const sortFiles = (files, sortOptions = { updatedAt: -1 }) => {
  const [field, direction] = Object.entries(sortOptions ?? { updatedAt: -1 })[0];
  const multiplier = direction === 1 ? 1 : -1;
  return [...files].sort(
    (left, right) =>
      String(left[field] ?? '').localeCompare(String(right[field] ?? '')) * multiplier,
  );
};

module.exports = {
  createCanonicalFileMethods,
  legacyFileReadFallbackEnabled,
  matchesFilter,
};
