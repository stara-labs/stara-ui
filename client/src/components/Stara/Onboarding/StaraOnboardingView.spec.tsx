import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TStaraOnboardingContext } from 'librechat-data-provider';
import StaraOnboardingView, { resolveCompletionRoute } from './StaraOnboardingView';

const mockCreateOrganization = jest.fn();
const mockSaveOnboarding = jest.fn();
const mockActivateTenant = jest.fn();
const mockShowToast = jest.fn();

jest.mock('@librechat/client', () => ({
  Button: ({ children, size, variant, ...props }: any) => {
    void size;
    void variant;
    return (
      <button type="button" {...props}>
        {children}
      </button>
    );
  },
  Spinner: (props: any) => <span data-testid="spinner" {...props} />,
  useMediaQuery: () => false,
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('~/hooks', () => ({
  useDocumentTitle: jest.fn(),
  useLocalize: () => (key: string) => key,
}));

const initialContext: TStaraOnboardingContext = {
  version: 1,
  account: { completed: false, onboarding: null },
  onboarding: { version: 1, account: null, tenantAddenda: {} },
  memberships: [],
  activeMembership: null,
  pendingInvites: [],
  access: {
    tenantId: null,
    scopes: [],
    groups: [],
    grants: [],
    restrictedAreas: [],
  },
  requiresOnboarding: true,
  requiresTenantAddendum: false,
};

const ownerMembership = {
  id: 'membership-1',
  tenantId: 'tenant-1',
  orgName: 'Acme Health',
  roleKey: 'owner' as const,
  roleLabel: 'Owner',
  status: 'active' as const,
  isDefault: true,
  source: 'stara' as const,
  scopeIds: [],
  groupIds: [],
};

const savedContext: TStaraOnboardingContext = {
  ...initialContext,
  version: 2,
  account: {
    completed: true,
    onboarding: { mode: 'business_setup', recommendedStart: 'settings', version: 1 },
  },
  onboarding: {
    version: 2,
    account: { mode: 'business_setup', recommendedStart: 'settings', version: 1 },
    tenantAddenda: {},
  },
  memberships: [ownerMembership],
  activeMembership: ownerMembership,
  access: { ...initialContext.access, tenantId: ownerMembership.tenantId },
  requiresOnboarding: false,
  requiresTenantAddendum: true,
};

jest.mock('~/data-provider', () => ({
  useStaraOnboardingContextQuery: () => ({
    data: initialContext,
    isLoading: false,
    isError: false,
  }),
  useCreateStaraOrganizationMutation: () => ({
    isLoading: false,
    mutateAsync: mockCreateOrganization,
  }),
  useSaveStaraOnboardingMutation: () => ({
    isLoading: false,
    mutateAsync: mockSaveOnboarding,
  }),
  useActivateStaraTenantMutation: () => ({
    isLoading: false,
    mutateAsync: mockActivateTenant,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateOrganization.mockResolvedValue({});
  mockSaveOnboarding.mockResolvedValue(savedContext);
});

describe('StaraOnboardingView', () => {
  it('uses the recommended start instead of the generic login destination', () => {
    expect(resolveCompletionRoute('/c/new', 'workflows')).toBe('/stara/workflows');
    expect(resolveCompletionRoute(null, 'approvals')).toBe('/stara/approvals');
  });

  it('preserves an explicit safe deep link after onboarding', () => {
    expect(resolveCompletionRoute('/stara/settings', 'workflows')).toBe('/stara/settings');
  });

  it('creates the canonical organization and continues into its owner addendum', async () => {
    render(
      <MemoryRouter initialEntries={['/onboarding?redirect_to=%2Fstara%2Fsettings']}>
        <StaraOnboardingView />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Business/ }));
    fireEvent.click(screen.getByRole('button', { name: /Set up an org/ }));
    fireEvent.change(screen.getByLabelText('Organization name'), {
      target: { value: 'Acme Health' },
    });
    fireEvent.change(screen.getByLabelText('Business summary'), {
      target: { value: 'Acme coordinates regulated health operations.' },
    });
    fireEvent.change(screen.getByLabelText('Primary outcomes'), {
      target: { value: 'Reduce onboarding time\nPreserve audit evidence' },
    });
    fireEvent.change(screen.getByLabelText('Critical workflows'), {
      target: { value: 'Customer onboarding\nGoverned production delivery' },
    });
    fireEvent.change(screen.getByLabelText('Operating constraints'), {
      target: { value: 'PHI stays on approved secure routes' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Workflows and delivery/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));

    await waitFor(() =>
      expect(mockCreateOrganization).toHaveBeenCalledWith({
        name: 'Acme Health',
        business_profile: {
          business_summary: 'Acme coordinates regulated health operations.',
          primary_outcomes: ['Reduce onboarding time', 'Preserve audit evidence'],
          critical_workflows: ['Customer onboarding', 'Governed production delivery'],
          operating_constraints: ['PHI stays on approved secure routes'],
        },
      }),
    );
    expect(mockSaveOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'business_setup',
        recommendedStart: 'settings',
        responses: expect.objectContaining({
          orgName: 'Acme Health',
          setupPriority: 'workflows',
        }),
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Review access for Acme Health' }),
    ).toBeInTheDocument();
  });
});
