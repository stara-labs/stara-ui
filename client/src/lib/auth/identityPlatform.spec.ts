const mockGetApps = jest.fn();
const mockInitializeApp = jest.fn();
const mockGetAuth = jest.fn();
const mockConnectAuthEmulator = jest.fn();
const mockGetMultiFactorResolver = jest.fn();
const mockOnIdTokenChanged = jest.fn();
const mockSignInWithEmailAndPassword = jest.fn();
const mockSignOut = jest.fn();
const mockAssertionForSignIn = jest.fn();
const mockAssertionForEnrollment = jest.fn();
const mockGenerateSecret = jest.fn();
const mockCreateUserWithEmailAndPassword = jest.fn();
const mockUpdateProfile = jest.fn();
const mockSendEmailVerification = jest.fn();
const mockSendPasswordResetEmail = jest.fn();
const mockApplyActionCode = jest.fn();
const mockVerifyPasswordResetCode = jest.fn();
const mockConfirmPasswordReset = jest.fn();
const mockMultiFactor = jest.fn();

jest.mock('firebase/app', () => ({
  FirebaseError: class FirebaseError extends Error {
    code?: string;
  },
  getApps: (...args: unknown[]) => mockGetApps(...args),
  initializeApp: (...args: unknown[]) => mockInitializeApp(...args),
}));

jest.mock('firebase/auth', () => ({
  connectAuthEmulator: (...args: unknown[]) => mockConnectAuthEmulator(...args),
  createUserWithEmailAndPassword: (...args: unknown[]) =>
    mockCreateUserWithEmailAndPassword(...args),
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
  sendEmailVerification: (...args: unknown[]) => mockSendEmailVerification(...args),
  sendPasswordResetEmail: (...args: unknown[]) => mockSendPasswordResetEmail(...args),
  applyActionCode: (...args: unknown[]) => mockApplyActionCode(...args),
  verifyPasswordResetCode: (...args: unknown[]) => mockVerifyPasswordResetCode(...args),
  confirmPasswordReset: (...args: unknown[]) => mockConfirmPasswordReset(...args),
  getAuth: (...args: unknown[]) => mockGetAuth(...args),
  getMultiFactorResolver: (...args: unknown[]) => mockGetMultiFactorResolver(...args),
  onIdTokenChanged: (...args: unknown[]) => mockOnIdTokenChanged(...args),
  signInWithEmailAndPassword: (...args: unknown[]) => mockSignInWithEmailAndPassword(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  multiFactor: (...args: unknown[]) => mockMultiFactor(...args),
  TotpMultiFactorGenerator: {
    FACTOR_ID: 'totp',
    assertionForSignIn: (...args: unknown[]) => mockAssertionForSignIn(...args),
    assertionForEnrollment: (...args: unknown[]) => mockAssertionForEnrollment(...args),
    generateSecret: (...args: unknown[]) => mockGenerateSecret(...args),
  },
}));

import {
  applyIdentityPlatformEmailVerification,
  beginIdentityPlatformTotpEnrollment,
  clearIdentityPlatformSignupInvite,
  completeIdentityPlatformMfa,
  completeIdentityPlatformTotpEnrollment,
  confirmIdentityPlatformPasswordReset,
  getIdentityPlatformAssurance,
  getIdentityPlatformAuth,
  getIdentityPlatformSignupInvite,
  identityPlatformErrorMessage,
  isIdentityPlatformRegistrationInProgress,
  registerIdentityPlatformAccount,
  removeIdentityPlatformTotp,
  resendIdentityPlatformEmailVerification,
  requestIdentityPlatformPasswordReset,
  refreshIdentityPlatformToken,
  signInToIdentityPlatform,
  signOutFromIdentityPlatform,
  subscribeToIdentityPlatform,
} from './identityPlatform';
import type { TIdentityPlatformStartupConfig } from 'librechat-data-provider';

const config: TIdentityPlatformStartupConfig = {
  enabled: true,
  apiKey: 'public-key',
  authDomain: 'stara.example.test',
  projectId: 'stara-test',
  tenantId: 'workforce-tenant',
  appId: 'browser-app',
  emulatorUrl: 'http://127.0.0.1:9099',
};

const auth = {
  tenantId: null as string | null,
  currentUser: null as null | Record<string, unknown>,
};

describe('Identity Platform browser adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetApps.mockReturnValue([]);
    mockInitializeApp.mockReturnValue({ name: 'stara-identity-platform' });
    mockGetAuth.mockReturnValue(auth);
    mockSignInWithEmailAndPassword.mockResolvedValue({ user: {} });
    mockSignOut.mockResolvedValue(undefined);
    mockUpdateProfile.mockResolvedValue(undefined);
    mockSendEmailVerification.mockResolvedValue(undefined);
    mockSendPasswordResetEmail.mockResolvedValue(undefined);
    mockApplyActionCode.mockResolvedValue(undefined);
    mockVerifyPasswordResetCode.mockResolvedValue('owner@example.com');
    mockConfirmPasswordReset.mockResolvedValue(undefined);
    mockMultiFactor.mockReturnValue({
      enrolledFactors: [],
      getSession: jest.fn().mockResolvedValue({ id: 'mfa-session' }),
      enroll: jest.fn().mockResolvedValue(undefined),
      unenroll: jest.fn().mockResolvedValue(undefined),
    });
    window.localStorage.clear();
    auth.currentUser = null;
  });

  it('initializes the named app, tenant, and local emulator', async () => {
    await expect(getIdentityPlatformAuth(config)).resolves.toBe(auth);

    expect(mockInitializeApp).toHaveBeenCalledWith(
      {
        apiKey: 'public-key',
        authDomain: 'stara.example.test',
        projectId: 'stara-test',
        appId: 'browser-app',
      },
      'stara-identity-platform',
    );
    expect(auth.tenantId).toBe('workforce-tenant');
    expect(mockConnectAuthEmulator).toHaveBeenCalledWith(auth, 'http://127.0.0.1:9099', {
      disableWarnings: true,
    });
  });

  it('signs in a migrated password account without creating a LibreChat session', async () => {
    await expect(
      signInToIdentityPlatform(config, 'owner@example.com', 'password'),
    ).resolves.toEqual({ mfaRequired: false });

    expect(mockSignInWithEmailAndPassword).toHaveBeenCalledWith(
      auth,
      'owner@example.com',
      'password',
    );
  });

  it('retains and resolves a TOTP multi-factor challenge', async () => {
    const multiFactorError = Object.assign(new Error('MFA required'), {
      code: 'auth/multi-factor-auth-required',
    });
    const resolver = {
      hints: [{ factorId: 'totp', uid: 'totp-enrollment' }],
      resolveSignIn: jest.fn().mockResolvedValue({ user: {} }),
    };
    mockSignInWithEmailAndPassword.mockRejectedValue(multiFactorError);
    mockGetMultiFactorResolver.mockReturnValue(resolver);
    mockAssertionForSignIn.mockReturnValue({ kind: 'totp-assertion' });

    await expect(
      signInToIdentityPlatform(config, 'owner@example.com', 'password'),
    ).resolves.toEqual({ mfaRequired: true });
    await completeIdentityPlatformMfa('123456');

    expect(mockAssertionForSignIn).toHaveBeenCalledWith('totp-enrollment', '123456');
    expect(resolver.resolveSignIn).toHaveBeenCalledWith({ kind: 'totp-assertion' });
  });

  it('creates a verified-email enrollment and retains the invitation handoff', async () => {
    const user = { uid: 'identity-new', email: 'new@partner.test' };
    mockCreateUserWithEmailAndPassword.mockImplementation(async () => {
      auth.currentUser = user;
      return { user };
    });

    await registerIdentityPlatformAccount(config, {
      email: ' New@Partner.Test ',
      password: 'correct horse battery staple',
      displayName: 'New User',
      inviteToken: 'invite_token_123456789012345678901234',
    });

    expect(mockCreateUserWithEmailAndPassword).toHaveBeenCalledWith(
      auth,
      'new@partner.test',
      'correct horse battery staple',
    );
    expect(mockUpdateProfile).toHaveBeenCalledWith(user, { displayName: 'New User' });
    expect(mockSendEmailVerification).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        handleCodeInApp: false,
        url: expect.stringContaining('/verify?invite_token='),
      }),
    );
    expect(mockSendEmailVerification.mock.calls[0]?.[1]?.url).toContain('email_action=verify');
    expect(mockSignOut).toHaveBeenCalledWith(auth);
    expect(getIdentityPlatformSignupInvite('new@partner.test')).toBe(
      'invite_token_123456789012345678901234',
    );
    clearIdentityPlatformSignupInvite('new@partner.test');
    expect(getIdentityPlatformSignupInvite('new@partner.test')).toBeUndefined();
  });

  it('restores registration state when Firebase initialization fails', async () => {
    mockGetAuth.mockImplementationOnce(() => {
      throw new Error('Firebase unavailable');
    });

    await expect(
      registerIdentityPlatformAccount(config, {
        email: 'new@example.com',
        password: 'correct horse battery staple',
        displayName: 'New User',
      }),
    ).rejects.toThrow('Firebase unavailable');

    expect(isIdentityPlatformRegistrationInProgress()).toBe(false);
  });

  it('resends verification for an authenticated unverified account', async () => {
    const user = { uid: 'identity-new', email: 'new@example.com', emailVerified: false };
    auth.currentUser = user;

    await resendIdentityPlatformEmailVerification(config);

    expect(mockSendEmailVerification).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        handleCodeInApp: false,
        url: expect.stringContaining('email_action=verify'),
      }),
    );
  });

  it('handles verification and password recovery action codes in Firebase', async () => {
    await applyIdentityPlatformEmailVerification(config, 'verify-code');
    await requestIdentityPlatformPasswordReset(config, ' Owner@Example.com ');
    await confirmIdentityPlatformPasswordReset(config, 'reset-code', 'new-password');

    expect(mockApplyActionCode).toHaveBeenCalledWith(auth, 'verify-code');
    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith(
      auth,
      'owner@example.com',
      expect.objectContaining({ handleCodeInApp: false }),
    );
    expect(mockVerifyPasswordResetCode).toHaveBeenCalledWith(auth, 'reset-code');
    expect(mockConfirmPasswordReset).toHaveBeenCalledWith(auth, 'reset-code', 'new-password');
  });

  it('reports assurance and completes mandatory TOTP enrollment', async () => {
    const user = {
      uid: 'identity-new',
      email: 'new@example.com',
      emailVerified: true,
      getIdTokenResult: jest.fn().mockResolvedValue({
        claims: { firebase: { sign_in_second_factor: 'totp' } },
      }),
    };
    const factors = {
      enrolledFactors: [{ factorId: 'totp', uid: 'totp-enrollment' }],
      getSession: jest.fn().mockResolvedValue({ id: 'mfa-session' }),
      enroll: jest.fn().mockResolvedValue(undefined),
      unenroll: jest.fn().mockResolvedValue(undefined),
    };
    mockMultiFactor.mockReturnValue(factors);

    await expect(getIdentityPlatformAssurance(user as never, config)).resolves.toEqual({
      emailVerified: true,
      totpEnrolled: true,
      mfaSatisfied: true,
    });

    factors.enrolledFactors = [];
    auth.currentUser = user;
    const secret = {
      secretKey: 'SECRETKEY',
      generateQrCodeUrl: jest.fn().mockReturnValue('otpauth://totp/Stara'),
    };
    mockGenerateSecret.mockResolvedValue(secret);
    mockAssertionForEnrollment.mockReturnValue({ kind: 'enrollment-assertion' });

    await expect(beginIdentityPlatformTotpEnrollment(config)).resolves.toEqual({
      secretKey: 'SECRETKEY',
      qrCodeUrl: 'otpauth://totp/Stara',
    });
    await completeIdentityPlatformTotpEnrollment(config, '123456');

    expect(mockAssertionForEnrollment).toHaveBeenCalledWith(secret, '123456');
    expect(factors.enroll).toHaveBeenCalledWith(
      { kind: 'enrollment-assertion' },
      'Authenticator app',
    );
    expect(mockSignOut).toHaveBeenCalledWith(auth);
  });

  it('accepts seeded MFA assurance only for the explicitly configured Auth emulator', async () => {
    const user = {
      uid: 'identity-local',
      email: 'local@example.com',
      emailVerified: true,
      getIdTokenResult: jest.fn().mockResolvedValue({
        claims: { stara_mfa_enrolled: true, firebase: {} },
      }),
    };
    mockMultiFactor.mockReturnValue({ enrolledFactors: [] });

    await expect(getIdentityPlatformAssurance(user as never, config)).resolves.toEqual({
      emailVerified: true,
      totpEnrolled: true,
      mfaSatisfied: true,
    });
    await expect(
      getIdentityPlatformAssurance(user as never, { ...config, emulatorUrl: undefined }),
    ).resolves.toEqual({
      emailVerified: true,
      totpEnrolled: false,
      mfaSatisfied: false,
    });
  });

  it('removes the Firebase TOTP factor and signs out', async () => {
    const enrolled = { factorId: 'totp', uid: 'totp-enrollment' };
    const factors = {
      enrolledFactors: [enrolled],
      unenroll: jest.fn().mockResolvedValue(undefined),
    };
    auth.currentUser = { uid: 'identity-user' };
    mockMultiFactor.mockReturnValue(factors);

    await removeIdentityPlatformTotp(config);

    expect(factors.unenroll).toHaveBeenCalledWith(enrolled);
    expect(mockSignOut).toHaveBeenCalledWith(auth);
  });

  it('refreshes and signs out through the Firebase session', async () => {
    const getIdToken = jest.fn().mockResolvedValue('fresh-token');
    auth.currentUser = { getIdToken };

    await expect(refreshIdentityPlatformToken(config)).resolves.toBe('fresh-token');
    await signOutFromIdentityPlatform(config);

    expect(getIdToken).toHaveBeenCalledWith(true);
    expect(mockSignOut).toHaveBeenCalledWith(auth);
  });

  it('subscribes to Firebase ID-token changes and returns generic credential errors', async () => {
    const onUser = jest.fn();
    const onError = jest.fn();
    subscribeToIdentityPlatform(config, onUser, onError);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockOnIdTokenChanged).toHaveBeenCalledWith(auth, onUser, onError);
    expect(identityPlatformErrorMessage({ code: 'auth/invalid-credential' })).toBe(
      'Invalid email or password.',
    );
  });
});
