import {
  useRef,
  useMemo,
  useState,
  useEffect,
  useContext,
  useCallback,
  createContext,
} from 'react';
import { debounce } from 'lodash';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useRecoilState, useResetRecoilState, useSetRecoilState } from 'recoil';
import {
  apiBaseUrl,
  dataService,
  QueryKeys,
  request,
  SystemRoles,
  setTokenHeader,
  isSystemRoleName,
  buildLoginRedirectUrl,
} from 'librechat-data-provider';
import type { User as FirebaseUser } from 'firebase/auth';
import type * as t from 'librechat-data-provider';
import type { ReactNode } from 'react';
import {
  identityPlatformErrorMessage,
  refreshIdentityPlatformToken,
  signInToIdentityPlatform,
  signOutFromIdentityPlatform,
  subscribeToIdentityPlatform,
} from '~/lib/auth/identityPlatform';
import {
  useGetRole,
  useGetStartupConfig,
  useGetUserQuery,
  useLoginUserMutation,
  useLogoutUserMutation,
  useRefreshTokenMutation,
} from '~/data-provider';
import { TAuthConfig, TUserContext, TAuthContext, TResError } from '~/common';
import { SESSION_KEY, isSafeRedirect, getPostLoginRedirect } from '~/utils';
import useClearStates from './Config/useClearStates';
import useTimeout from './useTimeout';
import store from '~/store';

const AuthContext = (import.meta.hot?.data?.__AuthContext ??
  createContext<TAuthContext | undefined>(undefined)) as React.Context<TAuthContext | undefined>;
if (import.meta.hot) {
  import.meta.hot.data.__AuthContext = AuthContext;
}

const consumeAuthRedirect = () => {
  const storedRedirect = sessionStorage.getItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  const baseUrl = apiBaseUrl();
  const rawPath = window.location.pathname;
  const strippedPath =
    baseUrl && (rawPath === baseUrl || rawPath.startsWith(baseUrl + '/'))
      ? rawPath.slice(baseUrl.length) || '/'
      : rawPath;
  const currentUrl = `${strippedPath}${window.location.search}`;
  const isAuthPage = /^\/(login|register|forgot-password|reset-password|verify)(\/|$)/.test(
    strippedPath,
  );
  const fallbackRedirect = !isAuthPage && isSafeRedirect(currentUrl) ? currentUrl : '/c/new';
  return storedRedirect && isSafeRedirect(storedRedirect) ? storedRedirect : fallbackRedirect;
};

const AuthContextProvider = ({
  authConfig,
  children,
}: {
  authConfig?: TAuthConfig;
  children: ReactNode;
}) => {
  const isExternalRedirectRef = useRef(false);
  const silentRefreshAttemptedRef = useRef(false);
  const identityPlatformRef = useRef<NonNullable<t.TStartupConfig['identityPlatform']>>();
  const identitySubjectRef = useRef<string | undefined>(undefined);
  const identitySessionGenerationRef = useRef(0);
  const [user, setUser] = useRecoilState(store.user);
  const logoutRedirectRef = useRef<string | undefined>(undefined);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const setQueriesEnabled = useSetRecoilState<boolean>(store.queriesEnabled);
  const resetDefaultPreset = useResetRecoilState(store.defaultPreset);
  const queryClient = useQueryClient();
  const clearStates = useClearStates();
  const startupConfigQuery = useGetStartupConfig();
  if (startupConfigQuery.data?.identityPlatform) {
    identityPlatformRef.current = startupConfigQuery.data.identityPlatform;
  }
  const identityPlatform = startupConfigQuery.data?.identityPlatform ?? identityPlatformRef.current;
  const identityPlatformEnabled = identityPlatform?.enabled === true;

  const userRoleName = user?.role ?? '';
  const isCustomRole = isAuthenticated && !!user?.role && !isSystemRoleName(user.role);

  const { data: userRole = null } = useGetRole(SystemRoles.USER, {
    enabled: !!(isAuthenticated && (user?.role ?? '')),
  });
  const { data: adminRole = null } = useGetRole(SystemRoles.ADMIN, {
    enabled: !!(isAuthenticated && user?.role === SystemRoles.ADMIN),
  });
  const { data: customRole = null } = useGetRole(isCustomRole ? userRoleName : '_', {
    enabled: isCustomRole,
  });

  const navigate = useNavigate();

  const setUserContext = useMemo(
    () =>
      debounce((userContext: TUserContext) => {
        const { token, isAuthenticated, user, redirect } = userContext;
        setUser(user);
        setToken(token);
        setTokenHeader(token);
        setIsAuthenticated(isAuthenticated);
        if (isAuthenticated) {
          setQueriesEnabled(true);
        }

        const searchParams = new URLSearchParams(window.location.search);
        const postLoginRedirect = getPostLoginRedirect(searchParams);

        const logoutRedirect = logoutRedirectRef.current;
        logoutRedirectRef.current = undefined;

        const finalRedirect =
          logoutRedirect ??
          postLoginRedirect ??
          (redirect === '/login' || (redirect && isSafeRedirect(redirect)) ? redirect : null);

        if (finalRedirect == null) {
          return;
        }

        navigate(finalRedirect, { replace: true });
      }, 50),
    [navigate, setUser, setQueriesEnabled],
  );
  const doSetError = useTimeout({ callback: (error) => setError(error as string | undefined) });

  const clearIdentityClientState = useCallback(async () => {
    setUserContext.cancel();
    setTokenHeader(undefined);
    setToken(undefined);
    setIsAuthenticated(false);
    setQueriesEnabled(false);
    setUser(undefined);
    resetDefaultPreset();
    queryClient.removeQueries({
      predicate: ({ queryKey }) => queryKey[0] !== QueryKeys.startupConfig || queryKey[1] === true,
    });
    await clearStates();
  }, [clearStates, queryClient, resetDefaultPreset, setQueriesEnabled, setUser, setUserContext]);

  const finishIdentitySignOut = useCallback(async () => {
    if (!identityPlatform) {
      return;
    }
    identitySubjectRef.current = undefined;
    try {
      await Promise.allSettled([
        signOutFromIdentityPlatform(identityPlatform),
        clearIdentityClientState(),
      ]);
    } finally {
      setUserContext({
        token: undefined,
        isAuthenticated: false,
        user: undefined,
        redirect: '/login',
      });
      setUserContext.flush();
    }
  }, [clearIdentityClientState, identityPlatform, setUserContext]);

  const loginUser = useLoginUserMutation({
    onSuccess: (data: t.TLoginResponse) => {
      const { user, token, twoFAPending, tempToken } = data;
      if (twoFAPending) {
        navigate(`/login/2fa?tempToken=${tempToken}`, { replace: true });
        return;
      }
      setError(undefined);
      setUserContext({ token, isAuthenticated: true, user, redirect: '/c/new' });
    },
    onError: (error: TResError | unknown) => {
      const resError = error as TResError;
      doSetError(resError.message);
      // Preserve a valid redirect_to across login failures so the deep link survives retries.
      // Cannot use buildLoginRedirectUrl() here — it reads the current pathname (already /login)
      // and would return plain /login, dropping the redirect_to destination.
      const redirectTo = new URLSearchParams(window.location.search).get('redirect_to');
      const loginPath =
        redirectTo && isSafeRedirect(redirectTo)
          ? `/login?redirect_to=${encodeURIComponent(redirectTo)}`
          : '/login';
      navigate(loginPath, { replace: true });
    },
  });
  const logoutUser = useLogoutUserMutation({
    onSuccess: (data) => {
      if (identityPlatform) {
        void finishIdentitySignOut();
        return;
      }
      if (data?.redirect) {
        /** data.redirect is the IdP's end_session_endpoint URL — an absolute URL generated
         * server-side from trusted IdP metadata (not user input), so isSafeRedirect is bypassed.
         * setUserContext is debounced (50ms) and won't fire before page unload, so clear the
         * axios Authorization header synchronously to prevent in-flight requests. */
        isExternalRedirectRef.current = true;
        setTokenHeader(undefined);
        window.location.replace(data.redirect);
        return;
      }
      setUserContext({
        token: undefined,
        isAuthenticated: false,
        user: undefined,
        redirect: '/login',
      });
      setUserContext.flush();
    },
    onError: (error) => {
      if (identityPlatform) {
        doSetError((error as Error).message);
        void finishIdentitySignOut();
        return;
      }
      doSetError((error as Error).message);
      setUserContext({
        token: undefined,
        isAuthenticated: false,
        user: undefined,
        redirect: '/login',
      });
      setUserContext.flush();
    },
  });
  const refreshToken = useRefreshTokenMutation();

  const logout = useCallback(
    (redirect?: string) => {
      if (redirect) {
        logoutRedirectRef.current = redirect;
      }
      logoutUser.mutate(undefined);
    },
    [logoutUser],
  );

  const userQuery = useGetUserQuery({
    enabled: !identityPlatformEnabled && !!(token ?? ''),
  });

  const login = useCallback(
    async (data: t.TLoginUser) => {
      if (!identityPlatform) {
        loginUser.mutate(data);
        return;
      }

      try {
        setError(undefined);
        const result = await signInToIdentityPlatform(identityPlatform, data.email, data.password);
        if (result.mfaRequired) {
          navigate('/login/2fa', { replace: true });
        }
      } catch (identityError) {
        doSetError(identityPlatformErrorMessage(identityError));
      }
    },
    [doSetError, identityPlatform, loginUser, navigate],
  );

  const silentRefresh = useCallback(() => {
    if (authConfig?.test === true) {
      console.log('Test mode. Skipping silent refresh.');
      return;
    }
    if (isExternalRedirectRef.current) {
      return;
    }
    if (silentRefreshAttemptedRef.current) {
      return;
    }
    silentRefreshAttemptedRef.current = true;
    refreshToken.mutate(undefined, {
      onSuccess: (data: t.TRefreshTokenResponse | undefined) => {
        if (isExternalRedirectRef.current) {
          return;
        }
        const { user, token = '' } = data ?? {};
        if (token) {
          const redirect = consumeAuthRedirect();
          setUserContext({ user, token, isAuthenticated: true, redirect });
          return;
        }
        console.log('Token is not present. User is not authenticated.');
        if (authConfig?.test === true) {
          return;
        }
        navigate(buildLoginRedirectUrl());
      },
      onError: (error) => {
        if (isExternalRedirectRef.current) {
          return;
        }
        console.log('refreshToken mutation error:', error);
        if (authConfig?.test === true) {
          return;
        }
        navigate(buildLoginRedirectUrl());
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are stable at mount; adding refreshToken causes infinite re-fire
  }, []);

  useEffect(() => {
    if (!identityPlatform) {
      request.setAuthTokenRefreshHandler(undefined);
      return;
    }

    let active = true;
    request.setAuthTokenRefreshHandler(async () => {
      const expectedSubject = identitySubjectRef.current;
      if (!expectedSubject) {
        return null;
      }
      const refreshedToken = await refreshIdentityPlatformToken(identityPlatform);
      return identitySubjectRef.current === expectedSubject ? refreshedToken : null;
    });

    const establishIdentitySession = async (firebaseUser: FirebaseUser | null) => {
      const generation = ++identitySessionGenerationRef.current;
      if (!firebaseUser) {
        const hadIdentitySession = identitySubjectRef.current != null;
        identitySubjectRef.current = undefined;
        if (hadIdentitySession) {
          void clearIdentityClientState();
        } else {
          setTokenHeader(undefined);
        }
        setUserContext({
          token: undefined,
          isAuthenticated: false,
          user: undefined,
        });
        return;
      }

      try {
        if (identitySubjectRef.current !== firebaseUser.uid) {
          identitySubjectRef.current = firebaseUser.uid;
          await clearIdentityClientState();
        }
        const nextToken = await firebaseUser.getIdToken();
        if (!active || generation !== identitySessionGenerationRef.current) {
          return;
        }
        setTokenHeader(nextToken);
        await dataService.syncStaraIdentity();
        const canonicalUser = await dataService.getUser();
        if (!active || generation !== identitySessionGenerationRef.current) {
          return;
        }
        setError(undefined);
        setUserContext({
          token: nextToken,
          isAuthenticated: true,
          user: canonicalUser,
          redirect: consumeAuthRedirect(),
        });
      } catch (identityError) {
        if (!active || generation !== identitySessionGenerationRef.current) {
          return;
        }
        identitySubjectRef.current = undefined;
        void Promise.allSettled([
          signOutFromIdentityPlatform(identityPlatform),
          clearIdentityClientState(),
        ]);
        doSetError(identityPlatformErrorMessage(identityError));
        setUserContext({
          token: undefined,
          isAuthenticated: false,
          user: undefined,
        });
      }
    };

    const unsubscribe = subscribeToIdentityPlatform(
      identityPlatform,
      (firebaseUser) => void establishIdentitySession(firebaseUser),
      (identityError) => doSetError(identityPlatformErrorMessage(identityError)),
    );

    return () => {
      active = false;
      identitySessionGenerationRef.current += 1;
      request.setAuthTokenRefreshHandler(undefined);
      unsubscribe();
    };
  }, [clearIdentityClientState, doSetError, identityPlatform, setUserContext]);

  useEffect(() => {
    if (isExternalRedirectRef.current) {
      return;
    }
    if (userQuery.data) {
      setUser(userQuery.data);
    } else if (userQuery.isError) {
      doSetError((userQuery.error as Error).message);
      navigate(buildLoginRedirectUrl(), { replace: true });
    }
    if (error != null && error && isAuthenticated) {
      doSetError(undefined);
    }
    if (
      startupConfigQuery.isFetched &&
      !identityPlatformEnabled &&
      (token == null || !token || !isAuthenticated)
    ) {
      silentRefresh();
    }
  }, [
    token,
    isAuthenticated,
    userQuery.data,
    userQuery.isError,
    userQuery.error,
    error,
    setUser,
    navigate,
    silentRefresh,
    setUserContext,
    doSetError,
    startupConfigQuery.isFetched,
    identityPlatformEnabled,
  ]);

  useEffect(() => {
    const handleTokenUpdate = (event: CustomEvent<string>) => {
      if (identityPlatformEnabled) {
        return;
      }
      console.log('tokenUpdated event received event');
      setUserContext({
        token: event.detail,
        isAuthenticated: true,
        user: user,
      });
    };

    window.addEventListener('tokenUpdated', handleTokenUpdate as EventListener);

    return () => {
      window.removeEventListener('tokenUpdated', handleTokenUpdate as EventListener);
    };
  }, [identityPlatformEnabled, setUserContext, user]);

  const memoedValue = useMemo(
    () => ({
      user,
      token,
      error,
      login,
      logout,
      setError,
      roles: {
        [SystemRoles.USER]: userRole,
        [SystemRoles.ADMIN]: adminRole,
        ...(isCustomRole && customRole ? { [userRoleName]: customRole } : {}),
      },
      isAuthenticated,
    }),

    [
      user,
      error,
      isAuthenticated,
      token,
      userRole,
      adminRole,
      isCustomRole,
      userRoleName,
      customRole,
      login,
      logout,
    ],
  );

  return <AuthContext.Provider value={memoedValue}>{children}</AuthContext.Provider>;
};

const useAuthContext = () => {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error('useAuthContext should be used inside AuthProvider');
  }

  return context;
};

export { AuthContextProvider, useAuthContext, AuthContext };
