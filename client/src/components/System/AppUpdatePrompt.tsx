import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useLocalize } from '~/hooks';

const UPDATE_READY_EVENT = 'lc-sw-update-ready';
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

declare global {
  interface Window {
    __lcUpdateAvailable?: boolean;
  }
}

export const checkForAppUpdate = async (serviceWorker?: ServiceWorkerContainer) => {
  if (!serviceWorker) {
    return;
  }
  const registration = await serviceWorker.getRegistration();
  await registration?.update();
};

type AppUpdatePromptProps = {
  reload?: () => void;
};

export default function AppUpdatePrompt({
  reload = () => window.location.reload(),
}: AppUpdatePromptProps) {
  const localize = useLocalize();
  const [updateReady, setUpdateReady] = useState(() => window.__lcUpdateAvailable === true);

  useEffect(() => {
    const serviceWorker = navigator.serviceWorker;
    if (!serviceWorker) {
      return;
    }

    const showUpdate = () => setUpdateReady(true);
    const checkForUpdate = () => {
      if (document.visibilityState !== 'hidden') {
        void checkForAppUpdate(serviceWorker).catch(() => undefined);
      }
    };

    window.addEventListener(UPDATE_READY_EVENT, showUpdate);
    window.addEventListener('focus', checkForUpdate);
    document.addEventListener('visibilitychange', checkForUpdate);
    const interval = window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
    checkForUpdate();

    return () => {
      window.removeEventListener(UPDATE_READY_EVENT, showUpdate);
      window.removeEventListener('focus', checkForUpdate);
      document.removeEventListener('visibilitychange', checkForUpdate);
      window.clearInterval(interval);
    };
  }, []);

  if (!updateReady) {
    return null;
  }

  return (
    <aside
      role="status"
      aria-live="polite"
      className="pointer-events-auto fixed bottom-4 left-1/2 z-[1100] flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 flex-col gap-3 rounded-lg border border-border-medium bg-surface-primary px-4 py-3 text-text-primary shadow-lg sm:flex-row sm:items-center"
    >
      <RefreshCw className="hidden h-5 w-5 shrink-0 text-text-secondary sm:block" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{localize('com_ui_stara_update_ready')}</p>
        <p className="text-sm text-text-secondary">{localize('com_ui_stara_update_description')}</p>
      </div>
      <button
        type="button"
        onClick={reload}
        className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-text-primary px-3 text-sm font-medium text-surface-primary transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
      >
        <RefreshCw className="h-4 w-4" aria-hidden />
        {localize('com_ui_stara_update_refresh')}
      </button>
    </aside>
  );
}
