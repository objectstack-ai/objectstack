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
 * ## The administrator is named by a person's name, never by an id
 *
 * The session carries the administrator only as `impersonatedBy`, a `sys_user`
 * id, which tells neither the administrator nor anyone watching the screen who
 * started this. The banner therefore reads that one `sys_user` row and names it
 * by its name, else its email. The read is made AS the impersonated user (that
 * is the session the console holds), and their row scope may not reach the
 * administrator's row: a refused, missing or failed read says "an
 * administrator" instead. ⛔ The raw id is never shown, and nothing is shown for
 * the administrator until the read has answered, so the sentence never flips
 * from an id or a guess to the name.
 *
 * The read is a raw authenticated `GET` on the `/api/v1` lane, the lane the
 * exit uses: this banner mounts in `ConsoleShell`, above `AdapterProvider`, so
 * the data adapter does not exist here. It lives in the banner rather than in
 * `useImpersonationExit` because the remediation overlay shares that hook and
 * names nobody, so it must not issue the read.
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
 *
 * ## Starting one lands on home
 *
 * An administrator starts an impersonation from a Setup page, and the user they
 * become usually cannot open Setup: left where it was, the console would answer
 * the page the administrator was on with "no access to this app". So the moment
 * a session this console already held as an ordinary one becomes impersonated,
 * the banner navigates to `/`, where the console resolves the landing for the
 * identity it now holds. Only that transition moves the page: a console that
 * boots into an impersonated session (a reload, a new tab, a deep link) stays on
 * the URL it was opened at, and ending an impersonation moves nothing.
 *
 * The navigate is the host's (`useHostNavigation`), which the console supplies
 * from its router so the deployment's basename applies. A tree with no host
 * navigate, such as a test that mounts the banner alone, does not move.
 */

import { useEffect, useRef, useState } from 'react';
import { UserCog } from 'lucide-react';
import { Button } from '@object-ui/components';
import { createAuthenticatedFetch, useAuth } from '@object-ui/auth';
import { useHostNavigation } from '@object-ui/react';
import { GetDataResponseSchema } from '@objectstack/spec/api';
import { useObjectTranslation } from '@object-ui/i18n';
import { PERSON_DISPLAY_FIELDS, rowLabel } from '../utils/approverIdentity.js';
import { useImpersonationExit } from './useImpersonationExit.js';

/**
 * How the banner names the administrator: `{ name }` once the `sys_user` read
 * answered with a name or email, `null` once it answered without one (refused,
 * missing, failed), `undefined` while it is still being asked.
 */
type AdministratorName = { name: string } | null | undefined;

/**
 * Read the administrator's `sys_user` row once per administrator id. See the
 * module header for why the read is made here and how a refusal reads.
 */
function useAdministratorName(adminId: string | undefined): AdministratorName {
  // The answer is kept with the id it answers for, so a later impersonation by
  // another administrator never shows the previous one's name.
  const [answer, setAnswer] = useState<{ id: string; name: { name: string } | null } | null>(null);

  useEffect(() => {
    if (!adminId) return;
    let cancelled = false;
    void (async () => {
      let name: string | null = null;
      try {
        const baseUrl = import.meta.env.VITE_SERVER_URL || '';
        const res = await createAuthenticatedFetch()(
          `${baseUrl}/api/v1/data/sys_user/${encodeURIComponent(adminId)}`,
          { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'include' },
        );
        if (res.ok) {
          // The data route answers the spec's `GetDataResponse` body; anything
          // else names nobody.
          const body = GetDataResponseSchema.safeParse(await res.json());
          if (body.success) name = rowLabel(body.data.record, PERSON_DISPLAY_FIELDS) || null;
        }
      } catch {
        // A failed read names nobody; the banner says "an administrator".
      }
      if (!cancelled) setAnswer({ id: adminId, name: name ? { name } : null });
    })();
    return () => {
      cancelled = true;
    };
  }, [adminId]);

  if (!adminId || answer === null || answer.id !== adminId) return undefined;
  return answer.name;
}

/** What the last render saw: whether a session was resolved, and whom it impersonated. */
interface ObservedSession {
  resolved: boolean;
  impersonatedBy: string | undefined;
}

/**
 * Navigate home when an ordinary session this console held becomes
 * impersonated. See the module header for which transitions move the page.
 */
function useLandOnImpersonationStart(impersonatedBy: string | undefined): void {
  const { session } = useAuth();
  const { navigate } = useHostNavigation();
  const resolved = session != null;
  const previous = useRef<ObservedSession | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = { resolved, impersonatedBy };
    if (!navigate || !impersonatedBy) return;
    if (before?.resolved && !before.impersonatedBy) navigate('/');
  }, [resolved, impersonatedBy, navigate]);
}

export function ImpersonationBanner() {
  const { t } = useObjectTranslation();
  // The exit itself — request, token adoption, outcome — is shared with the
  // remediation overlay, which covers this banner when the session is held
  // (objectui#13208). See `useImpersonationExit`.
  const { impersonatedBy, impersonatedName, stop, stopping, stopError, notRestored } =
    useImpersonationExit();
  const administrator = useAdministratorName(impersonatedBy);
  useLandOnImpersonationStart(impersonatedBy);

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
        {administrator === undefined ? null : (
          <span className="opacity-80" data-testid="impersonation-started-by">
            {administrator
              ? t('impersonation.banner.startedBy', {
                  defaultValue: 'Started by administrator {{admin}}.',
                  admin: administrator.name,
                })
              : t('impersonation.banner.startedByUnnamed', {
                  defaultValue: 'Started by an administrator.',
                })}
          </span>
        )}
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
