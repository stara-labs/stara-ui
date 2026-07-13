import { PermissionBits } from 'librechat-data-provider';
import type { TPrompt, TPromptGroup } from 'librechat-data-provider';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export interface StaraPromptUser {
  id?: string;
  _id?: { toString(): string } | string;
  email?: string;
  name?: string;
  username?: string;
  tenantId?: string;
}

export interface StaraPromptActor {
  id: string;
}

export interface StaraPromptRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: object;
}

export interface StaraPromptRequest {
  <TResponse>(
    user: StaraPromptUser,
    path: string,
    options?: StaraPromptRequestOptions,
  ): Promise<TResponse>;
}

export interface CanonicalPromptVersion {
  id: string;
  tenant_id: string;
  prompt_id: string;
  author_user_id: string;
  version_number: number;
  content: string;
  type: 'text' | 'chat';
  status: 'active' | 'deleted';
  created_at: string;
}

export interface CanonicalPrompt {
  id: string;
  tenant_id: string;
  owner_user_id: string;
  owner_display_name: string | null;
  name: string;
  oneliner: string;
  category: string;
  command: string | null;
  number_of_generations: number;
  production_version_id: string;
  production_version: CanonicalPromptVersion;
  version: number;
  status: 'active' | 'archived' | 'deleted';
  created_at: string;
  updated_at: string;
}

export interface CanonicalPromptAccess {
  prompt_id: string;
  owner: boolean;
  role_keys: Array<'viewer' | 'operator' | 'editor' | 'owner'>;
  permissions: string[];
}

interface CanonicalPromptResponse {
  prompt: CanonicalPrompt;
}

interface CanonicalPromptVersionResponse {
  prompt_version: CanonicalPromptVersion;
}

interface CanonicalPromptMutationResponse extends CanonicalPromptResponse {
  prompt_version: CanonicalPromptVersion;
  action_version_id: string;
}

interface CanonicalPromptListResponse {
  prompts: CanonicalPrompt[];
}

interface CanonicalPromptVersionsResponse {
  prompt_versions: CanonicalPromptVersion[];
}

interface CanonicalPromptUsageResponse {
  number_of_generations: number;
}

interface PromptSaveData {
  prompt: {
    prompt: string;
    type: 'text' | 'chat';
    groupId?: string;
  };
  group?: {
    name?: string;
    oneliner?: string;
    category?: string;
    command?: string | null;
  };
}

interface PromptFilter {
  _id?: string | { toString(): string };
  groupId?: string | { toString(): string };
  author?: string | { toString(): string };
}

interface PromptGroupFilter {
  _id?: string | { toString(): string };
}

interface PromptGroupUpdate {
  name?: string;
  oneliner?: string;
  category?: string;
  command?: string | null;
}

interface PromptGroupListInput {
  accessibleIds?: Array<string | { toString(): string }>;
  canonicalFilter?: { name?: string; category?: string };
  limit?: number | string;
  after?: string | null;
}

interface PromptGroupListResult {
  data: TPromptGroup[];
  has_more: boolean;
  after: string | null;
}

interface PromptDeleteInput {
  promptId: string | { toString(): string };
  groupId: string | { toString(): string };
}

interface PromptDeleteResult {
  prompt: string;
  promptGroup?: { message: string; id: string };
}

interface StaraPromptMethodsDependencies {
  withActor<T>(
    callback: (user: StaraPromptUser, actor: StaraPromptActor) => Promise<T>,
  ): Promise<T>;
  request: StaraPromptRequest;
  getUserId(user: StaraPromptUser): string | undefined;
  safeString(
    value: string | null | undefined,
    fallback?: string,
    maxLength?: number,
  ): string | undefined;
}

export interface StaraPromptMethods {
  createPromptGroup(data: PromptSaveData): Promise<{ prompt: TPrompt; group: TPromptGroup }>;
  savePrompt(data: PromptSaveData): Promise<{ prompt: TPrompt }>;
  getPrompts(filter: PromptFilter): Promise<TPrompt[]>;
  getPrompt(filter: PromptFilter): Promise<TPrompt | null>;
  getPromptGroup(filter: PromptGroupFilter): Promise<TPromptGroup | null>;
  updatePromptGroup(filter: PromptGroupFilter, data: PromptGroupUpdate): Promise<TPromptGroup>;
  incrementPromptGroupUsage(groupId: string): Promise<{ numberOfGenerations: number }>;
  makePromptProduction(promptVersionId: string): Promise<{ message: string }>;
  deletePrompt(input: PromptDeleteInput): Promise<PromptDeleteResult>;
  deletePromptGroup(input: PromptGroupFilter): Promise<{ message: string }>;
  getListPromptGroupsByAccess(input: PromptGroupListInput): Promise<PromptGroupListResult>;
  getAllPromptGroups(): Promise<TPromptGroup[]>;
  getOwnedPromptGroupIds(author: string): Promise<string[]>;
}

export function canonicalPromptsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const explicit = env.STARA_CANONICAL_PROMPTS;
  const value = explicit == null ? env.STARA_CANONICAL_WORKSPACE : explicit;
  return TRUE_VALUES.has(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );
}

export function canonicalPromptId(
  value: string | { toString(): string } | null | undefined,
): string | null {
  const normalized = value?.toString().trim();
  return normalized && UUID_PATTERN.test(normalized) ? normalized : null;
}

export function createStaraPromptMethods(
  dependencies: StaraPromptMethodsDependencies,
): StaraPromptMethods {
  const { withActor, request, getUserId, safeString } = dependencies;

  const getCanonicalPrompt = async (
    user: StaraPromptUser,
    promptId: string | { toString(): string } | null | undefined,
  ): Promise<CanonicalPrompt | null> => {
    const id = canonicalPromptId(promptId);
    if (!id) {
      return null;
    }
    try {
      return (await request<CanonicalPromptResponse>(user, `/v1/prompts/${encodeURIComponent(id)}`))
        .prompt;
    } catch (error) {
      if (httpStatus(error) === 404) {
        return null;
      }
      throw error;
    }
  };

  const getCanonicalVersion = async (
    user: StaraPromptUser,
    promptVersionId: string | { toString(): string } | null | undefined,
  ): Promise<CanonicalPromptVersion | null> => {
    const id = canonicalPromptId(promptVersionId);
    if (!id) {
      return null;
    }
    try {
      return (
        await request<CanonicalPromptVersionResponse>(
          user,
          `/v1/prompt-versions/${encodeURIComponent(id)}`,
        )
      ).prompt_version;
    } catch (error) {
      if (httpStatus(error) === 404) {
        return null;
      }
      throw error;
    }
  };

  const listCanonicalPrompts = async (
    user: StaraPromptUser,
    filter: { name?: string; category?: string } = {},
  ): Promise<CanonicalPrompt[]> => {
    const params = new URLSearchParams();
    if (filter.name) {
      params.set('name', filter.name);
    }
    if (filter.category) {
      params.set('category', filter.category);
    }
    const query = params.toString();
    return (
      await request<CanonicalPromptListResponse>(user, `/v1/prompts${query ? `?${query}` : ''}`)
    ).prompts;
  };

  const mapVersion = (
    version: CanonicalPromptVersion,
    user: StaraPromptUser,
    actorId: string,
  ): TPrompt => ({
    _id: version.id,
    groupId: version.prompt_id,
    author:
      version.author_user_id === actorId ? (getUserId(user) ?? actorId) : version.author_user_id,
    prompt: version.content,
    type: version.type,
    createdAt: version.created_at,
    updatedAt: version.created_at,
  });

  const mapGroup = (
    prompt: CanonicalPrompt,
    user: StaraPromptUser,
    actorId: string,
  ): TPromptGroup => {
    const owner = prompt.owner_user_id === actorId;
    return {
      _id: prompt.id,
      name: prompt.name,
      numberOfGenerations: prompt.number_of_generations,
      command: prompt.command ?? undefined,
      oneliner: prompt.oneliner,
      category: prompt.category,
      productionId: prompt.production_version_id,
      productionPrompt: mapVersion(prompt.production_version, user, actorId),
      author: owner ? (getUserId(user) ?? actorId) : prompt.owner_user_id,
      authorName:
        safeString(
          prompt.owner_display_name,
          owner
            ? safeString(user.name ?? user.username ?? user.email, 'Prompt owner', 200)
            : 'Prompt owner',
          200,
        ) ?? 'Prompt owner',
      isPublic: false,
      createdAt: new Date(prompt.created_at),
      updatedAt: new Date(prompt.updated_at),
    };
  };

  const createPromptGroup = (data: PromptSaveData) =>
    withActor(async (user, actor) => {
      const group = data.group;
      if (!group?.name) {
        throw httpError('Prompt group name is required', 400);
      }
      const response = await request<CanonicalPromptMutationResponse>(user, '/v1/prompts', {
        method: 'POST',
        body: {
          name: group.name,
          oneliner: group.oneliner ?? '',
          category: group.category ?? '',
          command: group.command || null,
          content: data.prompt.prompt,
          type: data.prompt.type,
        },
      });
      return {
        prompt: mapVersion(response.prompt_version, user, actor.id),
        group: mapGroup(response.prompt, user, actor.id),
      };
    });

  const savePrompt = (data: PromptSaveData) =>
    withActor(async (user, actor) => {
      const group = await getCanonicalPrompt(user, data.prompt.groupId);
      if (!group) {
        throw httpError('Prompt group not found', 404);
      }
      const response = await request<CanonicalPromptMutationResponse>(
        user,
        `/v1/prompts/${encodeURIComponent(group.id)}/versions`,
        {
          method: 'POST',
          body: {
            content: data.prompt.prompt,
            type: data.prompt.type,
            expected_version: group.version,
            make_production: false,
          },
        },
      );
      return { prompt: mapVersion(response.prompt_version, user, actor.id) };
    });

  const getPrompts = (filter: PromptFilter) =>
    withActor(async (user, actor) => {
      const groupId = canonicalPromptId(filter.groupId);
      if (groupId) {
        const response = await request<CanonicalPromptVersionsResponse>(
          user,
          `/v1/prompts/${encodeURIComponent(groupId)}/versions`,
        );
        return response.prompt_versions.map((version) => mapVersion(version, user, actor.id));
      }
      const author = filter.author?.toString();
      return (await listCanonicalPrompts(user))
        .map((prompt) => mapGroup(prompt, user, actor.id))
        .filter((group) => !author || group.author === author)
        .map((group) => group.productionPrompt)
        .filter((prompt): prompt is TPrompt => prompt != null);
    });

  const getPrompt = (filter: PromptFilter) =>
    withActor(async (user, actor) => {
      const version = await getCanonicalVersion(user, filter._id);
      return version ? mapVersion(version, user, actor.id) : null;
    });

  const getPromptGroup = (filter: PromptGroupFilter) =>
    withActor(async (user, actor) => {
      const prompt = await getCanonicalPrompt(user, filter._id);
      return prompt ? mapGroup(prompt, user, actor.id) : null;
    });

  const updatePromptGroup = (filter: PromptGroupFilter, data: PromptGroupUpdate) =>
    withActor(async (user, actor) => {
      const current = await getCanonicalPrompt(user, filter._id);
      if (!current) {
        throw httpError('Prompt group not found', 404);
      }
      const response = await request<CanonicalPromptResponse>(
        user,
        `/v1/prompts/${encodeURIComponent(current.id)}`,
        {
          method: 'PUT',
          body: {
            name: data.name ?? current.name,
            oneliner: data.oneliner ?? current.oneliner,
            category: data.category ?? current.category,
            command: data.command === undefined ? current.command : data.command,
            expected_version: current.version,
          },
        },
      );
      return mapGroup(response.prompt, user, actor.id);
    });

  const incrementPromptGroupUsage = (groupId: string) =>
    withActor(async (user) => {
      const id = requireCanonicalPromptId(groupId);
      const response = await request<CanonicalPromptUsageResponse>(
        user,
        `/v1/prompts/${encodeURIComponent(id)}/use`,
        { method: 'POST' },
      );
      return { numberOfGenerations: response.number_of_generations };
    });

  const makePromptProduction = (promptVersionId: string) =>
    withActor(async (user) => {
      const version = await getCanonicalVersion(user, promptVersionId);
      if (!version) {
        throw httpError('Prompt version not found', 404);
      }
      const group = await getCanonicalPrompt(user, version.prompt_id);
      if (!group) {
        throw httpError('Prompt group not found', 404);
      }
      await request<CanonicalPromptMutationResponse>(
        user,
        `/v1/prompts/${encodeURIComponent(group.id)}/production`,
        {
          method: 'PUT',
          body: {
            prompt_version_id: version.id,
            expected_version: group.version,
          },
        },
      );
      return { message: 'Prompt production made successfully' };
    });

  const deletePrompt = (input: PromptDeleteInput) =>
    withActor(async (user) => {
      const groupId = requireCanonicalPromptId(input.groupId);
      const promptVersionId = requireCanonicalPromptId(input.promptId);
      const group = await getCanonicalPrompt(user, groupId);
      if (!group) {
        throw httpError('Prompt group not found', 404);
      }
      const response = await request<CanonicalPromptMutationResponse>(
        user,
        `/v1/prompts/${encodeURIComponent(groupId)}/versions/${encodeURIComponent(promptVersionId)}?expected_version=${group.version}`,
        { method: 'DELETE' },
      );
      return {
        prompt: 'Prompt deleted successfully',
        ...(response.prompt.status === 'archived'
          ? {
              promptGroup: {
                message: 'Prompt group deleted successfully',
                id: groupId,
              },
            }
          : {}),
      };
    });

  const deletePromptGroup = (input: PromptGroupFilter) =>
    withActor(async (user) => {
      const id = requireCanonicalPromptId(input._id);
      await request<CanonicalPromptResponse>(user, `/v1/prompts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      return { message: 'Prompt group deleted successfully' };
    });

  const getListPromptGroupsByAccess = (input: PromptGroupListInput) =>
    withActor(async (user, actor) => {
      const accessible = new Set(
        (input.accessibleIds ?? []).map((id) => canonicalPromptId(id)).filter(isPresent),
      );
      const mapped = (await listCanonicalPrompts(user, input.canonicalFilter))
        .filter((prompt) => accessible.has(prompt.id))
        .map((prompt) => mapGroup(prompt, user, actor.id))
        .sort(promptGroupComparator);
      const after = decodeCursor(input.after);
      const start = after ? mapped.findIndex((group) => group._id === after.id) + 1 : 0;
      const limit = normalizeLimit(input.limit, mapped.length || 1);
      const page = mapped.slice(Math.max(0, start), Math.max(0, start) + limit + 1);
      const hasMore = page.length > limit;
      const data = hasMore ? page.slice(0, limit) : page;
      return {
        data,
        has_more: hasMore,
        after: hasMore && data.length > 0 ? encodeCursor(data[data.length - 1]) : null,
      };
    });

  const getAllPromptGroups = () =>
    withActor(async (user, actor) =>
      (await listCanonicalPrompts(user))
        .map((prompt) => mapGroup(prompt, user, actor.id))
        .sort(promptGroupComparator),
    );

  const getOwnedPromptGroupIds = (_author: string) =>
    withActor(async (user, actor) =>
      (await listCanonicalPrompts(user))
        .filter((prompt) => prompt.owner_user_id === actor.id)
        .map((prompt) => prompt.id),
    );

  return {
    createPromptGroup,
    savePrompt,
    getPrompts,
    getPrompt,
    getPromptGroup,
    updatePromptGroup,
    incrementPromptGroupUsage,
    makePromptProduction,
    deletePrompt,
    deletePromptGroup,
    getListPromptGroupsByAccess,
    getAllPromptGroups,
    getOwnedPromptGroupIds,
  };
}

export function requiredCanonicalPromptPermissions(
  requiredPermission: number,
  invoke = false,
): string[] {
  const permissions: string[] = [];
  if ((requiredPermission & PermissionBits.VIEW) !== 0) {
    permissions.push(invoke ? 'prompt.use' : 'prompt.read');
  }
  if ((requiredPermission & PermissionBits.EDIT) !== 0) {
    permissions.push('prompt.edit');
  }
  if ((requiredPermission & PermissionBits.DELETE) !== 0) {
    permissions.push('prompt.delete');
  }
  if ((requiredPermission & PermissionBits.SHARE) !== 0) {
    permissions.push('prompt.share');
  }
  return permissions;
}

export function canonicalPromptPermissionBits(
  access: CanonicalPromptAccess,
  invoke = false,
): number {
  let bits = 0;
  if (access.permissions.includes(invoke ? 'prompt.use' : 'prompt.read')) {
    bits |= PermissionBits.VIEW;
  }
  if (access.permissions.includes('prompt.edit')) {
    bits |= PermissionBits.EDIT;
  }
  if (access.permissions.includes('prompt.delete')) {
    bits |= PermissionBits.DELETE;
  }
  if (access.permissions.includes('prompt.share')) {
    bits |= PermissionBits.SHARE;
  }
  return bits;
}

function requireCanonicalPromptId(
  value: string | { toString(): string } | null | undefined,
): string {
  const id = canonicalPromptId(value);
  if (!id) {
    throw httpError('A canonical prompt UUID is required', 400);
  }
  return id;
}

function promptGroupComparator(left: TPromptGroup, right: TPromptGroup): number {
  return (
    (right.numberOfGenerations ?? 0) - (left.numberOfGenerations ?? 0) ||
    new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime() ||
    String(left._id).localeCompare(String(right._id))
  );
}

interface PromptCursor {
  id: string;
}

function encodeCursor(group: TPromptGroup): string {
  return Buffer.from(JSON.stringify({ id: group._id }), 'utf8').toString('base64url');
}

function decodeCursor(value: string | null | undefined): PromptCursor | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Partial<PromptCursor>;
    return typeof parsed.id === 'string' ? { id: parsed.id } : null;
  } catch {
    return null;
  }
}

function normalizeLimit(value: string | number | undefined, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 100) : fallback;
}

function httpStatus(error: unknown): number | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
    ? error.status
    : undefined;
}

function httpError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}
