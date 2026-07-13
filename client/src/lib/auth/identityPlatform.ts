import type { Auth, MultiFactorError, MultiFactorResolver, User } from 'firebase/auth';
import type { TIdentityPlatformStartupConfig } from 'librechat-data-provider';
import type { FirebaseApp } from 'firebase/app';

const APP_NAME = 'stara-identity-platform';
const emulatorConnections = new WeakSet<Auth>();
let pendingMfaResolver: MultiFactorResolver | undefined;
let firebaseModulesPromise:
  | Promise<{
      appModule: typeof import('firebase/app');
      authModule: typeof import('firebase/auth');
    }>
  | undefined;

const loadFirebaseModules = () => {
  firebaseModulesPromise ??= Promise.all([import('firebase/app'), import('firebase/auth')]).then(
    ([appModule, authModule]) => ({ appModule, authModule }),
  );
  return firebaseModulesPromise;
};

const identityPlatformApp = (
  config: TIdentityPlatformStartupConfig,
  appModule: typeof import('firebase/app'),
): FirebaseApp => {
  const existing = appModule.getApps().find((app) => app.name === APP_NAME);
  if (existing) {
    return existing;
  }

  return appModule.initializeApp(
    {
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      ...(config.appId ? { appId: config.appId } : {}),
    },
    APP_NAME,
  );
};

const getIdentityPlatformAuthContext = async (config: TIdentityPlatformStartupConfig) => {
  const { appModule, authModule } = await loadFirebaseModules();
  const auth = authModule.getAuth(identityPlatformApp(config, appModule));
  auth.tenantId = config.tenantId ?? null;

  if (config.emulatorUrl && !emulatorConnections.has(auth)) {
    authModule.connectAuthEmulator(auth, config.emulatorUrl, { disableWarnings: true });
    emulatorConnections.add(auth);
  }

  return { auth, authModule };
};

export const getIdentityPlatformAuth = async (
  config: TIdentityPlatformStartupConfig,
): Promise<Auth> => (await getIdentityPlatformAuthContext(config)).auth;

export const subscribeToIdentityPlatform = (
  config: TIdentityPlatformStartupConfig,
  onUser: (user: User | null) => void,
  onError: (error: Error) => void,
) => {
  let active = true;
  let unsubscribe: (() => void) | undefined;
  void getIdentityPlatformAuthContext(config)
    .then(({ auth, authModule }) => {
      if (!active) {
        return;
      }
      unsubscribe = authModule.onIdTokenChanged(auth, onUser, onError);
    })
    .catch((error: unknown) => {
      if (active) {
        onError(error instanceof Error ? error : new Error('Identity Platform failed to start.'));
      }
    });

  return () => {
    active = false;
    unsubscribe?.();
  };
};

export const signInToIdentityPlatform = async (
  config: TIdentityPlatformStartupConfig,
  email: string,
  password: string,
): Promise<{ mfaRequired: boolean }> => {
  const { auth, authModule } = await getIdentityPlatformAuthContext(config);
  try {
    await authModule.signInWithEmailAndPassword(auth, email, password);
    pendingMfaResolver = undefined;
    return { mfaRequired: false };
  } catch (error) {
    if ((error as { code?: string })?.code !== 'auth/multi-factor-auth-required') {
      throw error;
    }

    const resolver = authModule.getMultiFactorResolver(auth, error as MultiFactorError);
    if (
      !resolver.hints.some(
        (hint) => hint.factorId === authModule.TotpMultiFactorGenerator.FACTOR_ID,
      )
    ) {
      throw new Error('No supported multi-factor method is enrolled for this account.');
    }
    pendingMfaResolver = resolver;
    return { mfaRequired: true };
  }
};

export const completeIdentityPlatformMfa = async (oneTimePassword: string): Promise<void> => {
  const { authModule } = await loadFirebaseModules();
  const resolver = pendingMfaResolver;
  if (!resolver) {
    throw new Error('The multi-factor sign-in session expired. Sign in again.');
  }
  const hint = resolver.hints.find(
    (candidate) => candidate.factorId === authModule.TotpMultiFactorGenerator.FACTOR_ID,
  );
  if (!hint) {
    throw new Error('No supported multi-factor method is enrolled for this account.');
  }

  const assertion = authModule.TotpMultiFactorGenerator.assertionForSignIn(
    hint.uid,
    oneTimePassword,
  );
  await resolver.resolveSignIn(assertion);
  pendingMfaResolver = undefined;
};

export const refreshIdentityPlatformToken = async (
  config: TIdentityPlatformStartupConfig,
): Promise<string | null> => {
  const user = (await getIdentityPlatformAuth(config)).currentUser;
  return user ? user.getIdToken(true) : null;
};

export const signOutFromIdentityPlatform = async (
  config: TIdentityPlatformStartupConfig,
): Promise<void> => {
  pendingMfaResolver = undefined;
  const { auth, authModule } = await getIdentityPlatformAuthContext(config);
  await authModule.signOut(auth);
};

export const identityPlatformErrorMessage = (error: unknown): string => {
  const code = (error as { code?: string })?.code;
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/user-not-found' ||
    code === 'auth/wrong-password'
  ) {
    return 'Invalid email or password.';
  }
  if (code === 'auth/invalid-verification-code') {
    return 'Invalid verification code.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many attempts. Try again later.';
  }
  if (code === 'auth/user-disabled') {
    return 'This account is disabled.';
  }
  if (error instanceof Error && !code) {
    return error.message;
  }
  return 'Authentication failed. Please try again.';
};
