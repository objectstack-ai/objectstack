// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * RecoveryPasswordReminder
 *
 * Dismissible nudge on the environment home to set a local recovery password —
 * shown when the user signed in via SSO and has no local credential yet. We no
 * longer force this before the first session (it walled off the magic moment);
 * this gentle, one-time reminder preserves instance self-sufficiency without the
 * friction.
 *
 * @module
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@object-ui/auth';
import { Button } from '@object-ui/components';
import { ShieldAlert, X } from 'lucide-react';
import {
  RECOVERY_REMINDER_DISMISSED_KEY,
  deviceStorage,
  isDismissed,
  isPastFirstSession,
} from './recoveryReminderGate.js';

export function RecoveryPasswordReminder({ t }: { t: (key: string, opts?: any) => string }) {
  const navigate = useNavigate();
  const { hasLocalPassword, getAuthConfig } = useAuth();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const storage = deviceStorage();
    if (isDismissed(storage)) return;
    // Not in the user's first session: let a brand-new SSO user reach their
    // magic moment (build their first app) before asking them to set a
    // recovery password. See `isPastFirstSession` for why "first session" is
    // measured in elapsed time.
    if (!isPastFirstSession(storage, Date.now())) return;
    let cancelled = false;
    Promise.all([
      Promise.resolve(hasLocalPassword?.()),
      Promise.resolve(getAuthConfig?.()).catch(() => null),
    ])
      .then(([has, config]: [unknown, any]) => {
        if (cancelled) return;
        // Skip on SSO-enforced envs: password login is disabled there, so a
        // recovery password can't be used — nudging for one is misleading and
        // gives a false sense of security. Same signal LoginForm uses.
        const passwordUnavailable =
          config?.features?.ssoEnforced === true || config?.emailPassword?.enabled === false;
        // objectui#13330 — and never on a cloud-managed environment: there the
        // server admits `set-initial-password` only from a caller with
        // platform-admin standing (the objectstack-ai/objectstack#25083 ruling,
        // Q4 A), so the reminder would send everyone else to a page that
        // refuses them.
        const managed = config?.features?.cloudManaged === true;
        if (has === false && !passwordUnavailable && !managed) setShow(true);
      })
      .catch(() => { /* unknown → don't nag */ });
    return () => { cancelled = true; };
  }, [hasLocalPassword, getAuthConfig]);
  const dismiss = () => {
    try { localStorage.setItem(RECOVERY_REMINDER_DISMISSED_KEY, '1'); } catch { /* ignore */ }
    setShow(false);
  };
  if (!show) return null;
  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-4">
      <div className="max-w-7xl mx-auto">
        <div
          className="flex items-center gap-3 rounded-xl border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/30 px-4 py-3"
          data-testid="recovery-pw-reminder"
        >
          <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="flex-1 min-w-0 text-sm text-amber-900 dark:text-amber-200">
            {t('home.recoveryReminder.message', { defaultValue: 'Set a recovery password so you can still sign in if single sign-on is ever unavailable.' })}
          </p>
          <Button size="sm" variant="outline" onClick={() => navigate('/set-password')} data-testid="recovery-pw-set">
            {t('home.recoveryReminder.cta', { defaultValue: 'Set password' })}
          </Button>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t('home.recoveryReminder.dismiss', { defaultValue: 'Dismiss' })}
            className="shrink-0 rounded-md p-1 text-amber-700/70 hover:text-amber-900 dark:text-amber-300/70 dark:hover:text-amber-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
