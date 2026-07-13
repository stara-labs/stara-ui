import { PermissionBits } from 'librechat-data-provider';
import type { StaraPromptRequest, StaraPromptUser } from './stara';
import {
  canonicalPromptPermissionBits,
  canonicalPromptsEnabled,
  createStaraPromptMethods,
  requiredCanonicalPromptPermissions,
} from './stara';

const promptId = '11111111-1111-4111-8111-111111111111';
const firstVersionId = '22222222-2222-4222-8222-222222222222';
const secondVersionId = '33333333-3333-4333-8333-333333333333';
const tenantId = '44444444-4444-4444-8444-444444444444';
const actorId = '55555555-5555-4555-8555-555555555555';
const user: StaraPromptUser = {
  id: 'mongo-user',
  email: 'owner@example.com',
  name: 'Prompt Owner',
  tenantId: 'tenant_acme',
};

describe('Stara canonical prompt adapter', () => {
  it('uses the workspace flag unless the prompt flag explicitly overrides it', () => {
    expect(canonicalPromptsEnabled({ STARA_CANONICAL_WORKSPACE: 'true' })).toBe(true);
    expect(
      canonicalPromptsEnabled({
        STARA_CANONICAL_WORKSPACE: 'true',
        STARA_CANONICAL_PROMPTS: 'false',
      }),
    ).toBe(false);
  });

  it('maps canonical roles to legacy permission bits without conflating view and use', () => {
    const access = {
      prompt_id: promptId,
      owner: false,
      role_keys: ['operator' as const],
      permissions: ['prompt.read', 'prompt.use'],
    };
    expect(canonicalPromptPermissionBits(access)).toBe(PermissionBits.VIEW);
    expect(canonicalPromptPermissionBits(access, true)).toBe(PermissionBits.VIEW);
    expect(requiredCanonicalPromptPermissions(PermissionBits.VIEW, true)).toEqual(['prompt.use']);
    expect(requiredCanonicalPromptPermissions(PermissionBits.VIEW | PermissionBits.EDIT)).toEqual([
      'prompt.read',
      'prompt.edit',
    ]);
  });

  it('preserves the Prompt Library contract across create, version, deploy, list, and delete', async () => {
    let prompt = canonicalPrompt(firstVersionId, 1);
    const versions = [prompt.production_version];
    const calls: Array<{ path: string; method: string; body?: object }> = [];
    const request: StaraPromptRequest = async <TResponse>(
      _user: StaraPromptUser,
      path: string,
      options = {},
    ): Promise<TResponse> => {
      const method = options.method ?? 'GET';
      calls.push({ path, method, ...(options.body ? { body: options.body } : {}) });
      let response: object;
      if (path === '/v1/prompts' && method === 'POST') {
        response = { prompt, prompt_version: versions[0], action_version_id: 'action-create' };
      } else if (path === '/v1/prompts' || path.startsWith('/v1/prompts?')) {
        response = { prompts: [prompt] };
      } else if (path === `/v1/prompts/${promptId}` && method === 'GET') {
        response = { prompt };
      } else if (path === `/v1/prompts/${promptId}/versions` && method === 'GET') {
        response = { prompt_versions: [...versions].reverse() };
      } else if (path === `/v1/prompts/${promptId}/versions` && method === 'POST') {
        const version = canonicalVersion(secondVersionId, 2, 'Second governed version', 'chat');
        versions.push(version);
        prompt = { ...prompt, version: 2, updated_at: '2026-07-13T01:00:00.000Z' };
        response = { prompt, prompt_version: version, action_version_id: 'action-version' };
      } else if (path === `/v1/prompt-versions/${secondVersionId}`) {
        response = { prompt_version: versions[1] };
      } else if (path === `/v1/prompts/${promptId}/production` && method === 'PUT') {
        prompt = {
          ...prompt,
          production_version_id: secondVersionId,
          production_version: versions[1],
          version: 3,
        };
        response = { prompt, prompt_version: versions[1], action_version_id: 'action-production' };
      } else if (path === `/v1/prompts/${promptId}/use` && method === 'POST') {
        response = { number_of_generations: 1, action_version_id: 'action-use' };
      } else if (
        path === `/v1/prompts/${promptId}/versions/${secondVersionId}?expected_version=3` &&
        method === 'DELETE'
      ) {
        prompt = {
          ...prompt,
          production_version_id: firstVersionId,
          production_version: versions[0],
          version: 4,
        };
        response = {
          prompt,
          prompt_version: { ...versions[1], status: 'deleted' },
          action_version_id: 'action-delete',
        };
      } else {
        throw new Error(`Unexpected request: ${method} ${path}`);
      }
      return response as TResponse;
    };
    const methods = createStaraPromptMethods({
      withActor: (callback) => callback(user, { id: actorId }),
      request,
      getUserId: (current) => current.id,
      safeString: (value, fallback, maxLength = 512) =>
        typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback,
    });

    const created = await methods.createPromptGroup({
      prompt: { prompt: 'Initial governed version', type: 'text' },
      group: { name: 'Release summary', category: 'engineering' },
    });
    expect(created).toMatchObject({
      prompt: { _id: firstVersionId, groupId: promptId },
      group: {
        _id: promptId,
        author: 'mongo-user',
        productionId: firstVersionId,
        isPublic: false,
      },
    });

    const added = await methods.savePrompt({
      prompt: { groupId: promptId, prompt: 'Second governed version', type: 'chat' },
    });
    expect(added.prompt).toMatchObject({ _id: secondVersionId, type: 'chat' });

    await expect(methods.makePromptProduction(secondVersionId)).resolves.toEqual({
      message: 'Prompt production made successfully',
    });
    await expect(methods.incrementPromptGroupUsage(promptId)).resolves.toEqual({
      numberOfGenerations: 1,
    });

    const listed = await methods.getListPromptGroupsByAccess({
      accessibleIds: [promptId],
      canonicalFilter: { category: 'engineering' },
      limit: 20,
    });
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]).toMatchObject({ productionId: secondVersionId });

    await expect(
      methods.deletePrompt({ promptId: secondVersionId, groupId: promptId }),
    ).resolves.toEqual({
      prompt: 'Prompt deleted successfully',
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/v1/prompts', method: 'POST' }),
        expect.objectContaining({ path: `/v1/prompt-versions/${secondVersionId}` }),
        expect.objectContaining({ path: `/v1/prompts/${promptId}/production`, method: 'PUT' }),
        expect.objectContaining({
          path: `/v1/prompts/${promptId}/versions/${secondVersionId}?expected_version=3`,
          method: 'DELETE',
        }),
      ]),
    );
  });
});

function canonicalPrompt(productionVersionId: string, version: number) {
  return {
    id: promptId,
    tenant_id: tenantId,
    owner_user_id: actorId,
    owner_display_name: 'Prompt Owner',
    name: 'Release summary',
    oneliner: 'Summarize an approved release.',
    category: 'engineering',
    command: 'release-summary',
    number_of_generations: 0,
    production_version_id: productionVersionId,
    production_version: canonicalVersion(
      productionVersionId,
      1,
      'Initial governed version',
      'text',
    ),
    version,
    status: 'active' as const,
    created_at: '2026-07-13T00:00:00.000Z',
    updated_at: '2026-07-13T00:00:00.000Z',
  };
}

function canonicalVersion(
  id: string,
  versionNumber: number,
  content: string,
  type: 'text' | 'chat',
) {
  return {
    id,
    tenant_id: tenantId,
    prompt_id: promptId,
    author_user_id: actorId,
    version_number: versionNumber,
    content,
    type,
    status: 'active' as const,
    created_at: `2026-07-13T0${versionNumber - 1}:00:00.000Z`,
  };
}
