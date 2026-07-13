import type { Auth, MultiFactorError, MultiFactorResolver, TotpSecret, User } from 'firebase/auth';
import type { TIdentityPlatformStartupConfig } from 'librechat-data-provider';
import type { FirebaseApp } from 'firebase/app';

const APP_NAME = 'stara-identity-platform';
const SIGNUP_INVITE_STORAGE_KEY = 'stara.identity.signup-invite';
const SIGNUP_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SIGNUP_INVITE_MAX_LENGTH = 512;
const emulatorConnections = new WeakSet<Auth>();
let pendingMfaResolver: MultiFactorResolver | undefined;
let pendingTotpSecret: TotpSecret | undefined;
let registrationInProgress = false;
let suppressedRegistrationSubject: { uid: string; until: number } | undefined;
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

const identityActionUrl = (path: string, inviteToken?: string): string => {
  const basePath = document.querySelector('base')?.getAttribute('href')?.replace(/\/$/, '') ?? '';
  const url = new URL(`${basePath}${path}`, window.location.origin);
  if (inviteToken) {
    url.searchParams.set('invite_token', inviteToken);
  }
  return url.toString();
};

const requireCurrentUser = (auth: Auth): User => {
  if (!auth.currentUser) {
    throw new Error('Sign in again to continue.');
  }
  return auth.currentUser;
};

type StoredSignupInvite = {
  email: string;
  inviteToken: string;
  expiresAt: number;
};

const normalizeInviteToken = (inviteToken?: string): string | undefined => {
  const normalized = inviteToken?.trim().slice(0, SIGNUP_INVITE_MAX_LENGTH);
  return normalized || undefined;
};

const readStoredSignupInvite = (): StoredSignupInvite | undefined => {
  try {
    const raw = window.localStorage.getItem(SIGNUP_INVITE_STORAGE_KEY);
    if (!raw) {
      return undefined;
    }
    const value = JSON.parse(raw) as Partial<StoredSignupInvite>;
    if (
      typeof value.email !== 'string' ||
      typeof value.inviteToken !== 'string' ||
      value.inviteToken.length > SIGNUP_INVITE_MAX_LENGTH ||
      typeof value.expiresAt !== 'number' ||
      value.expiresAt <= Date.now()
    ) {
      window.localStorage.removeItem(SIGNUP_INVITE_STORAGE_KEY);
      return undefined;
    }
    return value as StoredSignupInvite;
  } catch {
    try {
      window.localStorage.removeItem(SIGNUP_INVITE_STORAGE_KEY);
    } catch {
      // Storage can be unavailable entirely.
    }
    return undefined;
  }
};

export const rememberIdentityPlatformSignupInvite = (
  email: string | undefined,
  inviteToken?: string,
): void => {
  const normalizedEmail = email?.trim().toLowerCase() ?? '';
  const normalizedInviteToken = normalizeInviteToken(inviteToken);
  try {
    if (!normalizedInviteToken) {
      const existing = readStoredSignupInvite();
      if (existing && (!normalizedEmail || existing.email === normalizedEmail)) {
        window.localStorage.removeItem(SIGNUP_INVITE_STORAGE_KEY);
      }
      return;
    }
    window.localStorage.setItem(
      SIGNUP_INVITE_STORAGE_KEY,
      JSON.stringify({
        email: normalizedEmail,
        inviteToken: normalizedInviteToken,
        expiresAt: Date.now() + SIGNUP_INVITE_TTL_MS,
      } satisfies StoredSignupInvite),
    );
  } catch {
    // Storage can be disabled; the invitation remains available in the registration URL.
  }
};

export const getIdentityPlatformSignupInvite = (email?: string | null): string | undefined => {
  if (!email) {
    return undefined;
  }
  const stored = readStoredSignupInvite();
  return stored && (!stored.email || stored.email === email.trim().toLowerCase())
    ? stored.inviteToken
    : undefined;
};

export const clearIdentityPlatformSignupInvite = (email?: string | null): void => {
  try {
    const stored = readStoredSignupInvite();
    if (!stored || !email || stored.email === email.trim().toLowerCase()) {
      window.localStorage.removeItem(SIGNUP_INVITE_STORAGE_KEY);
    }
  } catch {
    // Storage can be disabled without affecting an established session.
  }
};

export const isIdentityPlatformRegistrationInProgress = (): boolean => registrationInProgress;

export const isSuppressedIdentityPlatformRegistrationUser = (user: User): boolean => {
  const suppressed = suppressedRegistrationSubject;
  if (!suppressed || suppressed.until <= Date.now()) {
    suppressedRegistrationSubject = undefined;
    return false;
  }
  return suppressed.uid === user.uid;
};

export const getIdentityPlatformAuth = async (
  config: TIdentityPlatformStartupConfig,
): Promise<Auth> => (await getIdentityPlatformAuthContext(config)).auth;

export const registerIdentityPlatformAccount = async (
  config: TIdentityPlatformStartupConfig,
  input: { email: string; password: string; displayName: string; inviteToken?: string },
): Promise<void> => {
  registrationInProgress = true;
  let authContext: Awaited<ReturnType<typeof getIdentityPlatformAuthContext>> | undefined;
  let createdUserUid: string | undefined;
  try {
    authContext = await getIdentityPlatformAuthContext(config);
    const { auth, authModule } = authContext;
    const inviteToken = normalizeInviteToken(input.inviteToken);
    const credential = await authModule.createUserWithEmailAndPassword(
      auth,
      input.email.trim().toLowerCase(),
      input.password,
    );
    createdUserUid = credential.user.uid;
    suppressedRegistrationSubject = { uid: credential.user.uid, until: Date.now() + 5000 };
    if (input.displayName.trim()) {
      await authModule.updateProfile(credential.user, { displayName: input.displayName.trim() });
    }
    rememberIdentityPlatformSignupInvite(input.email, inviteToken);
    await authModule.sendEmailVerification(credential.user, {
      url: identityActionUrl('/verify', inviteToken),
      handleCodeInApp: true,
    });
  } finally {
    const initializedAuthContext = authContext;
    if (
      initializedAuthContext &&
      createdUserUid &&
      initializedAuthContext.auth.currentUser?.uid === createdUserUid
    ) {
      await initializedAuthContext.authModule
        .signOut(initializedAuthContext.auth)
        .catch(() => undefined);
    }
    registrationInProgress = false;
  }
};

export const resendIdentityPlatformEmailVerification = async (
  config: TIdentityPlatformStartupConfig,
): Promise<void> => {
  const { auth, authModule } = await getIdentityPlatformAuthContext(config);
  const user = requireCurrentUser(auth);
  if (user.emailVerified) {
    return;
  }
  const inviteToken = getIdentityPlatformSignupInvite(user.email);
  await authModule.sendEmailVerification(user, {
    url: identityActionUrl('/verify', inviteToken),
    handleCodeInApp: true,
  });
};

export const requestIdentityPlatformPasswordReset = async (
  config: TIdentityPlatformStartupConfig,
  email: string,
): Promise<void> => {
  const { auth, authModule } = await getIdentityPlatformAuthContext(config);
  await authModule.sendPasswordResetEmail(auth, email.trim().toLowerCase(), {
    url: identityActionUrl('/login'),
    handleCodeInApp: false,
  });
};

export const applyIdentityPlatformEmailVerification = async (
  config: TIdentityPlatformStartupConfig,
  actionCode: string,
): Promise<void> => {
  const { auth, authModule } = await getIdentityPlatformAuthContext(config);
  await authModule.applyActionCode(auth, actionCode);
};

export const confirmIdentityPlatformPasswordReset = async (
  config: TIdentityPlatformStartupConfig,
  actionCode: string,
  password: string,
): Promise<void> => {
  const { auth, authModule } = await getIdentityPlatformAuthContext(config);
  await authModule.verifyPasswordResetCode(auth, actionCode);
  await authModule.confirmPasswordReset(auth, actionCode, password);
};

export const getIdentityPlatformAssurance = async (
  user: User,
): Promise<{ emailVerified: boolean; totpEnrolled: boolean; mfaSatisfied: boolean }> => {
  const { authModule } = await loadFirebaseModules();
  const factors = authModule.multiFactor(user).enrolledFactors;
  const token = await user.getIdTokenResult();
  const firebaseClaims = token.claims.firebase as { sign_in_second_factor?: unknown } | undefined;
  return {
    emailVerified: user.emailVerified,
    totpEnrolled: factors.some(
      (factor) => factor.factorId === authModule.TotpMultiFactorGenerator.FACTOR_ID,
    ),
    mfaSatisfied: typeof firebaseClaims?.sign_in_second_factor === 'string',
  };
};

export const beginIdentityPlatformTotpEnrollment = async (
  config: TIdentityPlatformStartupConfig,
): Promise<{ secretKey: string; qrCodeUrl: string }> => {
  const { auth, authModule } = await getIdentityPlatformAuthContext(config);
  const user = requireCurrentUser(auth);
  if (!user.emailVerified) {
    throw new Error('Verify your email before setting up multi-factor authentication.');
  }
  const factors = authModule.multiFactor(user);
  if (
    factors.enrolledFactors.some(
      (factor) => factor.factorId === authModule.TotpMultiFactorGenerator.FACTOR_ID,
    )
  ) {
    throw new Error('An authenticator app is already enrolled.');
  }
  pendingTotpSecret = undefined;
  const session = await factors.getSession();
  pendingTotpSecret = await authModule.TotpMultiFactorGenerator.generateSecret(session);
  return {
    secretKey: pendingTotpSecret.secretKey,
    qrCodeUrl: pendingTotpSecret.generateQrCodeUrl(user.email ?? user.uid, 'Stara'),
  };
};

export const completeIdentityPlatformTotpEnrollment = async (
  config: TIdentityPlatformStartupConfig,
  oneTimePassword: string,
): Promise<void> => {
  const secret = pendingTotpSecret;
  if (!secret) {
    throw new Error('The enrollment session expired. Start MFA setup again.');
  }
  const { auth, authModule } = await getIdentityPlatformAuthContext(config);
  const user = requireCurrentUser(auth);
  const assertion = authModule.TotpMultiFactorGenerator.assertionForEnrollment(
    secret,
    oneTimePassword,
  );
  await authModule.multiFactor(user).enroll(assertion, 'Authenticator app');
  pendingTotpSecret = undefined;
  await authModule.signOut(auth);
};

export const removeIdentityPlatformTotp = async (
  config: TIdentityPlatformStartupConfig,
): Promise<void> => {
  const { auth, authModule } = await getIdentityPlatformAuthContext(config);
  const factors = authModule.multiFactor(requireCurrentUser(auth));
  const enrolled = factors.enrolledFactors.find(
    (factor) => factor.factorId === authModule.TotpMultiFactorGenerator.FACTOR_ID,
  );
  if (!enrolled) {
    throw new Error('No authenticator app is enrolled.');
  }
  await factors.unenroll(enrolled);
  await authModule.signOut(auth).catch(() => undefined);
};

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
  pendingMfaResolver = undefined;
  const { auth, authModule } = await getIdentityPlatformAuthContext(config);
  try {
    await authModule.signInWithEmailAndPassword(auth, email, password);
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
  pendingTotpSecret = undefined;
  const { auth, authModule } = await getIdentityPlatformAuthContext(config);
  await authModule.signOut(auth);
};

export const identityPlatformErrorMessage = (error: unknown): string => {
  const responseMessage = (error as { response?: { data?: { message?: unknown } } })?.response?.data
    ?.message;
  if (typeof responseMessage === 'string' && responseMessage.trim()) {
    return responseMessage.trim();
  }
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
  if (code === 'auth/email-already-in-use') {
    return 'An account already exists for this email. Sign in instead.';
  }
  if (code === 'auth/weak-password') {
    return 'Use a stronger password.';
  }
  if (code === 'auth/invalid-action-code' || code === 'auth/expired-action-code') {
    return 'This link is invalid or has expired.';
  }
  if (code === 'auth/requires-recent-login') {
    return 'Sign in again before changing multi-factor authentication.';
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
