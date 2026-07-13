/**
 * @jest-environment @happy-dom/jest-environment
 */
import React from 'react';
import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TAuthConfig } from '~/common';
import { AuthContextProvider, useAuthContext } from '../AuthContext';
import { SESSION_KEY } from '~/utils';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const mockApiBaseUrl = jest.fn(() => '');
const mockSyncStaraIdentity = jest.fn();
const mockGetCanonicalUser = jest.fn();
const mockSetAuthTokenRefreshHandler = jest.fn();

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  setTokenHeader: jest.fn(),
  apiBaseUrl: () => mockApiBaseUrl(),
  dataService: {
    ...jest.requireActual('librechat-data-provider').dataService,
    syncStaraIdentity: (...args: unknown[]) => mockSyncStaraIdentity(...args),
    getUser: (...args: unknown[]) => mockGetCanonicalUser(...args),
  },
  request: {
    ...jest.requireActual('librechat-data-provider').request,
    setAuthTokenRefreshHandler: (...args: unknown[]) => mockSetAuthTokenRefreshHandler(...args),
  },
}));

const mockRefreshIdentityPlatformToken = jest.fn();
const mockSignInToIdentityPlatform = jest.fn();
const mockSignOutFromIdentityPlatform = jest.fn();
const mockSubscribeToIdentityPlatform = jest.fn();
let mockIdentityUserListener: ((user: unknown) => void) | undefined;
let _mockIdentityErrorListener: ((error: Error) => void) | undefined;

jest.mock('~/lib/auth/identityPlatform', () => ({
  identityPlatformErrorMessage: (error: Error) => error.message,
  refreshIdentityPlatformToken: (...args: unknown[]) => mockRefreshIdentityPlatformToken(...args),
  signInToIdentityPlatform: (...args: unknown[]) => mockSignInToIdentityPlatform(...args),
  signOutFromIdentityPlatform: (...args: unknown[]) => mockSignOutFromIdentityPlatform(...args),
  subscribeToIdentityPlatform: (...args: unknown[]) => mockSubscribeToIdentityPlatform(...args),
}));

let mockCapturedLoginOptions: {
  onSuccess: (...args: unknown[]) => void;
  onError: (...args: unknown[]) => void;
};

let mockCapturedLogoutOptions: {
  onSuccess: (...args: unknown[]) => void;
  onError: (...args: unknown[]) => void;
};

const mockRefreshMutate = jest.fn();
const mockLegacyLoginMutate = jest.fn();
let mockStartupConfigQuery = {
  data: {} as { identityPlatform?: unknown },
  isFetched: true,
};

jest.mock('~/data-provider', () => ({
  useLoginUserMutation: jest.fn(
    (options: {
      onSuccess: (...args: unknown[]) => void;
      onError: (...args: unknown[]) => void;
    }) => {
      mockCapturedLoginOptions = options;
      return { mutate: mockLegacyLoginMutate };
    },
  ),
  useLogoutUserMutation: jest.fn(
    (options: {
      onSuccess: (...args: unknown[]) => void;
      onError: (...args: unknown[]) => void;
    }) => {
      mockCapturedLogoutOptions = options;
      return { mutate: jest.fn() };
    },
  ),
  useRefreshTokenMutation: jest.fn(() => ({ mutate: mockRefreshMutate })),
  useGetStartupConfig: jest.fn(() => mockStartupConfigQuery),
  useGetUserQuery: jest.fn(() => ({
    data: undefined,
    isError: false,
    error: null,
  })),
  useGetRole: jest.fn(() => ({ data: null })),
  useListRoles: jest.fn(() => ({ data: undefined })),
}));

const authConfig: TAuthConfig = { loginRedirect: '/login', test: true };

function TestConsumer() {
  const ctx = useAuthContext();
  return (
    <div
      data-testid="consumer"
      data-authenticated={ctx.isAuthenticated}
      data-token={ctx.token ?? ''}
      data-user={ctx.user?.id ?? ''}
      data-roles={JSON.stringify(ctx.roles ?? {})}
    >
      <button
        data-testid="identity-login"
        onClick={() => void ctx.login({ email: 'owner@example.com', password: 'password' })}
      />
    </div>
  );
}

function renderProvider() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RecoilRoot>
        <MemoryRouter>
          <AuthContextProvider authConfig={authConfig}>
            <TestConsumer />
          </AuthContextProvider>
        </MemoryRouter>
      </RecoilRoot>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockStartupConfigQuery = { data: {}, isFetched: true };
  mockIdentityUserListener = undefined;
  _mockIdentityErrorListener = undefined;
  mockSyncStaraIdentity.mockResolvedValue({});
  mockGetCanonicalUser.mockResolvedValue({
    id: 'identity-user-1',
    email: 'owner@example.com',
    name: 'Owner',
    role: 'USER',
    provider: 'identity-platform',
  });
  mockRefreshIdentityPlatformToken.mockResolvedValue('refreshed-identity-token');
  mockSignInToIdentityPlatform.mockResolvedValue({ mfaRequired: false });
  mockSignOutFromIdentityPlatform.mockResolvedValue(undefined);
  mockSubscribeToIdentityPlatform.mockImplementation((_config, onUser, onError) => {
    mockIdentityUserListener = onUser;
    _mockIdentityErrorListener = onError;
    return jest.fn();
  });
});

/** Renders without test:true so silentRefresh actually runs */
function renderProviderLive() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RecoilRoot>
        <MemoryRouter>
          <AuthContextProvider authConfig={{ loginRedirect: '/login' }}>
            <TestConsumer />
          </AuthContextProvider>
        </MemoryRouter>
      </RecoilRoot>
    </QueryClientProvider>,
  );
}

describe('AuthContextProvider — login onError redirect handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, '', '/login');
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('preserves a valid redirect_to param across login failure', () => {
    window.history.replaceState({}, '', '/login?redirect_to=%2Fc%2Fabc123');

    renderProvider();

    act(() => {
      mockCapturedLoginOptions.onError({ message: 'Invalid credentials' });
    });

    expect(mockNavigate).toHaveBeenCalledWith('/login?redirect_to=%2Fc%2Fabc123', {
      replace: true,
    });
  });

  it('drops redirect_to when it contains an absolute URL (open-redirect prevention)', () => {
    window.history.replaceState({}, '', '/login?redirect_to=https%3A%2F%2Fevil.com');

    renderProvider();

    act(() => {
      mockCapturedLoginOptions.onError({ message: 'Invalid credentials' });
    });

    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('drops redirect_to when it points to /login (recursive redirect prevention)', () => {
    window.history.replaceState({}, '', '/login?redirect_to=%2Flogin');

    renderProvider();

    act(() => {
      mockCapturedLoginOptions.onError({ message: 'Invalid credentials' });
    });

    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('navigates to plain /login when no redirect_to param exists', () => {
    renderProvider();

    act(() => {
      mockCapturedLoginOptions.onError({ message: 'Server error' });
    });

    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('preserves redirect_to with query params and hash', () => {
    const target = '/c/abc123?model=gpt-4#section';
    window.history.replaceState({}, '', `/login?redirect_to=${encodeURIComponent(target)}`);

    renderProvider();

    act(() => {
      mockCapturedLoginOptions.onError({ message: 'Invalid credentials' });
    });

    const navigatedUrl = mockNavigate.mock.calls[0][0] as string;
    const params = new URLSearchParams(navigatedUrl.split('?')[1]);
    expect(decodeURIComponent(params.get('redirect_to')!)).toBe(target);
  });
});

describe('AuthContextProvider — logout onSuccess/onError handling', () => {
  const mockSetTokenHeader = jest.requireMock('librechat-data-provider').setTokenHeader;

  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, '', '/c/some-chat');
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('calls window.location.replace and setTokenHeader(undefined) when redirect is present', () => {
    const replaceSpy = jest.spyOn(window.location, 'replace').mockImplementation(() => {});

    renderProvider();

    act(() => {
      mockCapturedLogoutOptions.onSuccess({
        message: 'Logout successful',
        redirect: 'https://idp.example.com/logout?id_token_hint=abc',
      });
    });

    expect(replaceSpy).toHaveBeenCalledWith('https://idp.example.com/logout?id_token_hint=abc');
    expect(mockSetTokenHeader).toHaveBeenCalledWith(undefined);
  });

  it('does not call window.location.replace when redirect is absent', async () => {
    const replaceSpy = jest.spyOn(window.location, 'replace').mockImplementation(() => {});

    renderProvider();

    act(() => {
      mockCapturedLogoutOptions.onSuccess({ message: 'Logout successful' });
    });

    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('does not trigger silentRefresh after OIDC redirect', () => {
    const replaceSpy = jest.spyOn(window.location, 'replace').mockImplementation(() => {});

    renderProviderLive();
    mockRefreshMutate.mockClear();

    act(() => {
      mockCapturedLogoutOptions.onSuccess({
        message: 'Logout successful',
        redirect: 'https://idp.example.com/logout?id_token_hint=abc',
      });
    });

    expect(replaceSpy).toHaveBeenCalled();
    expect(mockRefreshMutate).not.toHaveBeenCalled();
  });
});

describe('AuthContextProvider — silentRefresh post-login redirect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('navigates to stored sessionStorage redirect after successful token refresh', () => {
    jest.useFakeTimers();
    sessionStorage.setItem(SESSION_KEY, '/c/new?endpoint=bedrock&model=claude-sonnet-4-6');

    renderProviderLive();

    expect(mockRefreshMutate).toHaveBeenCalledTimes(1);
    const [, refreshOptions] = mockRefreshMutate.mock.calls[0] as [
      unknown,
      { onSuccess: (data: unknown) => void },
    ];

    act(() => {
      refreshOptions.onSuccess({ user: { id: '1', role: 'USER' }, token: 'new-token' });
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(mockNavigate).toHaveBeenCalledWith('/c/new?endpoint=bedrock&model=claude-sonnet-4-6', {
      replace: true,
    });
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    jest.useRealTimers();
  });

  it('navigates to current URL when no stored redirect exists', () => {
    jest.useFakeTimers();
    window.history.replaceState({}, '', '/c/new');

    renderProviderLive();

    expect(mockRefreshMutate).toHaveBeenCalledTimes(1);
    const [, refreshOptions] = mockRefreshMutate.mock.calls[0] as [
      unknown,
      { onSuccess: (data: unknown) => void },
    ];

    act(() => {
      refreshOptions.onSuccess({ user: { id: '1', role: 'USER' }, token: 'new-token' });
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(mockNavigate).toHaveBeenCalledWith('/c/new', { replace: true });
    jest.useRealTimers();
  });

  it('does not re-trigger silentRefresh after successful redirect', () => {
    jest.useFakeTimers();
    sessionStorage.setItem(SESSION_KEY, '/c/abc?endpoint=bedrock');

    renderProviderLive();

    expect(mockRefreshMutate).toHaveBeenCalledTimes(1);
    const [, refreshOptions] = mockRefreshMutate.mock.calls[0] as [
      unknown,
      { onSuccess: (data: unknown) => void },
    ];
    mockRefreshMutate.mockClear();

    act(() => {
      refreshOptions.onSuccess({ user: { id: '1', role: 'USER' }, token: 'new-token' });
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/c/abc?endpoint=bedrock', { replace: true });
    expect(mockRefreshMutate).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('falls back to current URL for unsafe stored redirect', () => {
    jest.useFakeTimers();
    window.history.replaceState({}, '', '/c/new');
    sessionStorage.setItem(SESSION_KEY, 'https://evil.com/steal');

    renderProviderLive();

    expect(mockRefreshMutate).toHaveBeenCalledTimes(1);
    const [, refreshOptions] = mockRefreshMutate.mock.calls[0] as [
      unknown,
      { onSuccess: (data: unknown) => void },
    ];

    act(() => {
      refreshOptions.onSuccess({ user: { id: '1', role: 'USER' }, token: 'new-token' });
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(mockNavigate).toHaveBeenCalledWith('/c/new', { replace: true });
    expect(mockNavigate).not.toHaveBeenCalledWith('https://evil.com/steal', expect.anything());
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    jest.useRealTimers();
  });
});

describe('AuthContextProvider — silentRefresh subdirectory deployment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    mockApiBaseUrl.mockReturnValue('/chat');
  });

  afterEach(() => {
    mockApiBaseUrl.mockReturnValue('');
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('strips base path from window.location.pathname before navigating (prevents /chat/chat doubling)', () => {
    jest.useFakeTimers();
    window.history.replaceState({}, '', '/chat/c/abc123?model=gpt-4');

    renderProviderLive();

    expect(mockRefreshMutate).toHaveBeenCalledTimes(1);
    const [, refreshOptions] = mockRefreshMutate.mock.calls[0] as [
      unknown,
      { onSuccess: (data: unknown) => void },
    ];

    act(() => {
      refreshOptions.onSuccess({ user: { id: '1', role: 'USER' }, token: 'new-token' });
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(mockNavigate).toHaveBeenCalledWith('/c/abc123?model=gpt-4', { replace: true });
    expect(mockNavigate).not.toHaveBeenCalledWith(
      expect.stringContaining('/chat/c/'),
      expect.anything(),
    );
    jest.useRealTimers();
  });

  it('falls back to root when window.location.pathname equals the base path', () => {
    jest.useFakeTimers();
    window.history.replaceState({}, '', '/chat');

    renderProviderLive();

    const [, refreshOptions] = mockRefreshMutate.mock.calls[0] as [
      unknown,
      { onSuccess: (data: unknown) => void },
    ];

    act(() => {
      refreshOptions.onSuccess({ user: { id: '1', role: 'USER' }, token: 'new-token' });
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    jest.useRealTimers();
  });
});

describe('AuthContextProvider — logout error handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, '', '/c/some-chat');
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('clears auth state on logout error without external redirect', () => {
    jest.useFakeTimers();
    const replaceSpy = jest.spyOn(window.location, 'replace').mockImplementation(() => {});
    const { getByTestId } = renderProvider();

    act(() => {
      mockCapturedLogoutOptions.onError(new Error('Logout failed'));
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(replaceSpy).not.toHaveBeenCalled();
    expect(getByTestId('consumer').getAttribute('data-authenticated')).toBe('false');
    jest.useRealTimers();
  });
});

describe('AuthContextProvider — custom role detection and fetching', () => {
  const mockUseGetRole = jest.requireMock('~/data-provider').useGetRole;
  const staffPermissions = {
    name: 'STAFF',
    permissions: { PROMPTS: { USE: true, CREATE: false } },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('calls useGetRole with the custom role name and enabled: true for custom role users', () => {
    jest.useFakeTimers();

    renderProviderLive();

    const [, refreshOptions] = mockRefreshMutate.mock.calls[0] as [
      unknown,
      { onSuccess: (data: unknown) => void },
    ];

    act(() => {
      refreshOptions.onSuccess({ user: { id: '1', role: 'STAFF' }, token: 'tok' });
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });

    const staffCalls = mockUseGetRole.mock.calls.filter(([name]: [string]) => name === 'STAFF');
    expect(staffCalls.length).toBeGreaterThan(0);
    const lastStaffCall = staffCalls[staffCalls.length - 1];
    expect(lastStaffCall[1]).toEqual(expect.objectContaining({ enabled: true }));

    jest.useRealTimers();
  });

  it('calls useGetRole with enabled: false for USER role users', () => {
    jest.useFakeTimers();

    renderProviderLive();

    const [, refreshOptions] = mockRefreshMutate.mock.calls[0] as [
      unknown,
      { onSuccess: (data: unknown) => void },
    ];

    act(() => {
      refreshOptions.onSuccess({ user: { id: '1', role: 'USER' }, token: 'tok' });
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });

    const sentinelCalls = mockUseGetRole.mock.calls.filter(([name]: [string]) => name === '_');
    expect(sentinelCalls.length).toBeGreaterThan(0);
    for (const call of sentinelCalls) {
      expect(call[1]).toEqual(expect.objectContaining({ enabled: false }));
    }

    jest.useRealTimers();
  });

  it('calls useGetRole with enabled: false for ADMIN role users', () => {
    jest.useFakeTimers();

    renderProviderLive();

    const [, refreshOptions] = mockRefreshMutate.mock.calls[0] as [
      unknown,
      { onSuccess: (data: unknown) => void },
    ];

    act(() => {
      refreshOptions.onSuccess({ user: { id: '1', role: 'ADMIN' }, token: 'tok' });
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });

    const sentinelCalls = mockUseGetRole.mock.calls.filter(([name]: [string]) => name === '_');
    expect(sentinelCalls.length).toBeGreaterThan(0);
    for (const call of sentinelCalls) {
      expect(call[1]).toEqual(expect.objectContaining({ enabled: false }));
    }

    jest.useRealTimers();
  });

  it('includes custom role data in the roles context map when loaded', () => {
    jest.useFakeTimers();
    mockUseGetRole.mockImplementation((name: string, opts?: { enabled?: boolean }) => {
      if (name === 'STAFF' && opts?.enabled) {
        return { data: staffPermissions };
      }
      return { data: null };
    });

    const { getByTestId } = renderProviderLive();

    const [, refreshOptions] = mockRefreshMutate.mock.calls[0] as [
      unknown,
      { onSuccess: (data: unknown) => void },
    ];

    act(() => {
      refreshOptions.onSuccess({ user: { id: '1', role: 'STAFF' }, token: 'tok' });
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });

    const rolesAttr = getByTestId('consumer').getAttribute('data-roles') ?? '{}';
    const roles = JSON.parse(rolesAttr);
    expect(roles).toHaveProperty('STAFF');
    expect(roles.STAFF).toEqual(staffPermissions);

    mockUseGetRole.mockReturnValue({ data: null });
    jest.useRealTimers();
  });
});

describe('AuthContextProvider - Identity Platform cutover', () => {
  const identityPlatform = {
    enabled: true as const,
    apiKey: 'public-key',
    authDomain: 'stara.example.test',
    projectId: 'stara-test',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockStartupConfigQuery = { data: { identityPlatform }, isFetched: true };
    window.history.replaceState({}, '', '/login');
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('establishes the canonical user only after token verification and identity sync', async () => {
    const getIdToken = jest.fn().mockResolvedValue('identity-token');
    const { getByTestId } = renderProviderLive();

    expect(mockRefreshMutate).not.toHaveBeenCalled();
    expect(mockIdentityUserListener).toEqual(expect.any(Function));

    act(() => {
      mockIdentityUserListener?.({ uid: 'identity-user-1', getIdToken });
    });

    await waitFor(() => {
      expect(getByTestId('consumer').getAttribute('data-authenticated')).toBe('true');
    });
    expect(getIdToken).toHaveBeenCalledTimes(1);
    expect(mockSyncStaraIdentity).toHaveBeenCalledTimes(1);
    expect(mockGetCanonicalUser).toHaveBeenCalledTimes(1);
    expect(getByTestId('consumer').getAttribute('data-token')).toBe('identity-token');
    expect(getByTestId('consumer').getAttribute('data-user')).toBe('identity-user-1');
  });

  it('clears the prior account before synchronizing a different Firebase subject', async () => {
    let releaseSecondSync: (() => void) | undefined;
    mockSyncStaraIdentity.mockResolvedValueOnce({}).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseSecondSync = () => resolve({});
        }),
    );
    mockGetCanonicalUser
      .mockResolvedValueOnce({
        id: 'identity-user-1',
        email: 'owner@example.com',
        role: 'USER',
        provider: 'identity-platform',
      })
      .mockResolvedValueOnce({
        id: 'identity-user-2',
        email: 'admin@example.com',
        role: 'USER',
        provider: 'identity-platform',
      });
    const { getByTestId } = renderProviderLive();

    act(() => {
      mockIdentityUserListener?.({
        uid: 'identity-user-1',
        getIdToken: jest.fn().mockResolvedValue('identity-token-1'),
      });
    });
    await waitFor(() => {
      expect(getByTestId('consumer').getAttribute('data-user')).toBe('identity-user-1');
    });

    act(() => {
      mockIdentityUserListener?.({
        uid: 'identity-user-2',
        getIdToken: jest.fn().mockResolvedValue('identity-token-2'),
      });
    });
    await waitFor(() => {
      expect(getByTestId('consumer').getAttribute('data-authenticated')).toBe('false');
      expect(getByTestId('consumer').getAttribute('data-user')).toBe('');
    });

    act(() => releaseSecondSync?.());
    await waitFor(() => {
      expect(getByTestId('consumer').getAttribute('data-user')).toBe('identity-user-2');
    });
  });

  it('fails closed and signs Firebase out when canonical identity sync fails', async () => {
    mockSyncStaraIdentity.mockRejectedValue(new Error('Canonical identity is unavailable'));
    const { getByTestId } = renderProviderLive();

    act(() => {
      mockIdentityUserListener?.({
        uid: 'identity-user-1',
        getIdToken: jest.fn().mockResolvedValue('identity-token'),
      });
    });

    await waitFor(() => {
      expect(mockSignOutFromIdentityPlatform).toHaveBeenCalledWith(identityPlatform);
    });
    expect(getByTestId('consumer').getAttribute('data-authenticated')).toBe('false');
    expect(getByTestId('consumer').getAttribute('data-token')).toBe('');
    expect(mockGetCanonicalUser).not.toHaveBeenCalled();
  });

  it('registers Firebase as the shared token refresh authority', async () => {
    renderProviderLive();
    act(() => {
      mockIdentityUserListener?.({
        uid: 'identity-user-1',
        getIdToken: jest.fn().mockResolvedValue('identity-token'),
      });
    });
    await waitFor(() => expect(mockSyncStaraIdentity).toHaveBeenCalled());

    const refreshHandler = mockSetAuthTokenRefreshHandler.mock.calls.find(
      ([handler]) => typeof handler === 'function',
    )?.[0] as (() => Promise<string | null>) | undefined;
    expect(refreshHandler).toEqual(expect.any(Function));

    await expect(refreshHandler?.()).resolves.toBe('refreshed-identity-token');
    expect(mockRefreshIdentityPlatformToken).toHaveBeenCalledWith(identityPlatform);
  });

  it('rejects a refreshed token when the Firebase subject changes in flight', async () => {
    let releaseRefresh: ((token: string) => void) | undefined;
    mockRefreshIdentityPlatformToken.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRefresh = resolve;
        }),
    );
    renderProviderLive();
    act(() => {
      mockIdentityUserListener?.({
        uid: 'identity-user-1',
        getIdToken: jest.fn().mockResolvedValue('identity-token-1'),
      });
    });
    await waitFor(() => expect(mockSyncStaraIdentity).toHaveBeenCalled());

    const refreshHandler = mockSetAuthTokenRefreshHandler.mock.calls.find(
      ([handler]) => typeof handler === 'function',
    )?.[0] as (() => Promise<string | null>) | undefined;
    const refreshPromise = refreshHandler?.();
    act(() => {
      mockIdentityUserListener?.({
        uid: 'identity-user-2',
        getIdToken: jest.fn().mockResolvedValue('identity-token-2'),
      });
    });
    releaseRefresh?.('stale-identity-token');

    await expect(refreshPromise).resolves.toBeNull();
  });

  it('routes an enrolled account to the TOTP challenge without calling legacy login', async () => {
    mockSignInToIdentityPlatform.mockResolvedValue({ mfaRequired: true });
    const { getByTestId } = renderProviderLive();

    fireEvent.click(getByTestId('identity-login'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login/2fa', { replace: true });
    });
    expect(mockSignInToIdentityPlatform).toHaveBeenCalledWith(
      identityPlatform,
      'owner@example.com',
      'password',
    );
    expect(mockLegacyLoginMutate).not.toHaveBeenCalled();
  });

  it('signs out the Firebase session after the authenticated logout endpoint completes', async () => {
    renderProviderLive();

    act(() => {
      mockCapturedLogoutOptions.onSuccess(undefined);
    });

    await waitFor(() => {
      expect(mockSignOutFromIdentityPlatform).toHaveBeenCalledWith(identityPlatform);
    });
  });
});
