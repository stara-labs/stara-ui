jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
}));

const {
  createEngineeringTaskController,
  decideEngineeringRunController,
  getEngineeringContextController,
  updateBusinessProfileController,
  updateRepositoryConnectionController,
} = require('./StaraEngineeringController');

const originalStaraApiUrl = process.env.STARA_API_URL;

describe('StaraEngineeringController canonical API proxy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STARA_API_URL = 'http://stara-api:3081';
  });

  afterAll(() => restoreEnv('STARA_API_URL', originalStaraApiUrl));

  it('loads live engineering state for the server-resolved active organization', async () => {
    mockFetchJson(activeOrganizations());
    mockFetchJson({ repositories: [repository()] });
    mockFetchJson({ tasks: [taskAggregate()] });
    mockFetchJson({ approvals: [approval()] });
    mockFetchJson({ business_profile: businessProfile() });
    mockFetchJson({ policy_config: policyConfig() });
    mockFetchJson({ readiness: readiness() });
    const res = makeRes();

    await getEngineeringContextController(makeReq(), res);

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'http://stara-api:3081/v1/engineering/repositories',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-stara-tenant-id': '11111111-1111-4111-8111-111111111111',
          'x-stara-email-verified': 'true',
          'x-stara-mfa-enrolled': 'true',
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      active_org_name: 'Stara Labs',
      actor_role_key: 'owner',
      permissions: {
        can_connect_repository: true,
        can_create_task: true,
        can_decide_approval: true,
        can_update_business_profile: true,
      },
      repositories: [{ repository_name: 'stara-ui' }],
      tasks: [{ task: { title: 'Improve Stara' } }],
      approvals: [{ target: 'merge' }],
      business_profile: { business_summary: 'Stara builds governed software delivery.' },
    });
  });

  it('returns a deliberate empty state when no active organization exists', async () => {
    mockFetchJson({ active_tenant_id: null, orgs: [] });
    const res = makeRes();

    await getEngineeringContextController(makeReq(), res);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        active_tenant_id: null,
        repositories: [],
        tasks: [],
        approvals: [],
      }),
    );
  });

  it('keeps the workspace available while an older API has no business-profile route', async () => {
    mockFetchJson(activeOrganizations());
    mockFetchJson({ repositories: [repository()] });
    mockFetchJson({ tasks: [taskAggregate()] });
    mockFetchJson({ approvals: [] });
    mockFetchJson({ error: 'not_found' }, 404);
    mockFetchJson({ policy_config: policyConfig() });
    mockFetchJson({ readiness: readiness() });
    const res = makeRes();

    await getEngineeringContextController(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ business_profile: null, repositories: [repository()] }),
    );
  });

  it('creates tasks under the canonical active tenant instead of browser tenant input', async () => {
    mockFetchJson(activeOrganizations());
    mockFetchJson(taskAggregate());
    const payload = {
      idempotency_key: 'ui-task-00000001',
      title: 'Improve Stara',
      goal: 'Ship the live workflow view.',
      acceptance_criteria: ['The task is visible.'],
      risk_class: 'medium',
      target_environment: 'staging',
      repositories: [{ repository_connection_id: repository().id, dependency_order: 0 }],
    };
    const res = makeRes();

    await createEngineeringTaskController(
      makeReq({ body: payload, user: { tenantId: 'browser-supplied-tenant' } }),
      res,
    );

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'http://stara-api:3081/v1/engineering/tasks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
        headers: expect.objectContaining({
          'x-stara-tenant-id': '11111111-1111-4111-8111-111111111111',
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('forwards bounded approval decisions and preserves canonical API failures', async () => {
    mockFetchJson(activeOrganizations());
    mockFetchJson({
      aggregate: runAggregate(),
      review: { ...approval(), status: 'approved', decision: 'approved' },
      deduplicated: false,
    });
    const body = {
      target: 'merge',
      decision: 'approved',
      expected_version: 4,
      idempotency_key: 'approval-00000001',
      reason_redacted: 'Checks and review evidence are satisfactory.',
    };
    const res = makeRes();

    await decideEngineeringRunController(makeReq({ params: { runId: run().id }, body }), res);

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `http://stara-api:3081/v1/engineering/runs/${run().id}/decisions`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('updates business context for the server-resolved active organization', async () => {
    mockFetchJson(activeOrganizations());
    mockFetchJson({ business_profile: businessProfile() });
    const res = makeRes();
    const body = {
      business_summary: 'Stara builds governed software delivery.',
      primary_outcomes: ['Ship safe improvements'],
      critical_workflows: ['Task to deployment'],
      operating_constraints: ['Keep the active release available'],
    };

    await updateBusinessProfileController(makeReq({ body }), res);

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'http://stara-api:3081/v1/orgs/11111111-1111-4111-8111-111111111111/business-profile',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(body),
        headers: expect.objectContaining({
          'x-stara-tenant-id': '11111111-1111-4111-8111-111111111111',
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('updates repository configuration under the server-resolved active organization', async () => {
    mockFetchJson(activeOrganizations());
    mockFetchJson({
      repository: { ...repository(), version: 2 },
      action_version_id: 'action-repository-update',
    });
    const res = makeRes();
    const body = {
      expected_version: 1,
      check_profiles: [
        {
          profile_id: 'package-check',
          label: 'Package check',
          runner: 'npm',
          script: 'stara:precommit-ci',
          working_directory: '.',
        },
      ],
    };

    await updateRepositoryConnectionController(
      makeReq({ params: { repositoryId: repository().id }, body }),
      res,
    );

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `http://stara-api:3081/v1/engineering/repositories/${repository().id}`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: expect.objectContaining({
          'x-stara-tenant-id': '11111111-1111-4111-8111-111111111111',
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

function makeReq(overrides = {}) {
  return {
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    user: {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'owner@stara.co',
      name: 'Stara Owner',
      emailVerified: true,
      twoFactorEnabled: true,
      ...(overrides.user ?? {}),
    },
  };
}

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function mockFetchJson(payload, status = 200) {
  fetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  });
}

function activeOrganizations() {
  return {
    active_tenant_id: '11111111-1111-4111-8111-111111111111',
    orgs: [
      {
        org: {
          tenant_id: '11111111-1111-4111-8111-111111111111',
          name: 'Stara Labs',
          status: 'active',
        },
        membership: { role_key: 'owner', status: 'active' },
      },
    ],
  };
}

function repository() {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    repository_owner: 'stara-labs',
    repository_name: 'stara-ui',
  };
}

function run() {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    task_id: '55555555-5555-4555-8555-555555555555',
    status: 'waiting_for_approval',
    version: 4,
  };
}

function taskAggregate() {
  return {
    task: { id: run().task_id, title: 'Improve Stara', status: 'running' },
    repositories: [],
    latest_run: run(),
  };
}

function runAggregate() {
  return { run: run(), task: taskAggregate().task, repositories: [], events: [] };
}

function approval() {
  return {
    review_item_id: '66666666-6666-4666-8666-666666666666',
    run_id: run().id,
    run_version: run().version,
    target: 'merge',
    status: 'pending',
  };
}

function policyConfig() {
  return {
    tenant_id: activeOrganizations().active_tenant_id,
    template_key: 'regulated_default',
    engineering_delivery: { merge_approval_required: true },
  };
}

function businessProfile() {
  return {
    tenant_id: activeOrganizations().active_tenant_id,
    business_summary: 'Stara builds governed software delivery.',
    primary_outcomes: ['Ship safe improvements'],
    critical_workflows: ['Task to deployment'],
    operating_constraints: ['Keep the active release available'],
    updated_by_user_id: '22222222-2222-4222-8222-222222222222',
    updated_at: '2026-07-15T00:00:00.000Z',
  };
}

function readiness() {
  return {
    tenant_id: activeOrganizations().active_tenant_id,
    ready_for_regulated_ga: true,
    checks: [],
  };
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
