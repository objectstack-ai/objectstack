/**
 * useImpersonationExit — the console's one way out of an impersonation session.
 *
 * Two surfaces offer it: `ImpersonationBanner`, the standing chrome
 * (objectui#4467), and `RemediationOverlay`, which covers that chrome when the
 * server holds the session on a credential posture (objectui#13208). An
 * administrator impersonating a held user must still be able to leave, and
 * both buttons have to leave the same way, so the request, the token adoption
 * and the outcome live here once. Internal to this package: not on its entry.
 *
 * ## The exit
 *
 * `POST /auth/admin/stop-impersonating` restores the administrator from the
 * `admin_session` COOKIE the impersonation call left behind. The server does
 * not hold that route on the password or MFA posture, which is why the overlay
 * can offer it. It goes over the DATA lane (`createAuthenticatedFetch`), which
 * adopts the restored administrator token the server hands back in
 * `set-auth-token` (#4467's lane fix); a bare `fetch` would leave the browser
 * holding the impersonated token.
 *
 * ## The outcome is read from the SESSION, and only for the session it was tried on
 *
 * A stop that resolved does not prove the administrator is back: a deployment
 * that blocks cookies answers 200 and restores nobody. So the outcome is read
 * from the re-resolved session, never from the response alone, and a failure
 * is said out loud (`stopError`, `notRestored`) rather than appearing to work.
 *
 * A finished attempt answers only for the session token it was made from. The
 * surfaces stay mounted across identities (the console does not reload when an
 * administrator impersonates someone), so an attempt that is not tied to its
 * session would report a LATER impersonation, which nobody has tried to stop,
 * as a stop that failed.
 */

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useAuth, createAuthenticatedFetch } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';

export interface ImpersonationExit {
  /** The administrator the session names, or `undefined` on an ordinary session. */
  impersonatedBy: string | undefined;
  /** The impersonated user as the console names them: name, else email, else id. */
  impersonatedName: string;
  /** Ask the server to end the impersonation and re-resolve who the console is. */
  stop: () => Promise<void>;
  /** A stop is in flight. */
  stopping: boolean;
  /** The reason the last stop on THIS session failed, or `null`. */
  stopError: string | null;
  /** A stop on this session resolved, and the session is still impersonated. */
  notRestored: boolean;
  /** A stop resolved, and the session is no longer impersonated. */
  restored: boolean;
}

/** One finished attempt: the session token it was made from, and how it ended. */
interface StopAttempt {
  from: string | null;
  error: string | null;
}

export function useImpersonationExit(): ImpersonationExit {
  const { user, session, refreshSession } = useAuth();
  const { t } = useObjectTranslation();
  const [stopping, setStopping] = useState(false);
  const [attempt, setAttempt] = useState<StopAttempt | null>(null);

  const impersonatedBy = session?.impersonatedBy;
  const sessionToken = session?.token ?? null;

  const stop = useCallback(async () => {
    const from = sessionToken;
    let error: string | null = null;
    setStopping(true);
    setAttempt(null);
    try {
      const baseUrl = import.meta.env.VITE_SERVER_URL || '';
      const res = await createAuthenticatedFetch()(`${baseUrl}/api/v1/auth/admin/stop-impersonating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The administrator is resolved from the `admin_session` cookie, not
        // from the bearer we are sending — which is the impersonated user's.
        credentials: 'include',
        body: '{}',
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { message?: string; error?: { message?: string } }
          | null;
        throw new Error(payload?.error?.message ?? payload?.message ?? `HTTP ${res.status}`);
      }
      // Adopt the restored identity: the rotated administrator token is already
      // in TokenStorage (captured by the authenticated fetch above), so this
      // re-resolves as the administrator. Awaited, so the outcome below reads a
      // settled session.
      await refreshSession();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      toast.error(
        t('impersonation.banner.stopFailed', {
          defaultValue: 'Could not stop impersonating: {{reason}}',
          reason: error,
        }),
      );
    } finally {
      setAttempt({ from, error });
      setStopping(false);
    }
  }, [sessionToken, refreshSession, t]);

  const finished = stopping ? null : attempt;
  // An attempt made from another session says nothing about this one.
  const onThisSession = finished !== null && finished.from === sessionToken ? finished : null;

  return {
    impersonatedBy,
    impersonatedName: user?.name || user?.email || user?.id || '',
    stop,
    stopping,
    stopError: onThisSession?.error ?? null,
    // Resolved and still impersonating the same session: the cookie-blocked
    // deployment — the request looked accepted, the administrator never came back.
    notRestored: onThisSession !== null && onThisSession.error === null && Boolean(impersonatedBy),
    restored: finished !== null && finished.error === null && !impersonatedBy,
  };
}
