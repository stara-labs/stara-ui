const {
  getUserId: getContextUserId,
  logger,
  partitionIssues,
  validateAlwaysApply,
  validateAlwaysApplyInBody,
  validateRelativePath,
  validateSkillBody,
  validateSkillDescription,
  validateSkillDisplayTitle,
  validateSkillFrontmatter,
  validateSkillName,
  deriveStructuredFrontmatterFields,
  inferSkillFileCategory,
} = require('@librechat/data-schemas');
const { PermissionBits } = require('librechat-data-provider');
const { callStaraApi, getUserId, safeString } = require('~/server/services/StaraServiceClient');
const { getCanonicalRequestUser } = require('~/server/services/StaraApiClient');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const MAX_SKILL_FILES = 100;
const MAX_MUTATION_RETRIES = 3;

const canonicalSkillsEnabled = () => {
  const explicit = process.env.STARA_CANONICAL_SKILLS;
  const value = explicit == null ? process.env.STARA_CANONICAL_WORKSPACE : explicit;
  return TRUE_VALUES.has(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );
};

const createCanonicalSkillMethods = (baseMethods) => {
  if (!canonicalSkillsEnabled()) {
    return {};
  }

  const withActor = async (callback) => {
    const user = await loadCurrentUser();
    const me = await request(user, '/v1/me');
    return callback(user, me.user);
  };

  const getCanonical = async (user, id) => {
    const canonicalId = canonicalSkillId(id);
    if (!canonicalId) return null;
    try {
      return (await request(user, `/v1/skills/${encodeURIComponent(canonicalId)}`)).skill;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  };

  const getSkillById = async (id) =>
    withActor(async (user, actor) => {
      const canonical = await getCanonical(user, id);
      return canonical ? mapCanonicalSkill(canonical, user, actor.id) : null;
    });

  const createSkill = async (data) =>
    withActor(async (user, actor) => {
      const normalized = normalizeCreatedSkill(data);
      const warnings = validateCanonicalSkill(normalized);
      let response;
      try {
        response = await request(user, '/v1/skills', {
          method: 'POST',
          body: canonicalCreateBody(normalized),
        });
      } catch (error) {
        throw translateSkillMutationError(error);
      }
      return { skill: mapCanonicalSkill(response.skill, user, actor.id), warnings };
    });

  const updateSkill = async ({ id, expectedVersion, update }) =>
    withActor(async (user, actor) => {
      const canonical = await getCanonical(user, id);
      if (!canonical) return { status: 'not_found' };
      const current = mapCanonicalSkill(canonical, user, actor.id);
      if (current.version !== expectedVersion) {
        return { status: 'conflict', current };
      }
      const next = applySkillUpdate(current, update);
      const warnings = validateCanonicalSkill(next);
      try {
        const response = await request(user, `/v1/skills/${encodeURIComponent(canonical.id)}`, {
          method: 'PUT',
          body: canonicalUpdateBody(next, expectedVersion),
        });
        return {
          status: 'updated',
          skill: mapCanonicalSkill(response.skill, user, actor.id),
          warnings,
        };
      } catch (error) {
        if (error.status === 409 && error.code === 'skill_version_conflict') {
          const latest = await getCanonical(user, canonical.id);
          return latest
            ? { status: 'conflict', current: mapCanonicalSkill(latest, user, actor.id) }
            : { status: 'not_found' };
        }
        throw translateSkillMutationError(error);
      }
    });

  const deleteSkill = async (id) =>
    withActor(async (user) => {
      const canonical = await getCanonical(user, id);
      if (!canonical) return { deleted: false };
      await request(user, `/v1/skills/${encodeURIComponent(canonical.id)}`, { method: 'DELETE' });
      await Promise.allSettled(
        canonicalSkillFiles(canonical).map((file) =>
          request(user, `/v1/files/${encodeURIComponent(file.file_id)}`, { method: 'DELETE' }),
        ),
      );
      await pruneAgentSkillAllowlists(baseMethods, canonical.id);
      return { deleted: true };
    });

  const getSkillByName = async (name, accessibleIds, options = {}) =>
    withActor(async (user, actor) => {
      const skills = await listCanonicalSkills(user);
      const accessible = idSet(accessibleIds);
      const candidates = skills
        .filter((skill) => skill.name === name && accessible.has(skill.id))
        .sort(skillComparator);
      const preferred = candidates.find((skill) => {
        if (options.preferUserInvocable && skill.definition?.user_invocable === false) return false;
        if (options.preferModelInvocable && skill.definition?.disable_model_invocation === true)
          return false;
        return true;
      });
      const canonical = preferred ?? candidates[0];
      return canonical ? mapCanonicalSkill(canonical, user, actor.id) : null;
    });

  const getAuthorSkillByName = async ({ name }) =>
    withActor(async (user, actor) => {
      const canonical = (await listCanonicalSkills(user)).find(
        (skill) => skill.name === name && skill.owner_user_id === actor.id,
      );
      return canonical ? mapCanonicalSkill(canonical, user, actor.id) : null;
    });

  const listSkillsByAccess = async ({ accessibleIds, category, search, limit, cursor }) =>
    withActor(async (user, actor) => {
      const accessible = idSet(accessibleIds);
      const normalizedSearch = safeString(search, '', 200).toLocaleLowerCase();
      let skills = (await listCanonicalSkills(user))
        .filter((skill) => accessible.has(skill.id))
        .map((skill) => mapCanonicalSkill(skill, user, actor.id))
        .filter((skill) => !category || skill.category === category)
        .filter(
          (skill) =>
            !normalizedSearch ||
            [skill.name, skill.displayTitle, skill.description].some((value) =>
              String(value ?? '')
                .toLocaleLowerCase()
                .includes(normalizedSearch),
            ),
        )
        .sort(skillComparator);
      skills = filterAfterCursor(skills, cursor);
      return paginateSkills(skills, limit, (skill) => skillSummary(skill));
    });

  const listAlwaysApplySkills = async ({ accessibleIds, limit, cursor }) =>
    withActor(async (user, actor) => {
      const accessible = idSet(accessibleIds);
      let skills = (await listCanonicalSkills(user))
        .filter((skill) => accessible.has(skill.id) && skill.definition?.always_apply === true)
        .map((skill) => mapCanonicalSkill(skill, user, actor.id))
        .sort(skillComparator);
      skills = filterAfterCursor(skills, cursor);
      return paginateSkills(skills, limit, (skill) => ({
        _id: skill._id,
        name: skill.name,
        body: skill.body,
        author: skill.author,
        allowedTools: skill.allowedTools,
        updatedAt: skill.updatedAt,
      }));
    });

  const findSkillBySourceIdentity = async ({ source, upstreamId }) =>
    withActor(async (user, actor) => {
      const canonical = (await listCanonicalSkills(user)).find(
        (skill) =>
          skill.definition?.source === source &&
          skill.definition?.source_metadata?.upstreamId === upstreamId,
      );
      return canonical ? mapCanonicalSkill(canonical, user, actor.id) : null;
    });

  const listSkillsBySource = async ({ source, sourceId }) =>
    withActor(async (user, actor) =>
      (await listCanonicalSkills(user))
        .filter(
          (skill) =>
            skill.definition?.source === source &&
            skill.definition?.source_metadata?.sourceId === sourceId,
        )
        .map((skill) => mapCanonicalSkill(skill, user, actor.id)),
    );

  const listSkillFiles = async (skillId) =>
    withActor(async (user, actor) => {
      const canonical = await getCanonical(user, skillId);
      return canonical ? mapCanonicalSkillFiles(canonical, user, actor.id) : [];
    });

  const getSkillFileByPath = async (skillId, relativePath) =>
    withActor(async (user, actor) => {
      const canonical = await getCanonical(user, skillId);
      return canonical
        ? (mapCanonicalSkillFiles(canonical, user, actor.id).find(
            (file) => file.relativePath === relativePath,
          ) ?? null)
        : null;
    });

  const upsertSkillFile = async (row) => {
    const issues = validateRelativePath(row.relativePath);
    if (issues.length > 0) throw skillValidationError('Skill file validation failed', issues);
    if (!canonicalSkillId(row.file_id)) {
      throw skillValidationError('Skill file validation failed', [
        { field: 'file_id', code: 'INVALID_FORMAT', message: 'Canonical file ID is required' },
      ]);
    }
    return withActor(async (user, actor) => {
      const canonical = await mutateCanonicalSkillFiles(user, row.skillId, (files) => {
        const existing = files.find((file) => file.relative_path === row.relativePath);
        const now = new Date().toISOString();
        const next = {
          file_id: row.file_id,
          relative_path: row.relativePath,
          filename: safeString(row.filename, 'file', 300),
          media_type: safeString(row.mimeType, 'application/octet-stream', 200),
          bytes: boundedNumber(row.bytes),
          category: inferSkillFileCategory(row.relativePath),
          is_executable: row.isExecutable === true,
          source_metadata: plainObject(row.sourceMetadata),
          code_env_ref: existing?.code_env_ref,
          created_at: existing?.created_at ?? now,
          updated_at: now,
        };
        return [...files.filter((file) => file.relative_path !== row.relativePath), next];
      });
      return mapCanonicalSkillFiles(canonical, user, actor.id).find(
        (file) => file.relativePath === row.relativePath,
      );
    });
  };

  const deleteSkillFile = async (skillId, relativePath) =>
    withActor(async (user) => {
      const current = await getCanonical(user, skillId);
      if (
        !current ||
        !canonicalSkillFiles(current).some((file) => file.relative_path === relativePath)
      ) {
        return { deleted: false };
      }
      let removed;
      await mutateCanonicalSkillFiles(user, skillId, (files) => {
        removed = files.find((file) => file.relative_path === relativePath);
        return files.filter((file) => file.relative_path !== relativePath);
      });
      if (!removed) return { deleted: false };
      await request(user, `/v1/files/${encodeURIComponent(removed.file_id)}`, {
        method: 'DELETE',
      });
      return { deleted: true };
    });

  const updateSkillFileCodeEnvIds = async (updates) => {
    if (!Array.isArray(updates) || updates.length === 0)
      return { matchedCount: 0, modifiedCount: 0 };
    return withActor(async (user) => {
      const matched = new Set();
      for (const [skillId, skillUpdates] of groupBy(updates, (update) =>
        update.skillId.toString(),
      )) {
        await mutateCanonicalSkillFiles(user, skillId, (files) =>
          files.map((file) => {
            const update = skillUpdates.find(
              (candidate) => candidate.relativePath === file.relative_path,
            );
            if (!update) return file;
            matched.add(`${skillId}:${file.relative_path}`);
            return {
              ...file,
              code_env_ref: plainObject(update.codeEnvRef),
              updated_at: new Date().toISOString(),
            };
          }),
        );
      }
      return { matchedCount: matched.size, modifiedCount: matched.size };
    });
  };

  return {
    createSkill,
    getSkillById,
    getSkillByName,
    getAuthorSkillByName,
    listSkillsByAccess,
    listAlwaysApplySkills,
    updateSkill,
    deleteSkill,
    deleteUserSkills: async () => 0,
    findSkillBySourceIdentity,
    listSkillsBySource,
    listSkillFiles,
    upsertSkillFile,
    deleteSkillFile,
    getSkillFileByPath,
    updateSkillFileContent: async () => undefined,
    updateSkillFileCodeEnvIds,
  };
};

const loadCurrentUser = async () => {
  const userId = getContextUserId();
  if (!userId) throw httpError('User not authenticated', 401);
  return getCanonicalRequestUser(userId);
};

const request = (user, path, options = {}) =>
  callStaraApi(user, path, { ...options, tenantId: user.tenantId });

const listCanonicalSkills = async (user) => (await request(user, '/v1/skills')).skills ?? [];

const getCanonicalSkillAccess = async (user, skillId) =>
  (await request(user, `/v1/skills/${encodeURIComponent(requireCanonicalSkillId(skillId))}/access`))
    .access;

const listCanonicalSkillIds = async (user, requiredPermission, invoke = false) => {
  const skills = await listCanonicalSkills(user);
  if (requiredPermission === PermissionBits.VIEW && !invoke) return skills.map((skill) => skill.id);
  const checked = await Promise.all(
    skills.map(async (skill) => ({
      id: skill.id,
      allowed: await hasCanonicalSkillPermission(user, skill.id, requiredPermission, invoke),
    })),
  );
  return checked.filter(({ allowed }) => allowed).map(({ id }) => id);
};

const hasCanonicalSkillPermission = async (user, skillId, requiredPermission, invoke = false) => {
  try {
    const access = await getCanonicalSkillAccess(user, skillId);
    return requiredCanonicalSkillPermissions(requiredPermission, invoke).every((permission) =>
      access.permissions.includes(permission),
    );
  } catch (error) {
    if (error.status === 404) return false;
    throw error;
  }
};

const requiredCanonicalSkillPermissions = (requiredPermission, invoke = false) => {
  const permissions = [];
  if ((requiredPermission & PermissionBits.VIEW) !== 0)
    permissions.push(invoke ? 'skill.invoke' : 'skill.read');
  if ((requiredPermission & PermissionBits.EDIT) !== 0) permissions.push('skill.edit');
  if ((requiredPermission & PermissionBits.DELETE) !== 0) permissions.push('skill.delete');
  if ((requiredPermission & PermissionBits.SHARE) !== 0) permissions.push('skill.share');
  return permissions;
};

const canonicalSkillPermissionBits = (access, invoke = false) => {
  let bits = 0;
  if (access.permissions.includes(invoke ? 'skill.invoke' : 'skill.read'))
    bits |= PermissionBits.VIEW;
  if (access.permissions.includes('skill.edit')) bits |= PermissionBits.EDIT;
  if (access.permissions.includes('skill.delete')) bits |= PermissionBits.DELETE;
  if (access.permissions.includes('skill.share')) bits |= PermissionBits.SHARE;
  return bits;
};

const mapCanonicalSkill = (skill, user, actorId) => {
  const definition = plainObject(skill.definition);
  const compatibility = plainObject(definition.compatibility);
  const owner = skill.owner_user_id === actorId;
  const mapped = {
    _id: skill.id,
    name: skill.name,
    displayTitle: safeString(definition.display_title),
    description: skill.description ?? '',
    body: typeof definition.body === 'string' ? definition.body : '',
    frontmatter: plainObject(definition.frontmatter),
    disableModelInvocation: definition.disable_model_invocation === true,
    userInvocable: definition.user_invocable !== false,
    allowedTools: stringArray(definition.allowed_tools, 100),
    category: safeString(definition.category, '', 100),
    author: owner ? getUserId(user) : skill.owner_user_id,
    authorName: safeString(
      compatibility.author_name,
      owner
        ? safeString(user.name ?? user.username ?? user.email, 'Skill owner', 200)
        : 'Skill owner',
      200,
    ),
    version: skill.version,
    source: definition.source ?? 'inline',
    sourceMetadata: plainObject(definition.source_metadata),
    fileCount: canonicalSkillFiles(skill).length,
    alwaysApply: definition.always_apply === true,
    isPublic: false,
    tenantId: skill.tenant_id,
    createdAt: new Date(skill.created_at),
    updatedAt: new Date(skill.updated_at),
  };
  defineInternal(mapped, '__canonicalDefinition', definition);
  defineInternal(mapped, '__canonicalStatus', skill.status);
  defineInternal(mapped, '__canonicalOwnerId', skill.owner_user_id);
  return mapped;
};

const canonicalCreateBody = (skill) => ({
  name: skill.name,
  description: skill.description,
  definition: canonicalDefinition(skill),
  activate: true,
});

const canonicalUpdateBody = (skill, expectedVersion) => ({
  name: skill.name,
  description: skill.description,
  definition: canonicalDefinition(skill),
  activate: skill.__canonicalStatus !== 'draft',
  expected_version: expectedVersion,
});

const canonicalDefinition = (skill) => {
  const existing = plainObject(skill.__canonicalDefinition);
  const compatibility = {
    ...plainObject(existing.compatibility),
    author_name: safeString(skill.authorName, 'Skill owner', 200),
    skill_files: canonicalDefinitionFiles(existing),
  };
  return {
    body: typeof skill.body === 'string' ? skill.body : '',
    frontmatter: plainObject(skill.frontmatter),
    ...(safeString(skill.displayTitle, undefined, 128)
      ? { display_title: safeString(skill.displayTitle, undefined, 128) }
      : {}),
    disable_model_invocation: skill.disableModelInvocation === true,
    user_invocable: skill.userInvocable !== false,
    allowed_tools: stringArray(skill.allowedTools, 100),
    category: safeString(skill.category, '', 100),
    source: ['inline', 'github', 'notion'].includes(skill.source) ? skill.source : 'inline',
    source_metadata: plainObject(skill.sourceMetadata),
    always_apply: skill.alwaysApply === true,
    file_ids: compatibility.skill_files.map((file) => file.file_id),
    compatibility,
  };
};

const normalizeCreatedSkill = (data) => {
  const frontmatter = plainObject(data.frontmatter);
  const derived = deriveStructuredFrontmatterFields(frontmatter);
  return {
    ...data,
    body: typeof data.body === 'string' ? data.body : '',
    frontmatter,
    category: safeString(data.category, '', 100),
    disableModelInvocation: derived.disableModelInvocation ?? false,
    userInvocable: derived.userInvocable ?? true,
    allowedTools: derived.allowedTools ?? [],
    alwaysApply: resolveAlwaysApply(data.alwaysApply, frontmatter, data.body, false),
    source: data.source ?? 'inline',
    sourceMetadata: plainObject(data.sourceMetadata),
  };
};

const applySkillUpdate = (current, update = {}) => {
  const next = { ...current, ...definedEntries(update) };
  defineInternal(next, '__canonicalDefinition', current.__canonicalDefinition);
  defineInternal(next, '__canonicalStatus', current.__canonicalStatus);
  defineInternal(next, '__canonicalOwnerId', current.__canonicalOwnerId);
  if (update.frontmatter !== undefined) {
    next.frontmatter = plainObject(update.frontmatter);
    const derived = deriveStructuredFrontmatterFields(next.frontmatter);
    next.disableModelInvocation = derived.disableModelInvocation ?? false;
    next.userInvocable = derived.userInvocable ?? true;
    next.allowedTools = derived.allowedTools ?? [];
  }
  if (update.alwaysApply !== undefined) {
    next.alwaysApply = update.alwaysApply;
  } else if (update.frontmatter !== undefined || update.body !== undefined) {
    next.alwaysApply = resolveAlwaysApply(
      undefined,
      next.frontmatter,
      update.body,
      current.alwaysApply,
    );
  }
  return next;
};

const validateCanonicalSkill = (skill) => {
  const issues = [
    ...validateSkillName(skill.name),
    ...validateSkillDescription(skill.description),
    ...validateSkillBody(skill.body),
    ...validateSkillDisplayTitle(skill.displayTitle),
    ...validateSkillFrontmatter(skill.frontmatter),
    ...validateAlwaysApply(skill.alwaysApply),
    ...validateAlwaysApplyInBody(skill.body),
  ];
  const { errors, warnings } = partitionIssues(issues);
  if (errors.length > 0) throw skillValidationError('Skill validation failed', errors);
  return warnings;
};

const mutateCanonicalSkillFiles = async (user, skillId, transform) => {
  const id = requireCanonicalSkillId(skillId);
  for (let attempt = 0; attempt < MAX_MUTATION_RETRIES; attempt += 1) {
    const canonical = await (async () => {
      try {
        return (await request(user, `/v1/skills/${encodeURIComponent(id)}`)).skill;
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
    })();
    if (!canonical) throw httpError('Skill not found', 404);
    const definition = plainObject(canonical.definition);
    const files = normalizeSkillFiles(transform(canonicalSkillFiles(canonical)));
    if (files.length > MAX_SKILL_FILES) {
      throw httpError(`A skill can reference at most ${MAX_SKILL_FILES} files`, 400);
    }
    const compatibility = { ...plainObject(definition.compatibility), skill_files: files };
    try {
      const response = await request(user, `/v1/skills/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: {
          name: canonical.name,
          description: canonical.description,
          definition: {
            ...definition,
            file_ids: files.map((file) => file.file_id),
            compatibility,
          },
          activate: canonical.status !== 'draft',
          expected_version: canonical.version,
        },
      });
      return response.skill;
    } catch (error) {
      if (error.status === 409 && error.code === 'skill_version_conflict') continue;
      throw error;
    }
  }
  throw httpError('Skill changed repeatedly while updating file associations', 409);
};

const canonicalSkillFiles = (skill) =>
  normalizeSkillFiles(plainObject(skill.definition?.compatibility).skill_files);

const canonicalDefinitionFiles = (definition) =>
  normalizeSkillFiles(plainObject(definition.compatibility).skill_files);

const normalizeSkillFiles = (value) => {
  if (!Array.isArray(value)) return [];
  const paths = new Set();
  const ids = new Set();
  return value.flatMap((raw) => {
    const file = plainObject(raw);
    const fileId = canonicalSkillId(file.file_id);
    const relativePath = safeString(file.relative_path, undefined, 500);
    if (!fileId || !relativePath || paths.has(relativePath) || ids.has(fileId)) return [];
    paths.add(relativePath);
    ids.add(fileId);
    return [
      {
        file_id: fileId,
        relative_path: relativePath,
        filename: safeString(file.filename, relativePath.split('/').at(-1), 300),
        media_type: safeString(file.media_type, 'application/octet-stream', 200),
        bytes: boundedNumber(file.bytes),
        category: ['script', 'reference', 'asset', 'other'].includes(file.category)
          ? file.category
          : inferSkillFileCategory(relativePath),
        is_executable: file.is_executable === true,
        source_metadata: plainObject(file.source_metadata),
        ...(Object.keys(plainObject(file.code_env_ref)).length > 0
          ? { code_env_ref: plainObject(file.code_env_ref) }
          : {}),
        created_at: safeDateString(file.created_at),
        updated_at: safeDateString(file.updated_at),
      },
    ];
  });
};

const mapCanonicalSkillFiles = (skill, user, actorId) => {
  const owner = skill.owner_user_id === actorId;
  return canonicalSkillFiles(skill).map((file) => ({
    _id: file.file_id,
    skillId: skill.id,
    relativePath: file.relative_path,
    file_id: file.file_id,
    filename: file.filename,
    filepath: `/api/files/download/canonical/${encodeURIComponent(file.file_id)}`,
    storageKey: file.file_id,
    source: 'stara',
    sourceMetadata: file.source_metadata,
    mimeType: file.media_type,
    bytes: file.bytes,
    category: file.category,
    isExecutable: file.is_executable,
    author: owner ? getUserId(user) : skill.owner_user_id,
    tenantId: skill.tenant_id,
    codeEnvRef: file.code_env_ref,
    createdAt: new Date(file.created_at),
    updatedAt: new Date(file.updated_at),
  }));
};

const pruneAgentSkillAllowlists = async (methods, skillId) => {
  if (typeof methods.getAgents !== 'function' || typeof methods.updateAgent !== 'function') return;
  try {
    const agents = await methods.getAgents({});
    for (const agent of agents.filter((candidate) => candidate.skills?.includes(skillId))) {
      const skills = agent.skills.filter((id) => id !== skillId);
      await methods.updateAgent(
        { id: agent.id },
        { skills, ...(skills.length === 0 ? { skills_enabled: false } : {}) },
      );
    }
  } catch (error) {
    logger.error('[canonicalSkills] Failed to prune deleted skill from agent allowlists', error);
  }
};

const resolveAlwaysApply = (explicit, frontmatter, body, fallback) => {
  if (typeof explicit === 'boolean') return explicit;
  const structured = structuredAlwaysApply(frontmatter);
  if (typeof structured === 'boolean') return structured;
  if (typeof body !== 'string') return fallback;
  const match = body.match(/^---[\s\S]*?^always(?:-apply|Apply):\s*(true|false)\s*(?:#.*)?$/im);
  return match ? match[1].toLowerCase() === 'true' : false;
};

const structuredAlwaysApply = (frontmatter) => {
  const value = frontmatter?.['always-apply'] ?? frontmatter?.alwaysApply;
  return typeof value === 'boolean' ? value : undefined;
};

const skillSummary = (skill) => {
  const { body: _body, frontmatter: _frontmatter, ...summary } = skill;
  return summary;
};

const paginateSkills = (skills, limit, map) => {
  const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const page = skills.slice(0, normalizedLimit + 1);
  const hasMore = page.length > normalizedLimit;
  const selected = hasMore ? page.slice(0, normalizedLimit) : page;
  return {
    skills: selected.map(map),
    has_more: hasMore,
    after: hasMore ? encodeSkillCursor(selected.at(-1)) : null,
  };
};

const skillComparator = (left, right) =>
  String(right.updatedAt ?? right.updated_at).localeCompare(
    String(left.updatedAt ?? left.updated_at),
  ) || String(left._id ?? left.id).localeCompare(String(right._id ?? right.id));

const filterAfterCursor = (skills, cursor) => {
  if (!cursor) return skills;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    return skills.filter(
      (skill) =>
        skill.updatedAt.toISOString().localeCompare(decoded.updatedAt) < 0 ||
        (skill.updatedAt.toISOString() === decoded.updatedAt && skill._id > decoded.id),
    );
  } catch {
    throw httpError('Invalid canonical skill cursor', 400);
  }
};

const encodeSkillCursor = (skill) =>
  Buffer.from(JSON.stringify({ updatedAt: skill.updatedAt.toISOString(), id: skill._id })).toString(
    'base64',
  );

const canonicalSkillId = (value) =>
  typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;

const requireCanonicalSkillId = (value) => {
  const id = canonicalSkillId(value?.toString?.() ?? value);
  if (id) return id;
  throw httpError('Skill not found', 404);
};

const idSet = (values) => new Set((values ?? []).map((value) => value.toString()));
const plainObject = (value) =>
  value != null && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
const stringArray = (value, max) =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, max) : [];
const definedEntries = (value) =>
  Object.fromEntries(Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined));
const boundedNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(number, Number.MAX_SAFE_INTEGER) : 0;
};
const safeDateString = (value) => {
  const date = new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};
const defineInternal = (target, key, value) =>
  Object.defineProperty(target, key, {
    value: structuredClone(value),
    enumerable: false,
    writable: true,
  });
const skillValidationError = (message, issues) =>
  Object.assign(new Error(message), { code: 'SKILL_VALIDATION_FAILED', issues });
const translateSkillMutationError = (error) => {
  if (error?.status === 409 && error?.code === 'skill_name_conflict') {
    error.code = 11000;
  }
  return error;
};
const httpError = (message, status) => Object.assign(new Error(message), { status });
const groupBy = (values, keyFor) => {
  const groups = new Map();
  for (const value of values) {
    const key = keyFor(value);
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return groups;
};

module.exports = {
  canonicalSkillId,
  canonicalSkillPermissionBits,
  canonicalSkillsEnabled,
  createCanonicalSkillMethods,
  getCanonicalSkillAccess,
  hasCanonicalSkillPermission,
  listCanonicalSkillIds,
  mapCanonicalSkill,
  requiredCanonicalSkillPermissions,
};
