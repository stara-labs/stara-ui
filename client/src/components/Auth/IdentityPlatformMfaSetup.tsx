import { useEffect, useRef, useState } from 'react';
import { Spinner } from '@librechat/client';
import { useNavigate, useOutletContext } from 'react-router-dom';
import type { TLoginLayoutContext } from '~/common';
import {
  beginIdentityPlatformTotpEnrollment,
  completeIdentityPlatformTotpEnrollment,
  identityPlatformErrorMessage,
} from '~/lib/auth/identityPlatform';
import { QRPhase, VerifyPhase } from '~/components/Nav/SettingsTabs/Account/TwoFactorPhases';
import { ErrorMessage } from './ErrorMessage';
import { useLocalize } from '~/hooks';

type Enrollment = { secretKey: string; qrCodeUrl: string };

function IdentityPlatformMfaSetup() {
  const navigate = useNavigate();
  const localize = useLocalize();
  const attemptedRef = useRef(false);
  const { startupConfig } = useOutletContext<TLoginLayoutContext>();
  const config = startupConfig?.identityPlatform;
  const [enrollment, setEnrollment] = useState<Enrollment>();
  const [phase, setPhase] = useState<'qr' | 'verify'>('qr');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    if (!config) {
      navigate('/login', { replace: true });
      return;
    }
    if (attemptedRef.current) {
      return;
    }
    attemptedRef.current = true;
    void beginIdentityPlatformTotpEnrollment(config)
      .then(setEnrollment)
      .catch((enrollmentError: unknown) => setError(identityPlatformErrorMessage(enrollmentError)));
  }, [config, navigate]);

  const verify = async () => {
    if (!config || code.length !== 6) {
      return;
    }
    setIsVerifying(true);
    setError(undefined);
    try {
      await completeIdentityPlatformTotpEnrollment(config, code);
      navigate('/login', { replace: true });
    } catch (verificationError) {
      setError(identityPlatformErrorMessage(verificationError));
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">{localize('com_ui_2fa_setup')}</h1>
        <p className="mt-2 text-sm text-text-secondary">
          {localize('com_ui_2fa_verification_required')}
        </p>
      </div>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {!enrollment && !error && (
        <div className="flex min-h-40 items-center justify-center">
          <Spinner className="size-7" />
        </div>
      )}
      {enrollment && phase === 'qr' && (
        <QRPhase
          secret={enrollment.secretKey}
          otpauthUrl={enrollment.qrCodeUrl}
          onNext={() => setPhase('verify')}
        />
      )}
      {enrollment && phase === 'verify' && (
        <VerifyPhase
          token={code}
          onTokenChange={setCode}
          isVerifying={isVerifying}
          onNext={() => void verify()}
          onError={(phaseError) => setError(phaseError.message)}
        />
      )}
      {error && !enrollment && (
        <button
          type="button"
          className="w-full text-sm font-medium text-green-600 hover:text-green-700 dark:text-green-400"
          onClick={() => navigate('/login', { replace: true })}
        >
          {localize('com_auth_back_to_login')}
        </button>
      )}
    </div>
  );
}

export default IdentityPlatformMfaSetup;
