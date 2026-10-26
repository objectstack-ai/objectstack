/**
 * ImpersonationBanner — the console's standing "you are acting as someone else"
 * chrome (objectui#4467).
 *
 * ## What raises it
 *
 * `session.impersonatedBy`, and nothing else. That field is set by better-auth's
 * admin plugin for the life of an impersonated session and comes back on every
 * `GET /auth/get-session`, so the banner is a property of the SESSION rather
 * than a memory of the click that started it: it survives a full SPA reboot, a
 * new tab, and a browser restart, and it cannot disagree with who the server
 * thinks is acting. An ordinary session has no such field and renders nothing
 * here — not an empty element, `null`.
 *
 * ## Where it mounts, and why it is not a page-level bar
 *
 * `ConsoleShell` — the one provider stack every console route passes through
 * (home, `/apps/*`, `/organizations`, `/ai`, `/studio`). Its siblings there are
 * the other global surfaces with a single home: `RemediationOverlay`,
 * `NotificationSnackbar`, `NotificationAlerts`. The page-level bars it most
 * resembles visually — `DraftPreviewBar` and `UnpublishedAppBar` — mount inside
 * `ConsoleLayout`, which only wraps `/apps/*`; the card was filed on a console
 * whose `/home` showed no sign of impersonation at all, so a home that could
 * not carry the indicator would have reproduced the bug.
 *
 * ## The exit fails LOUDLY
 *
 * `POST /auth/admin/stop-impersonating` restores the administrator from the
 * `admin_session` COOKIE the impersonation call left behind. A deployment that
 * blocks cookies (a cross-site console, a hardened browser profile) therefore
 * cannot exit this way, and the failure must be visible: a stop that leaves the
 * session impersonated keeps the banner up and states what happened. Silently
 * appearing to succeed would be strictly worse than the original defect —
 * the operator would go back to ordinary work believing they were themselves.
 */

import { UserCog } from 'lucide-react';
import { Button } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useImpersonationExit } from './useImpersonationExit.js';

export function ImpersonationBanner() {
  const { t } = useObjectTranslation();
  // The exit itself — request, token adoption, outcome — is shared with the
  // remediation overlay, which covers this banner when the session is held
  // (objectui#13208). See `useImpersonationExit`.
  const { impersonatedBy, impersonatedName, stop, stopping, stopError, notRestored } =
    useImpersonationExit();

  // Nothing to say on an ordinary session. Below every hook, so the hook order
  // is stable across the transition out of impersonation.
  if (!impersonatedBy) return null;

  return (
    <div
      role="status"
      data-testid="impersonation-banner"
      className="sticky top-0 z-50 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-red-300/70 bg-red-50 px-4 py-2 text-sm text-red-900 dark:border-red-800/60 dark:bg-red-950/50 dark:text-red-100"
    >
      <UserCog className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">
          {t('impersonation.banner.message', {
            defaultValue: 'You are impersonating {{user}} — every action is recorded as them.',
            user: impersonatedName,
          })}
        </span>{' '}
        <span className="opacity-80">
          {t('impersonation.banner.startedBy', {
            defaultValue: 'Started by administrator {{admin}}.',
            admin: impersonatedBy,
          })}
        </span>
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={stop}
        disabled={stopping}
        data-testid="impersonation-stop"
      >
        {stopping
          ? t('impersonation.banner.stopping', { defaultValue: 'Stopping…' })
          : t('impersonation.banner.stop', { defaultValue: 'Stop impersonating' })}
      </Button>
      {stopError ? (
        <p role="alert" data-testid="impersonation-stop-error" className="w-full font-medium">
          {t('impersonation.banner.stopFailed', {
            defaultValue: 'Could not stop impersonating: {{reason}}',
            reason: stopError,
          })}
        </p>
      ) : null}
      {notRestored ? (
        <p role="alert" data-testid="impersonation-not-restored" className="w-full font-medium">
          {t('impersonation.banner.notRestored', {
            defaultValue:
              'The server accepted the request but did not restore your administrator session — you are still impersonating {{user}}. Sign out and sign in again to end it.',
            user: impersonatedName,
          })}
        </p>
      ) : null}
    </div>
  );
}

ImpersonationBanner.displayName = 'ImpersonationBanner';
