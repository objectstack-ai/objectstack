/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@object-ui/auth';
import { Button, Input, Label } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { toCanvas } from 'qrcode';
import { useImpersonationExit, type ImpersonationExit } from '../layout/useImpersonationExit.js';

/**
 * ADR-0069 — full-screen remediation overlay.
 *
 * When the backend blocks a logged-in user with `403 PASSWORD_EXPIRED` /
 * `PASSWORD_RESET_REQUIRED` / `MFA_REQUIRED`, the API fetch interceptor raises
 * `remediationRequired` on the auth context. This overlay guides the user
 * through the fix (change the password — expired, or reset by an
 * administrator — or enrol an authenticator) instead of leaving them staring
 * at failing requests. On success it reloads so the app re-fetches cleanly.
 *
 * ## On an impersonation session (objectui#13208)
 *
 * The overlay covers the whole console, the impersonation banner included, so
 * an administrator impersonating a held user would otherwise be left with the
 * held user's own credential forms and "Sign out instead". The posture is the
 * impersonated user's to clear, not the administrator's: when the session
 * carries `impersonatedBy` the overlay offers neither form. It says the user
 * has to do it themselves and offers "Stop impersonating", the banner's own
 * exit (`useImpersonationExit`, shared, not copied). The overlay still appears
 * for whatever posture the server reports; what it offers is what changes.
 * Once the stop has restored the administrator, it clears the gate and
 * reloads, the way its other two successes do. A stop that fails, or that
 * restores nobody, keeps the overlay up and says so.
 */
export function RemediationOverlay() {
  const { remediationRequired, setRemediationRequired } = useAuth();
  const exit = useImpersonationExit();
  const { restored } = exit;

  // Back as the administrator: the gate was raised against the impersonated
  // user's session, so it is not the administrator's to clear.
  useEffect(() => {
    if (!restored) return;
    setRemediationRequired(null);
    window.location.reload();
  }, [restored, setRemediationRequired]);

  if (!remediationRequired) return null;
  const passwordPosture =
    remediationRequired.code === 'PASSWORD_EXPIRED' ||
    remediationRequired.code === 'PASSWORD_RESET_REQUIRED';
  // Held on `stopping` and `restored` too: the re-resolved session drops
  // `impersonatedBy` before the reload, and in that moment the administrator
  // must not be shown the impersonated user's forms as if they were their own.
  const impersonating = Boolean(exit.impersonatedBy) || exit.stopping || restored;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xl">
        {impersonating ? (
          <ImpersonationExitPanel exit={exit} passwordPosture={passwordPosture} />
        ) : passwordPosture ? (
          <ChangePasswordForm
            forcedReset={remediationRequired.code === 'PASSWORD_RESET_REQUIRED'}
            message={remediationRequired.message}
          />
        ) : (
          <MfaEnrollForm message={remediationRequired.message} />
        )}
      </div>
    </div>
  );
}

/**
 * The impersonation-session face of the overlay: who is held and why, that
 * only they can clear it, and the way back to the administrator's own session.
 * The server's `message` is not shown: it is written to the held user.
 */
function ImpersonationExitPanel({
  exit,
  passwordPosture,
}: {
  exit: ImpersonationExit;
  passwordPosture: boolean;
}) {
  const { t } = useObjectTranslation();
  const user = exit.impersonatedName;
  const busy = exit.stopping || exit.restored;
  return (
    <div className="space-y-4" data-testid="remediation-impersonation-exit">
      <div>
        <h2 className="text-lg font-semibold">
          {passwordPosture
            ? t('auth.remediation.impersonation.passwordTitle', { user })
            : t('auth.remediation.impersonation.mfaTitle', { user })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('auth.remediation.impersonation.body', { user })}
        </p>
      </div>
      {exit.stopError ? (
        <p role="alert" data-testid="remediation-impersonation-stop-error" className="text-sm text-destructive">
          {t('impersonation.banner.stopFailed', { reason: exit.stopError })}
        </p>
      ) : null}
      {exit.notRestored ? (
        <p role="alert" data-testid="remediation-impersonation-not-restored" className="text-sm text-destructive">
          {t('impersonation.banner.notRestored', { user })}
        </p>
      ) : null}
      <Button
        type="button"
        className="w-full"
        onClick={() => { void exit.stop(); }}
        disabled={busy}
        data-testid="remediation-impersonation-stop"
      >
        {busy ? t('impersonation.banner.stopping') : t('impersonation.banner.stop')}
      </Button>
      <SignOutLink />
    </div>
  );
}

function SignOutLink() {
  const { signOut } = useAuth();
  const { t } = useObjectTranslation();
  return (
    <button
      type="button"
      onClick={() => { void signOut(); }}
      className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground hover:underline"
    >
      {t('auth.remediation.signOut')}
    </button>
  );
}

function ChangePasswordForm({ forcedReset, message }: { forcedReset: boolean; message: string }) {
  const { changePassword, setRemediationRequired } = useAuth();
  const { t } = useObjectTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next !== confirm) { setError(t('auth.remediation.password.mismatch')); return; }
    setBusy(true);
    try {
      await changePassword(current, next);
      setRemediationRequired(null);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.remediation.password.failed'));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        {/* An administrator-forced reset is not an expiry: "your password has
            expired" would be false for it, so it gets its own title. */}
        <h2 className="text-lg font-semibold">
          {forcedReset ? t('auth.remediation.password.resetTitle') : t('auth.remediation.password.title')}
        </h2>
        {/* `message` is server-authored (localized upstream or not at all); only
            the empty-message fallback is ours to translate. */}
        <p className="mt-1 text-sm text-muted-foreground">
          {message || t('auth.remediation.password.fallbackMessage')}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="rem-cur">{t('auth.remediation.password.current')}</Label>
        <Input id="rem-cur" type="password" autoComplete="current-password" value={current}
          onChange={(e) => setCurrent(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rem-new">{t('auth.remediation.password.next')}</Label>
        <Input id="rem-new" type="password" autoComplete="new-password" value={next}
          onChange={(e) => setNext(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rem-conf">{t('auth.remediation.password.confirm')}</Label>
        <Input id="rem-conf" type="password" autoComplete="new-password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} required />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? t('auth.remediation.password.submitting') : t('auth.remediation.password.submit')}
      </Button>
      <SignOutLink />
    </form>
  );
}

function TotpQr({ uri }: { uri: string }) {
  const [error, setError] = useState<string | null>(null);
  const ref = (node: HTMLCanvasElement | null) => {
    if (!node || !uri) return;
    toCanvas(node, uri, { width: 184, margin: 1 }, (err) => { if (err) setError(err.message); });
  };
  return (
    <div className="flex justify-center rounded-md border bg-white p-3">
      {error ? <span className="text-sm text-destructive">{error}</span> : <canvas ref={ref} />}
    </div>
  );
}

function MfaEnrollForm({ message }: { message: string }) {
  const { enrollTotp, verifyTotp, setRemediationRequired } = useAuth();
  const { t } = useObjectTranslation();
  const [step, setStep] = useState<'password' | 'verify'>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [totpUri, setTotpUri] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const { totpURI, backupCodes: codes } = await enrollTotp(password);
      setTotpUri(totpURI);
      setBackupCodes(codes ?? []);
      setStep('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.remediation.mfa.enrollFailed'));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      await verifyTotp(code.trim());
      setRemediationRequired(null);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.remediation.mfa.invalidCode'));
      setBusy(false);
    }
  };

  if (step === 'password') {
    return (
      <form onSubmit={start} className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{t('auth.remediation.mfa.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {message || t('auth.remediation.mfa.fallbackMessage')}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="rem-pw">{t('auth.remediation.mfa.confirmPassword')}</Label>
          <Input id="rem-pw" type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t('auth.remediation.mfa.preparing') : t('auth.remediation.mfa.continue')}
        </Button>
        <SignOutLink />
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('auth.remediation.mfa.scanTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('auth.remediation.mfa.scanBody')}
        </p>
      </div>
      {totpUri ? <TotpQr uri={totpUri} /> : null}
      {backupCodes.length > 0 ? (
        <details className="rounded-md border bg-muted/40 p-3 text-xs">
          <summary className="cursor-pointer font-medium">{t('auth.remediation.mfa.backupTitle')}</summary>
          <p className="mt-1 text-muted-foreground">{t('auth.remediation.mfa.backupBody')}</p>
          <div className="mt-2 grid grid-cols-2 gap-1 font-mono">
            {backupCodes.map((c) => <span key={c}>{c}</span>)}
          </div>
        </details>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="rem-code">{t('auth.remediation.mfa.codeLabel')}</Label>
        <Input id="rem-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8}
          placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? t('auth.remediation.mfa.verifying') : t('auth.remediation.mfa.verify')}
      </Button>
      <SignOutLink />
    </form>
  );
}
