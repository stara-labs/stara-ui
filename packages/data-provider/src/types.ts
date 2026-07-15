import type { InfiniteData } from '@tanstack/react-query';
import type {
  TConversationTag,
  EModelEndpoint,
  TConversation,
  TSharedLink,
  TAttachment,
  TMessage,
  TBanner,
  ReasoningResponseKey,
  ReasoningParameterFormat,
} from './schemas';
import type { RefillIntervalUnit } from './balance';
import type { SettingDefinition } from './generate';
import type { TMinimalFeedback } from './feedback';
import type { ContentTypes } from './types/runs';
import type { Agent } from './types/assistants';

export * from './schemas';

export type TMessages = TMessage[];

/* TODO: Cleanup EndpointOption types */
export type TEndpointOption = Pick<
  TConversation,
  // Core conversation fields
  | 'endpoint'
  | 'endpointType'
  | 'model'
  | 'modelLabel'
  | 'chatGptLabel'
  | 'promptPrefix'
  | 'temperature'
  | 'topP'
  | 'topK'
  | 'top_p'
  | 'frequency_penalty'
  | 'presence_penalty'
  | 'maxOutputTokens'
  | 'maxContextTokens'
  | 'max_tokens'
  | 'maxTokens'
  | 'resendFiles'
  | 'imageDetail'
  | 'reasoning_effort'
  | 'verbosity'
  | 'instructions'
  | 'additional_instructions'
  | 'append_current_datetime'
  | 'tools'
  | 'stop'
  | 'region'
  | 'additionalModelRequestFields'
  // Anthropic-specific
  | 'promptCache'
  | 'promptCacheTtl'
  | 'thinking'
  | 'thinkingBudget'
  | 'thinkingLevel'
  | 'effort'
  | 'thinkingDisplay'
  // Assistant/Agent fields
  | 'assistant_id'
  | 'agent_id'
  // UI/Display fields
  | 'iconURL'
  | 'greeting'
  | 'spec'
  // Artifacts
  | 'artifacts'
  // Files
  | 'file_ids'
  // System field
  | 'system'
  | 'chatProjectId'
  // Google examples
  | 'examples'
  // Context
  | 'context'
> & {
  // Fields specific to endpoint options that don't exist on TConversation
  modelDisplayLabel?: string;
  key?: string | null;
  /** @deprecated Assistants API */
  thread_id?: string;
  // Conversation identifiers for multi-response streams
  overrideConvoId?: string;
  overrideUserMessageId?: string;
  // Model parameters (used by different endpoints)
  modelOptions?: Record<string, unknown>;
  model_parameters?: Record<string, unknown>;
  // Configuration data (added by middleware)
  modelsConfig?: TModelsConfig;
  // File attachments (processed by middleware)
  attachments?: TAttachment[];
  // Generated prompts
  artifactsPrompt?: string;
  // Agent-specific fields
  agent?: Promise<Agent>;
  // Client-specific options
  clientOptions?: Record<string, unknown>;
};

export type TEphemeralAgent = {
  mcp?: string[];
  web_search?: boolean;
  file_search?: boolean;
  execute_code?: boolean;
  artifacts?: string;
  skills?: boolean;
  memory?: boolean;
  /** Equip the ephemeral agent with the `ask_user_question` HITL tool. */
  ask_user_question?: boolean;
};

export type TPayload = Partial<TMessage> &
  Partial<TEndpointOption> & {
    isContinued: boolean;
    isRegenerate?: boolean;
    conversationId: string | null;
    messages?: TMessages;
    isTemporary: boolean;
    ephemeralAgent?: TEphemeralAgent | null;
    editedContent?: TEditedContent | null;
    /** Added conversation for multi-convo feature */
    addedConvo?: TConversation;
    /**
     * Skills the user selected via the `$` popover for this turn. Names, not IDs
     * — the backend resolves them against the user's ACL-accessible skill set,
     * loads each SKILL.md body, and prepends one meta user message per skill
     * before the LLM turn runs.
     */
    manualSkills?: string[];
    /** Browser IANA timezone (e.g. `America/New_York`) used to resolve local-time prompt variables server-side. */
    timezone?: string;
  };

export type TEditedContent =
  | {
      index: number;
      type: ContentTypes.THINK;
      [ContentTypes.THINK]: string;
    }
  | {
      index: number;
      type: ContentTypes.TEXT;
      [ContentTypes.TEXT]: string;
    };

export type TSubmission = {
  userMessage: TMessage;
  isEdited?: boolean;
  isContinued?: boolean;
  isTemporary: boolean;
  messages: TMessage[];
  /** Client-only full message context used to restore branch siblings after scoped regenerate. */
  regenerateMessages?: TMessage[];
  isRegenerate?: boolean;
  initialResponse?: TMessage;
  conversation: Partial<TConversation>;
  endpointOption: TEndpointOption;
  clientTimestamp?: string;
  ephemeralAgent?: TEphemeralAgent | null;
  editedContent?: TEditedContent | null;
  /** Added conversation for multi-convo feature */
  addedConvo?: TConversation;
  /** Skills the user invoked via the `$` popover for this submission. */
  manualSkills?: string[];
};

export type EventSubmission = Omit<TSubmission, 'initialResponse'> & { initialResponse: TMessage };

export type TPluginAction = {
  pluginKey: string;
  action: 'install' | 'uninstall';
  auth?: Partial<Record<string, string>> | null;
  isEntityTool?: boolean;
};

export type GroupedConversations = [key: string, TConversation[]][];

export type TUpdateUserPlugins = {
  isEntityTool?: boolean;
  pluginKey: string;
  action: string;
  auth?: Partial<Record<string, string | null>> | null;
};

// TODO `label` needs to be changed to the proper `TranslationKeys`
export type TCategory = {
  id?: string;
  value: string;
  label: string;
  description?: string;
  custom?: boolean;
};

export type TMarketplaceCategory = TCategory & {
  count: number;
};

export type TError = {
  message: string;
  code?: number | string;
  response?: {
    data?: {
      message?: string;
    };
    status?: number;
  };
};

export type TBackupCode = {
  codeHash: string;
  used: boolean;
  usedAt: Date | null;
};

export type StaraOnboardingMode =
  | 'personal'
  | 'business_setup'
  | 'business_join'
  | 'business_join_pending';

export type StaraTenantMembershipStatus = 'active' | 'invited' | 'disabled';
export type StaraOrgRoleKey = 'owner' | 'admin' | 'member' | 'viewer';
export type StaraEngineeringApproverRoleKey = 'owner' | 'admin';

export type TStaraBusinessProfileInput = {
  business_summary: string;
  primary_outcomes: string[];
  critical_workflows: string[];
  operating_constraints?: string[];
};

export type TStaraBusinessProfile = TStaraBusinessProfileInput & {
  tenant_id: string;
  operating_constraints: string[];
  updated_by_user_id: string;
  updated_at: string;
};

export type TStaraOnboardingRecord = {
  completedAt?: string | Date;
  mode?: StaraOnboardingMode | 'tenant_addendum';
  recommendedStart?: string;
  readinessScore?: number;
  responses?: Record<string, unknown>;
  version?: number;
};

export type TStaraOnboardingState = {
  version: number;
  account: TStaraOnboardingRecord | null;
  tenantAddenda: Record<string, TStaraOnboardingRecord>;
  updatedAt?: string | Date | null;
};

export type TStaraTenantMembership = {
  id: string;
  tenantId: string;
  orgName: string;
  roleKey?: StaraOrgRoleKey;
  roleLabel: string;
  status: StaraTenantMembershipStatus;
  isDefault: boolean;
  source?: 'stara' | 'legacy' | 'invite';
  scopeIds: string[];
  groupIds: string[];
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

export type TStaraTenantInvite = {
  id: string;
  tenantId: string;
  orgName: string;
  roleKey?: StaraOrgRoleKey;
  roleLabel: string;
  invitedByName?: string;
  expiresAt?: string | Date;
  createdAt?: string | Date;
};

export type TStaraOrgSummary = {
  tenantId: string;
  name: string;
  slug?: string;
  status: 'active' | 'disabled';
  roleKey: StaraOrgRoleKey;
  roleLabel: string;
  isDefault: boolean;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

export type TStaraOrgMember = {
  userId: string;
  email?: string;
  name: string;
  username?: string;
  avatar?: string;
  tenantId: string;
  orgName: string;
  roleKey: StaraOrgRoleKey;
  roleLabel: string;
  status: StaraTenantMembershipStatus;
  isDefault: boolean;
  scopeIds: string[];
  groupIds: string[];
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

export type TStaraOrgInvite = {
  id: string;
  tenantId: string;
  email: string;
  roleKey: StaraOrgRoleKey;
  roleLabel: string;
  scopeIds: string[];
  groupIds: string[];
  status: 'pending' | 'revoked' | 'consumed';
  invitedByName?: string;
  expiresAt?: string | Date;
  createdAt?: string | Date;
};

export type TStaraOrgTeam = {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
  source: 'stara' | 'entra';
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

export type TStaraOrgRoleBundle = {
  key: StaraOrgRoleKey;
  label: string;
  description: string;
  canManageOrg: boolean;
};

export type TStaraScopeOption = {
  id: string;
  label: string;
  description: string;
};

export type TStaraOrganizationsContext = {
  activeOrg: TStaraOrgSummary | null;
  orgs: TStaraOrgSummary[];
  members: TStaraOrgMember[];
  invites: TStaraOrgInvite[];
  teams: TStaraOrgTeam[];
  roleBundles: TStaraOrgRoleBundle[];
  scopeOptions: TStaraScopeOption[];
  scopedAccess: {
    tenantId: string | null;
    scopeIds: string[];
    groupIds: string[];
    restrictedAreas: string[];
  };
  permissions: {
    canCreateOrg: boolean;
    canManageMembers: boolean;
    canManageInvites: boolean;
    canManageTeams: boolean;
    canManageScopes: boolean;
  };
};

export type TCreateStaraOrgRequest = {
  name: string;
  business_profile?: TStaraBusinessProfileInput;
};

export type TUpdateStaraOrgMemberRequest = {
  roleKey?: StaraOrgRoleKey;
  status?: StaraTenantMembershipStatus;
  scopeIds?: string[];
};

export type TCreateStaraOrgInviteRequest = {
  email: string;
  roleKey: StaraOrgRoleKey;
  scopeIds?: string[];
};

export type TCreateStaraOrgInviteResponse = {
  invite: TStaraOrgInvite;
  delivery: {
    sent: boolean;
    reason?: string;
  };
  inviteLink?: string;
  context: TStaraOrganizationsContext;
};

export type TAcceptStaraOrgInviteRequest = {
  token: string;
};

export type TUpsertStaraOrgTeamRequest = {
  name?: string;
  description?: string;
  memberIds?: string[];
};

export type StaraEngineeringRiskClass = 'low' | 'medium' | 'high' | 'critical';
export type StaraEngineeringTargetEnvironment = 'none' | 'development' | 'staging' | 'production';
export type StaraEngineeringRunStatus =
  | 'queued'
  | 'planning'
  | 'executing'
  | 'checking'
  | 'pull_request_open'
  | 'waiting_for_ci'
  | 'waiting_for_review'
  | 'waiting_for_approval'
  | 'repairing'
  | 'merge_ready'
  | 'merging'
  | 'deploying'
  | 'verifying'
  | 'completed'
  | 'blocked'
  | 'cancelled'
  | 'failed'
  | 'rolled_back';

export type TStaraEngineeringCheckProfile = {
  profile_id: string;
  label: string;
  runner: 'npm';
  script: string;
  working_directory: string;
};

export type TStaraEngineeringDeploymentTarget = {
  provider: 'cloud_run';
  project_id: string;
  region: string;
  service_name: string;
};

export type TStaraEngineeringRepository = {
  id: string;
  tenant_id: string;
  provider: 'github';
  provider_repository_id: string | null;
  repository_owner: string;
  repository_name: string;
  default_branch: string;
  installation_id: string | null;
  status: 'pending' | 'active' | 'disabled' | 'archived';
  check_profiles: TStaraEngineeringCheckProfile[];
  deployment_target: TStaraEngineeringDeploymentTarget | null;
  risk_paths: string[];
  created_by_user_id: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type TStaraEngineeringTask = {
  id: string;
  tenant_id: string;
  created_by_user_id: string;
  idempotency_key: string | null;
  title: string;
  goal: string;
  acceptance_criteria: string[];
  risk_class: StaraEngineeringRiskClass;
  target_environment: StaraEngineeringTargetEnvironment;
  status:
    | 'draft'
    | 'ready'
    | 'running'
    | 'blocked'
    | 'completed'
    | 'cancelled'
    | 'failed'
    | 'rolled_back';
  metadata_redacted: Record<string, unknown>;
  version: number;
  created_action_version_id: string;
  created_at: string;
  updated_at: string;
};

export type TStaraEngineeringTaskRepository = {
  repository_connection_id: string;
  dependency_order: number;
  base_revision: string | null;
  target_branch: string | null;
  repository: TStaraEngineeringRepository;
};

export type TStaraEngineeringRun = {
  id: string;
  tenant_id: string;
  task_id: string;
  attempt: number;
  retry_of_run_id: string | null;
  status: StaraEngineeringRunStatus;
  current_stage: string | null;
  trace_id: string;
  idempotency_key: string;
  started_by_user_id: string;
  block_reason_redacted: string | null;
  metadata_redacted: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type TStaraEngineeringEvidenceReference = {
  evidence_type:
    | 'source_commit'
    | 'change_set'
    | 'check_run'
    | 'pull_request'
    | 'review'
    | 'deployment'
    | 'release_verification';
  provider: string;
  external_id: string;
  revision?: string;
  url?: string;
  conclusion?: 'pending' | 'success' | 'failure' | 'cancelled' | 'neutral';
};

export type TStaraEngineeringRunEvent = {
  id: string;
  tenant_id: string;
  run_id: string;
  run_version: number;
  event_type: string;
  from_status: StaraEngineeringRunStatus | null;
  to_status: StaraEngineeringRunStatus;
  stage: string | null;
  summary_redacted: string;
  evidence_refs: TStaraEngineeringEvidenceReference[];
  metadata_redacted: Record<string, unknown>;
  idempotency_key: string;
  action_version_id: string;
  created_at: string;
};

export type TStaraEngineeringTaskAggregate = {
  task: TStaraEngineeringTask;
  repositories: TStaraEngineeringTaskRepository[];
  latest_run: TStaraEngineeringRun | null;
};

export type TStaraEngineeringRunAggregate = {
  run: TStaraEngineeringRun;
  task: TStaraEngineeringTask;
  repositories: TStaraEngineeringTaskRepository[];
  events: TStaraEngineeringRunEvent[];
};

export type TStaraEngineeringApproval = {
  review_item_id: string;
  tenant_id: string;
  run_id: string;
  run_version: number;
  target: 'merge' | 'deployment';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  required_role_keys: Array<'owner' | 'admin'>;
  summary_redacted: Record<string, unknown>;
  decision: 'approved' | 'rejected' | null;
  decided_by_user_id: string | null;
  decision_reason_redacted: string | null;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
};

export type TStaraEngineeringDeliveryPolicy = {
  review_required: boolean;
  merge_approval_required: boolean;
  deployment_approval_required: boolean;
  merge_approver_role_keys: StaraEngineeringApproverRoleKey[];
  deployment_approver_role_keys: StaraEngineeringApproverRoleKey[];
  required_ci_check_names: string[];
  max_repair_attempts: number;
  max_immediate_steps: number;
  branch_prefix: string;
  pull_request_draft: boolean;
  coding_model: string;
  coding_grant_ttl_seconds: number;
  coding_max_requests: number;
  coding_max_request_bytes: number;
  coding_max_input_tokens: number;
  coding_max_output_tokens: number;
  coding_max_output_tokens_per_request: number;
};

export type TStaraEngineeringPolicyConfig = {
  tenant_id: string;
  template_key: 'regulated_default' | 'regulated_strict' | 'custom';
  regulated_data_classes: Array<'pii' | 'phi' | 'financial' | 'confidential'>;
  secure_inference_required: boolean;
  frontier_projection_mode: 'deidentified_only' | 'review_required' | 'blocked';
  missing_context_behavior: 'fail_closed';
  review_required_for_unknown_sensitivity: boolean;
  redacted_observations_required: boolean;
  engineering_delivery: TStaraEngineeringDeliveryPolicy;
  updated_by_user_id: string;
  updated_at: string;
};

export type TStaraEngineeringReadiness = {
  tenant_id: string;
  ready_for_regulated_ga: boolean;
  generated_at: string;
  checks: Array<{ check_id: string; status: 'pass' | 'fail'; summary: string }>;
};

export type TStaraEngineeringContext = {
  active_tenant_id: string | null;
  active_org_name: string | null;
  actor_role_key: StaraOrgRoleKey | null;
  permissions: {
    can_connect_repository: boolean;
    can_create_task: boolean;
    can_decide_approval: boolean;
    can_update_policy: boolean;
    can_update_business_profile: boolean;
  };
  repositories: TStaraEngineeringRepository[];
  tasks: TStaraEngineeringTaskAggregate[];
  approvals: TStaraEngineeringApproval[];
  business_profile: TStaraBusinessProfile | null;
  policy_config: TStaraEngineeringPolicyConfig | null;
  readiness: TStaraEngineeringReadiness | null;
};

export type TCreateStaraEngineeringRepositoryRequest = {
  repository_owner: string;
  repository_name: string;
  default_branch?: string;
  installation_id?: string;
  check_profiles?: TStaraEngineeringCheckProfile[];
  deployment_target?: TStaraEngineeringDeploymentTarget;
  risk_paths?: string[];
  activate?: boolean;
};

export type TCreateStaraEngineeringTaskRequest = {
  idempotency_key: string;
  title: string;
  goal: string;
  acceptance_criteria: string[];
  risk_class: StaraEngineeringRiskClass;
  target_environment: StaraEngineeringTargetEnvironment;
  repositories: Array<{
    repository_connection_id: string;
    dependency_order: number;
    base_revision?: string;
    target_branch?: string;
  }>;
  metadata_redacted?: Record<string, unknown>;
};

export type TStartStaraEngineeringRunRequest = {
  idempotency_key: string;
  trace_id?: string;
  metadata_redacted?: Record<string, unknown>;
};

export type TDecideStaraEngineeringRunRequest = {
  target: 'merge' | 'deployment';
  decision: 'approved' | 'rejected';
  expected_version: number;
  idempotency_key: string;
  reason_redacted: string;
};

export type TUpdateStaraEngineeringPolicyRequest = {
  template_key?: 'regulated_default' | 'regulated_strict' | 'custom';
  engineering_delivery?: Partial<TStaraEngineeringDeliveryPolicy>;
};

export type TUpdateStaraBusinessProfileRequest = TStaraBusinessProfileInput;

export type TStaraAccessGroup = {
  id: string;
  name: string;
  source: 'stara' | 'entra';
  idOnTheSource?: string | null;
  description?: string;
};

export type TStaraAccessGrant = {
  id?: string;
  principalType: string;
  capability: string;
  tenantId?: string | null;
};

export type TStaraOnboardingContext = {
  version: number;
  account: {
    completed: boolean;
    onboarding: TStaraOnboardingRecord | null;
  };
  onboarding: TStaraOnboardingState;
  memberships: TStaraTenantMembership[];
  activeMembership: TStaraTenantMembership | null;
  pendingInvites: TStaraTenantInvite[];
  access: {
    tenantId: string | null;
    scopes: string[];
    groups: TStaraAccessGroup[];
    grants: TStaraAccessGrant[];
    restrictedAreas: string[];
  };
  requiresOnboarding: boolean;
  requiresTenantAddendum: boolean;
};

export type TSaveStaraOnboardingRequest = {
  mode: StaraOnboardingMode | 'tenant_addendum';
  tenantId?: string;
  recommendedStart?: string;
  readinessScore?: number;
  responses?: Record<string, unknown>;
};

export type TUser = {
  id: string;
  username: string;
  email: string;
  name: string;
  avatar: string;
  role: string;
  provider: string;
  tenantId?: string;
  plugins?: string[];
  emailVerified?: boolean;
  twoFactorEnabled?: boolean;
  backupCodes?: TBackupCode[];
  personalization?: {
    memories?: boolean;
    staraOnboarding?: TStaraOnboardingState;
  };
  createdAt: string;
  updatedAt: string;
};

export type TGetConversationsResponse = {
  conversations: TConversation[];
  pageNumber: string;
  pageSize: string | number;
  pages: string | number;
};

export type TUpdateMessageRequest = {
  conversationId: string;
  messageId: string;
  model: string;
  text: string;
};

export type TUpdateMessageContent = {
  conversationId: string;
  messageId: string;
  index: number;
  text: string;
};

export type TUpdateUserKeyRequest = {
  name: string;
  value: string;
  expiresAt: string;
};

export type TAgentApiKeyCreateRequest = {
  name: string;
  expiresAt?: string | null;
};

export type TAgentApiKeyCreateResponse = {
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
  createdAt: string;
  expiresAt?: string;
};

export type TAgentApiKeyListItem = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
};

export type TAgentApiKeyListResponse = {
  keys: TAgentApiKeyListItem[];
};

export type TUpdateConversationRequest = {
  conversationId: string;
  title: string;
};

export type TUpdateConversationResponse = TConversation;

export type TChatProject = {
  _id: string;
  name: string;
  description?: string;
  user?: string;
  conversationCount: number;
  lastConversationAt?: string | null;
  lastConversationId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TCreateChatProjectRequest = {
  name: string;
  description?: string;
};

export type TUpdateChatProjectRequest = Partial<TCreateChatProjectRequest> & {
  projectId: string;
};

export type TDeleteChatProjectResponse = {
  deletedCount: number;
  modifiedCount: number;
};

export type TAssignConversationToProjectRequest = {
  conversationId: string;
  projectId: string | null;
};

export type TAssignConversationToProjectResponse = {
  conversation: TConversation;
  previousProjectId: string | null;
  projectId: string | null;
};

export type TDeleteConversationRequest = {
  conversationId?: string;
  thread_id?: string;
  endpoint?: string;
  source?: string;
};

export type TDeleteConversationResponse = {
  acknowledged: boolean;
  deletedCount: number;
  messages: {
    acknowledged: boolean;
    deletedCount: number;
  };
};

export type TArchiveConversationRequest = {
  conversationId: string;
  isArchived: boolean;
};

export type TArchiveConversationResponse = TConversation;

export type TPinConversationRequest = {
  conversationId: string;
  pinned: boolean;
};

export type TPinConversationResponse = TConversation;

export type TSharedMessagesResponse = Omit<TSharedLink, 'messages'> & {
  messages: TMessage[];
};

export type TCreateShareLinkRequest = Pick<TConversation, 'conversationId'>;

export type TUpdateShareLinkRequest = Pick<TSharedLink, 'shareId' | 'targetMessageId'>;

export type TSharedLinkResponse = Pick<TSharedLink, 'shareId'> &
  Pick<TSharedLink, 'targetMessageId'> &
  Pick<TConversation, 'conversationId'> & {
    _id?: string;
  };

export type TSharedLinkGetResponse = Omit<TSharedLinkResponse, 'shareId'> & {
  shareId: string | null;
  success: boolean;
  /** Per-link "share files" choice; absent on legacy links (treated as enabled). */
  snapshotFiles?: boolean;
};

// type for getting conversation tags
export type TConversationTagsResponse = TConversationTag[];
// type for creating conversation tag
export type TConversationTagRequest = Partial<
  Omit<TConversationTag, 'createdAt' | 'updatedAt' | 'count' | 'user'>
> & {
  conversationId?: string;
  addToConversation?: boolean;
};

export type TConversationTagResponse = TConversationTag;

export type TTagConversationRequest = {
  tags: string[];
  tag: string;
};

export type TTagConversationResponse = string[];

export type TDuplicateConvoRequest = {
  conversationId?: string;
};

export type TDuplicateConvoResponse = {
  conversation: TConversation;
  messages: TMessage[];
};

export type TForkConvoRequest = {
  messageId: string;
  conversationId: string;
  option?: string;
  splitAtTarget?: boolean;
  latestMessageId?: string;
};

export type TForkConvoResponse = {
  conversation: TConversation;
  messages: TMessage[];
};

export type TForkSharedConvoRequest = {
  shareId: string;
  /** Index of the viewer's active message within the shared payload; reduces the
   *  fork to that branch. An index is used because shared ids are re-anonymized
   *  per request and `createdAt` can collide, while the payload order is stable. */
  targetMessageIndex?: number;
};

export type TSearchResults = {
  conversations: TConversation[];
  messages: TMessage[];
  pageNumber: string;
  pageSize: string | number;
  pages: string | number;
  filter: object;
};

export type TConfig = {
  order: number;
  type?: EModelEndpoint;
  azure?: boolean;
  availableTools?: [];
  availableRegions?: string[];
  allowedProviders?: (string | EModelEndpoint)[];
  plugins?: Record<string, string>;
  name?: string;
  iconURL?: string;
  version?: string;
  modelDisplayLabel?: string;
  userProvide?: boolean | null;
  userProvideURL?: boolean | null;
  userProvideAccessKeyId?: boolean;
  userProvideSecretAccessKey?: boolean;
  userProvideSessionToken?: boolean;
  userProvideBearerToken?: boolean;
  disableBuilder?: boolean;
  retrievalModels?: string[];
  capabilities?: string[];
  customParams?: {
    defaultParamsEndpoint?: string;
    reasoningFormat?: ReasoningParameterFormat;
    reasoningKey?: ReasoningResponseKey;
    includeReasoningContent?: boolean;
    includeReasoningHistory?: boolean;
    paramDefinitions?: Partial<SettingDefinition>[];
  };
};

export type TEndpointsConfig =
  | Record<EModelEndpoint | string, TConfig | null | undefined>
  | undefined;

export type TModelsConfig = Record<string, string[]>;

/** Server-resolved context window and pricing for one model. Rates are USD per 1M tokens. */
export type TModelTokenomics = {
  context?: number;
  prompt?: number;
  completion?: number;
  cacheWrite?: number;
  cacheRead?: number;
};

/** endpoint → model → resolved tokenomics, from GET /api/endpoints/token-config */
export type TTokenConfigMap = Record<string, Record<string, TModelTokenomics>>;

export type TUpdateTokenCountResponse = {
  count: number;
};

export type TMessageTreeNode = object;

export type TSearchMessage = object;

export type TSearchMessageTreeNode = object;

export type TRegisterUserResponse = {
  message: string;
};

export type TRegisterUser = {
  name: string;
  email: string;
  username: string;
  password: string;
  confirm_password?: string;
  token?: string;
};

export type TIdentityPlatformSignupEligibilityRequest = {
  email: string;
  invite_token?: string;
};

export type TIdentityPlatformSignupEligibilityResponse = {
  eligible: true;
  method: 'allowlisted_domain' | 'invitation';
};

export type TStaraIdentitySyncRequest = {
  invite_token?: string;
};

export type TLoginUser = {
  email: string;
  password: string;
  token?: string;
  backupCode?: string;
};

export type TLoginResponse = {
  token?: string;
  user?: TUser;
  twoFAPending?: boolean;
  tempToken?: string;
};

/** Shared payload for any operation that requires OTP or backup-code verification. */
export type TOTPVerificationPayload = {
  token?: string;
  backupCode?: string;
};

export type TEnable2FARequest = TOTPVerificationPayload;

export type TEnable2FAResponse = {
  otpauthUrl: string;
  backupCodes: string[];
  message?: string;
};

export type TVerify2FARequest = TOTPVerificationPayload;

export type TVerify2FAResponse = {
  message: string;
};

/** For verifying 2FA during login with a temporary token. */
export type TVerify2FATempRequest = TOTPVerificationPayload & {
  tempToken: string;
};

export type TVerify2FATempResponse = {
  token?: string;
  user?: TUser;
  message?: string;
};

export type TDisable2FARequest = TOTPVerificationPayload;

export type TDisable2FAResponse = {
  message: string;
};

export type TRegenerateBackupCodesRequest = TOTPVerificationPayload;

export type TRegenerateBackupCodesResponse = {
  message?: string;
  backupCodes: string[];
  backupCodesHash: TBackupCode[];
};

export type TDeleteUserRequest = TOTPVerificationPayload;

export type TRequestPasswordReset = {
  email: string;
};

export type TResetPassword = {
  userId: string;
  token: string;
  password: string;
  confirm_password?: string;
};

export type VerifyEmailResponse = { message: string };

export type TVerifyEmail = {
  email: string;
  token: string;
};

export type TResendVerificationEmail = Omit<TVerifyEmail, 'token'>;

export type TRefreshTokenResponse = {
  token: string;
  user: TUser;
};

export type TCheckUserKeyResponse = {
  expiresAt: string;
};

export type TRequestPasswordResetResponse = {
  link?: string;
  message?: string;
};

/**
 * Represents the response from the import endpoint.
 */
export type TImportResponse = {
  /**
   * The message associated with the response.
   */
  message: string;
};

/** Prompts */

export type TPrompt = {
  groupId: string;
  author: string;
  prompt: string;
  type: 'text' | 'chat';
  createdAt: string;
  updatedAt: string;
  _id?: string;
};

export type TPromptGroup = {
  name: string;
  numberOfGenerations?: number;
  command?: string;
  oneliner?: string;
  category?: string;
  productionId?: string | null;
  productionPrompt?: Pick<TPrompt, 'prompt'> | null;
  author: string;
  authorName: string;
  isPublic?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  _id?: string;
};

export type TCreatePrompt = {
  prompt: Pick<TPrompt, 'prompt' | 'type'> & { groupId?: string };
  group?: { name: string; category?: string; oneliner?: string; command?: string };
};

export type TCreatePromptRecord = TCreatePrompt & Pick<TPromptGroup, 'author' | 'authorName'>;

export type TPromptsWithFilterRequest = {
  groupId: string;
  tags?: string[];
  projectId?: string;
  version?: number;
};

export type TPromptGroupsWithFilterRequest = {
  category: string;
  pageNumber?: string; // Made optional for cursor-based pagination
  pageSize?: string | number;
  limit?: string | number; // For cursor-based pagination
  cursor?: string; // For cursor-based pagination
  before?: string | null;
  after?: string | null;
  order?: 'asc' | 'desc';
  name?: string;
  author?: string;
};

export type PromptGroupListResponse = {
  promptGroups: TPromptGroup[];
  pageNumber: string;
  pageSize: string | number;
  pages: string | number;
  has_more: boolean; // Added for cursor-based pagination
  after: string | null; // Added for cursor-based pagination
};

export type PromptGroupListData = InfiniteData<PromptGroupListResponse>;

export type TCreatePromptResponse = {
  prompt: TPrompt;
  group?: TPromptGroup;
};

export type TUpdatePromptGroupPayload = Partial<TPromptGroup>;

export type TUpdatePromptGroupVariables = {
  id: string;
  payload: TUpdatePromptGroupPayload;
};

export type TUpdatePromptGroupResponse = TPromptGroup;

export type TDeletePromptResponse = {
  prompt: string;
  promptGroup?: { message: string; id: string };
};

export type TDeletePromptVariables = {
  _id: string;
  groupId: string;
};

export type TMakePromptProductionResponse = {
  message: string;
};

export type TMakePromptProductionRequest = {
  id: string;
  groupId: string;
  productionPrompt: Pick<TPrompt, 'prompt'>;
};

export type TUpdatePromptLabelsRequest = {
  id: string;
  payload: {
    labels: string[];
  };
};

export type TUpdatePromptLabelsResponse = {
  message: string;
};

export type TDeletePromptGroupResponse = TUpdatePromptLabelsResponse;

export type TDeletePromptGroupRequest = {
  id: string;
};

export type TGetCategoriesResponse = TCategory[];

export type TGetRandomPromptsResponse = {
  prompts: TPromptGroup[];
};

export type TGetRandomPromptsRequest = {
  limit: number;
  skip: number;
};

export type TCustomConfigSpeechResponse = { [key: string]: string };

export type TUserTermsResponse = {
  termsAccepted: boolean;
  termsAcceptedAt: Date | string | null;
};

export type TAcceptTermsResponse = {
  message: string;
  termsAcceptedAt: Date | string;
};

export type TBannerResponse = TBanner | null;

export type TUpdateFeedbackRequest = {
  feedback?: TMinimalFeedback;
};

export type TUpdateFeedbackResponse = {
  messageId: string;
  conversationId: string;
  feedback?: TMinimalFeedback;
};

export type TBalanceResponse = {
  tokenCredits: number;
  // Automatic refill settings
  autoRefillEnabled: boolean;
  refillIntervalValue?: number;
  refillIntervalUnit?: RefillIntervalUnit;
  lastRefill?: Date | string;
  refillAmount?: number;
};

/* -------------------------------------------------------------------------- */
/* Skill UI extensions (not yet persisted — phase 2 backend will fill these)  */
/* -------------------------------------------------------------------------- */

/**
 * @deprecated Superseded by the persisted `userInvocable` /
 * `disableModelInvocation` pair derived from frontmatter. Retained for the
 * transition window so older UI forms and tests still type-check; the
 * backend no longer reads or writes it.
 */
export enum InvocationMode {
  auto = 'auto',
  manual = 'manual',
  both = 'both',
}

/**
 * Node in the filesystem-style skill tree view. Phase 1 derives these from
 * the flat `TSkillFile[]` list; phase 2 will have the backend serve them
 * directly from a persisted folder hierarchy. Kept in the shared types so
 * tree UI helpers can be imported from both client and server.
 */
export type TSkillNode = {
  _id: string;
  skillId: string;
  parentId: string | null;
  type: 'file' | 'folder';
  name: string;
  fileId?: string;
  order: number;
  author: string;
  createdAt: string;
  updatedAt: string;
};

export type TSkillTreeResponse = {
  nodes: TSkillNode[];
};

export type TCreateSkillNodeRequest = {
  type: 'file' | 'folder';
  name: string;
  parentId?: string | null;
  order?: number;
};

export type TUpdateSkillNodeRequest = {
  name?: string;
  parentId?: string | null;
  order?: number;
};
