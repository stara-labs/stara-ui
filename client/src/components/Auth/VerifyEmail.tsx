import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Spinner, ThemeSelector } from '@librechat/client';
import { useSearchParams, useNavigate } from 'react-router-dom';
import type { TIdentityPlatformStartupConfig } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import {
  applyIdentityPlatformEmailVerification,
  identityPlatformErrorMessage,
  rememberIdentityPlatformSignupInvite,
} from '~/lib/auth/identityPlatform';
import {
  useGetStartupConfig,
  useResendVerificationEmail,
  useVerifyEmailMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

const inviteTokenFrom = (params: URLSearchParams): string | undefined => {
  const direct = params.get('invite_token');
  if (direct) {
    return direct;
  }
  const continueUrl = params.get('continueUrl');
  if (!continueUrl) {
    return undefined;
  }
  try {
    return new URL(continueUrl).searchParams.get('invite_token') ?? undefined;
  } catch {
    return undefined;
  }
};

const VerificationShell = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-screen flex-col items-center justify-center bg-surface-primary px-6">
    <div className="absolute bottom-0 left-0 m-4">
      <ThemeSelector />
    </div>
    {children}
  </div>
);

function IdentityPlatformVerifyEmail({
  config,
  params,
}: {
  config: TIdentityPlatformStartupConfig;
  params: URLSearchParams;
}) {
  const navigate = useNavigate();
  const attemptedRef = useRef(false);
  const [status, setStatus] = useState<'working' | 'success' | 'error'>('working');
  const [message, setMessage] = useState('Verifying your email...');

  useEffect(() => {
    if (attemptedRef.current) {
      return;
    }
    attemptedRef.current = true;
    const actionCode = params.get('oobCode');
    const inviteToken = inviteTokenFrom(params);
    if (!actionCode) {
      if (params.get('email_action') === 'verify') {
        if (inviteToken) {
          rememberIdentityPlatformSignupInvite(undefined, inviteToken);
        }
        setStatus('success');
        setMessage('Continue to sign in to complete multi-factor authentication.');
        return;
      }
      setStatus('error');
      setMessage('This verification link is invalid or incomplete.');
      return;
    }

    void applyIdentityPlatformEmailVerification(config, actionCode)
      .then(() => {
        if (inviteToken) {
          rememberIdentityPlatformSignupInvite(params.get('email') ?? undefined, inviteToken);
        }
        setStatus('success');
        setMessage('Email verified. Sign in to set up multi-factor authentication.');
      })
      .catch((error: unknown) => {
        setStatus('error');
        setMessage(identityPlatformErrorMessage(error));
      });
  }, [config, params]);

  return (
    <VerificationShell>
      {status === 'working' ? (
        <Spinner className="size-8 text-green-500" />
      ) : (
        <div className="flex max-w-md flex-col items-center gap-5 text-center">
          <h1 className="text-2xl font-semibold text-text-primary">{message}</h1>
          <button
            type="button"
            onClick={() => navigate('/login', { replace: true })}
            className="font-medium text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
          >
            {status === 'success' ? 'Continue to sign in' : 'Back to sign in'}
          </button>
        </div>
      )}
    </VerificationShell>
  );
}

function IdentityPlatformPasswordResetRedirect({ params }: { params: URLSearchParams }) {
  const navigate = useNavigate();

  useEffect(() => {
    const search = params.toString();
    navigate(`/reset-password${search ? `?${search}` : ''}`, { replace: true });
  }, [navigate, params]);

  return (
    <VerificationShell>
      <Spinner className="size-8 text-green-500" />
    </VerificationShell>
  );
}

function UnsupportedIdentityPlatformEmailAction() {
  const navigate = useNavigate();
  const localize = useLocalize();

  return (
    <VerificationShell>
      <div className="flex max-w-md flex-col items-center gap-5 text-center">
        <h1 className="text-2xl font-semibold text-text-primary">
          {localize('com_auth_email_verification_invalid')}
        </h1>
        <button
          type="button"
          onClick={() => navigate('/login', { replace: true })}
          className="font-medium text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
        >
          {localize('com_auth_back_to_login')}
        </button>
      </div>
    </VerificationShell>
  );
}

function LegacyVerifyEmail() {
  const navigate = useNavigate();
  const localize = useLocalize();
  const [params] = useSearchParams();

  const [countdown, setCountdown] = useState<number>(3);
  const [headerText, setHeaderText] = useState<string>('');
  const [showResendLink, setShowResendLink] = useState<boolean>(false);
  const [verificationStatus, setVerificationStatus] = useState<boolean>(false);
  const token = useMemo(() => params.get('token') || '', [params]);
  const email = useMemo(() => params.get('email') || '', [params]);

  const countdownRedirect = useCallback(() => {
    setCountdown(3);
    const timer = setInterval(() => {
      setCountdown((prevCountdown) => {
        if (prevCountdown <= 1) {
          clearInterval(timer);
          navigate('/c/new', { replace: true });
          return 0;
        }
        return prevCountdown - 1;
      });
    }, 1000);
  }, [navigate]);

  const verifyEmailMutation = useVerifyEmailMutation({
    onSuccess: () => {
      setHeaderText(localize('com_auth_email_verification_success') + ' 🎉');
      setVerificationStatus(true);
      countdownRedirect();
    },
    onError: (_error: unknown) => {
      setHeaderText(localize('com_auth_email_verification_failed') + ' 😢');
      setShowResendLink(true);
      setVerificationStatus(true);
    },
  });

  const resendEmailMutation = useResendVerificationEmail({
    onSuccess: () => {
      setHeaderText(localize('com_auth_email_resent_success') + ' 📧');
      countdownRedirect();
    },
    onError: () => {
      setHeaderText(localize('com_auth_email_resent_failed') + ' 😢');
    },
    onMutate: () => setShowResendLink(false),
  });

  const handleResendEmail = () => {
    resendEmailMutation.mutate({ email });
  };

  useEffect(() => {
    if (verificationStatus || verifyEmailMutation.isLoading) {
      return;
    }

    if (token && email) {
      verifyEmailMutation.mutate({ email, token });
    } else {
      if (email) {
        setHeaderText(localize('com_auth_email_verification_failed_token_missing') + ' 😢');
      } else {
        setHeaderText(localize('com_auth_email_verification_invalid') + ' 🤨');
      }
      setShowResendLink(true);
      setVerificationStatus(true);
    }
  }, [token, email, verificationStatus, verifyEmailMutation, localize]);

  const VerificationSuccess = () => (
    <div className="flex flex-col items-center justify-center">
      <h1 className="mb-4 text-center text-3xl font-semibold text-black dark:text-white">
        {headerText}
      </h1>
      {countdown > 0 && (
        <p className="text-center text-lg text-gray-600 dark:text-gray-400">
          {localize('com_auth_email_verification_redirecting', { 0: countdown.toString() })}
        </p>
      )}
      {showResendLink && countdown === 0 && (
        <p className="text-center text-lg text-gray-600 dark:text-gray-400">
          {localize('com_auth_email_verification_resend_prompt')}
          <button
            className="ml-2 text-blue-600 hover:underline"
            onClick={handleResendEmail}
            disabled={resendEmailMutation.isLoading}
          >
            {localize('com_auth_email_resend_link')}
          </button>
        </p>
      )}
    </div>
  );

  const VerificationInProgress = () => (
    <div className="flex flex-col items-center justify-center">
      <h1 className="mb-4 text-center text-3xl font-semibold text-black dark:text-white">
        {localize('com_auth_email_verification_in_progress')}
      </h1>
      <div className="mt-4 flex justify-center">
        <Spinner className="h-8 w-8 text-green-500" />
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white pt-6 dark:bg-gray-900 sm:pt-0">
      <div className="absolute bottom-0 left-0 m-4">
        <ThemeSelector />
      </div>
      {verificationStatus ? <VerificationSuccess /> : <VerificationInProgress />}
    </div>
  );
}

function VerifyEmail() {
  const [params] = useSearchParams();
  const startupConfig = useGetStartupConfig();
  if (!startupConfig.isFetched) {
    return (
      <VerificationShell>
        <Spinner className="size-8 text-green-500" />
      </VerificationShell>
    );
  }
  if (startupConfig.data?.identityPlatform) {
    const mode = params.get('mode');
    if (mode === 'resetPassword') {
      return <IdentityPlatformPasswordResetRedirect params={params} />;
    }
    if (mode && mode !== 'verifyEmail') {
      return <UnsupportedIdentityPlatformEmailAction />;
    }
    return (
      <IdentityPlatformVerifyEmail config={startupConfig.data.identityPlatform} params={params} />
    );
  }
  return <LegacyVerifyEmail />;
}

export default VerifyEmail;
