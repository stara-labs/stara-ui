import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StaraControlPlaneView from '../StaraControlPlaneView';

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
  useToastContext: () => ({ showToast: jest.fn() }),
}));

jest.mock('librechat-data-provider/react-query', () => ({
  useGetResourcePermissionsQuery: () => ({
    data: { principals: [] },
    isLoading: false,
  }),
  useUpdateResourcePermissionsMutation: () => ({
    isLoading: false,
    mutateAsync: jest.fn(),
  }),
}));

jest.mock('~/data-provider', () => ({
  useStaraOrganizationsContextQuery: () => ({
    data: {
      activeOrg: {
        name: 'Stara Labs',
        roleLabel: 'Owner',
        tenantId: 'tenant_stara',
      },
      members: [],
      permissions: { canManageTeams: true },
      scopedAccess: { scopeIds: [] },
      teams: [],
    },
    isFetching: false,
    isLoading: false,
    refetch: jest.fn(),
  }),
  useUpdateStaraOrganizationMemberMutation: () => ({
    isLoading: false,
    mutateAsync: jest.fn(),
  }),
  useUpdateStaraOrganizationTeamMutation: () => ({
    isLoading: false,
    mutateAsync: jest.fn(),
  }),
}));

jest.mock('~/data-provider/Agents', () => ({
  useListAgentsQuery: () => ({
    data: { data: [] },
    isFetching: false,
    isLoading: false,
    refetch: jest.fn(),
  }),
}));

describe('StaraControlPlaneView', () => {
  it('renders the context review surface and source graph', () => {
    render(
      <MemoryRouter initialEntries={['/stara/context']}>
        <Routes>
          <Route path="/stara/:section" element={<StaraControlPlaneView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Vault / Context' })).toBeInTheDocument();
    expect(screen.getByText('Memory Review')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Memory source graph' })).toBeInTheDocument();
    expect(
      screen.getByText('Operations approvers prefer workflow blockers first in summaries.'),
    ).toBeInTheDocument();
  });

  it('renders the launcher and operational route summaries', () => {
    render(
      <MemoryRouter initialEntries={['/stara/launcher']}>
        <Routes>
          <Route path="/stara/:section" element={<StaraControlPlaneView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Launcher' })).toBeInTheDocument();
    expect(screen.getByText('Stara Gateway')).toBeInTheDocument();
    expect(screen.getByText('stara-control-plane')).toBeInTheDocument();
  });

  it('redirects old memory route aliases to the context shell route', () => {
    render(
      <MemoryRouter initialEntries={['/stara/memory']}>
        <Routes>
          <Route path="/stara/:section" element={<StaraControlPlaneView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Vault / Context' })).toBeInTheDocument();
  });

  it('renders an agent creation CTA when there are no shareable agents', () => {
    render(
      <MemoryRouter initialEntries={['/stara/organization']}>
        <Routes>
          <Route path="/stara/:section" element={<StaraControlPlaneView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('No shareable agents')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an agent' })).toHaveAttribute(
      'href',
      '/agents',
    );
  });
});
