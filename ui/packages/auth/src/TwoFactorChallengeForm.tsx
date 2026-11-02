/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth.js';
import type { SignInTwoFactorCodeKind, TwoFactorChallenge } from './types.js';
import { TWO_FACTOR_CHALLENGE_ENDED_CODES } from './two-factor-codes.js';
import {
  AUTH_FIELD_LABEL_CLASS,
  AUTH_INPUT_CLASS,
  AUTH_PRIMARY_BUTTON_CLASS,
  AUTH_TOUCH_TARGET_CLASS,
  AuthErrorBanner,
  AuthFormHeader,
  AuthSpinner,
} from './authStyles.js';

/** The resolved strings the challenge step draws; `LoginForm` supplies them from its labels. */
export interface TwoFactorChallengeStrings {
  title: string;
  description: string;
  backupDescription: string;
  codeLabel: string;
  backupCodeLabel: string;
  verifyButton: string;
  verifyingButton: string;
  useBackupCodeText: string;
  useAuthenticatorText: string;
  backText: string;
}

export interface TwoFactorChallengeFormProps {
  challenge: TwoFactorChallenge;
  strings: TwoFactorChallengeStrings;
  /** Server refusal `code` → localized text, the map `LoginForm` receives. */
  errorMessages?: Record<string, string>;
  /** Draw no icon/title block: the host draws its own header (see `LoginForm.hideHeader`). */
  hideHeader?: boolean;
  hideIcon?: boolean;
  /** The code was accepted and the session is installed. */
  onSuccess?: () => void;
  /** Any refusal, for the host's own handling (`LoginForm.onError`). */
  onError?: (error: Error) => void;
  /**
   * The server dropped the pending sign-in (attempts spent, or it expired):
   * the provider has already cleared the challenge, so the host shows this
   * message on the password step it returns to.
   */
  onChallengeEnded?: (message: string) => void;
}

const ShieldIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-6 w-6"
    aria-hidden="true"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const SECONDARY_BUTTON_CLASS = `w-full text-center text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline disabled:opacity-50 ${AUTH_TOUCH_TARGET_CLASS}`;

/**
 * objectstack#29105 — the second step of a password sign-in for an account
 * with two-factor sign-in on: asks for the code from the user's authenticator
 * app, or one of their backup codes, and finishes the sign-in through
 * `verifySignInTwoFactor`. A wrong code is reported in place and the step
 * stays; "Back to sign in" abandons it for the password step.
 *
 * Rendered by `LoginForm` in place of its form while `twoFactorChallenge` is
 * set, so every host of `LoginForm` gets it, and so does any other caller of
 * `signIn` on the same page (the console's dev-admin chip).
 */
export function TwoFactorChallengeForm({
  challenge,
  strings,
  errorMessages,
  hideHeader = false,
  hideIcon = false,
  onSuccess,
  onError,
  onChallengeEnded,
}: TwoFactorChallengeFormProps) {
  const { verifySignInTwoFactor, cancelTwoFactorChallenge } = useAuth();
  const offersAuthenticator = challenge.methods.includes('totp');
  // Backup codes are always accepted for an enrolled account; with no
  // authenticator on offer they are the only way in.
  const [kind, setKind] = useState<SignInTwoFactorCodeKind>(offersAuthenticator ? 'totp' : 'backup-code');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const description = kind === 'totp' ? strings.description : strings.backupDescription;

  const switchKind = (next: SignInTwoFactorCodeKind) => {
    setKind(next);
    setCode('');
    setError(null);
    // The field remounts for the new kind (its `key`) and takes focus itself.
  };

  // After a refusal, put the cursor back in the (cleared) field for the retry.
  useEffect(() => {
    if (error) inputRef.current?.focus();
  }, [error]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    // Authenticator apps show the code as "123 456"; a pasted code keeps the space.
    const entered = kind === 'totp' ? code.replace(/\s+/g, '') : code.trim();
    if (!entered) return;
    setError(null);
    setSubmitting(true);
    try {
      await verifySignInTwoFactor(entered, kind);
      onSuccess?.();
    } catch (err) {
      const authError = err instanceof Error ? err : new Error(String(err));
      const errCode = (authError as Error & { code?: string }).code;
      const message = (errCode && errorMessages?.[errCode]) || authError.message;
      onError?.(authError);
      if (errCode && TWO_FACTOR_CHALLENGE_ENDED_CODES.has(errCode)) {
        // The provider has cleared the challenge; this step is unmounting.
        onChallengeEnded?.(message);
        return;
      }
      setCode('');
      setSubmitting(false);
      setError(message);
    }
  };

  return (
    <div
      data-testid="two-factor-challenge"
      className={`mx-auto flex w-full flex-col justify-center sm:max-w-[400px] ${
        hideHeader ? 'space-y-4' : 'space-y-7'
      }`}
    >
      {hideHeader ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      ) : (
        <AuthFormHeader
          icon={hideIcon ? undefined : <ShieldIcon />}
          title={strings.title}
          description={description}
        />
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <AuthErrorBanner message={error} />}
        <div className="space-y-2">
          <label htmlFor="two-factor-code" className={AUTH_FIELD_LABEL_CLASS}>
            {kind === 'totp' ? strings.codeLabel : strings.backupCodeLabel}
          </label>
          <input
            ref={inputRef}
            id="two-factor-code"
            name="code"
            // The key remounts the field when the kind changes, so the browser
            // does not offer a one-time code for a backup-code field.
            key={kind}
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoFocus
            disabled={submitting}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            {...(kind === 'totp'
              ? { inputMode: 'numeric' as const, autoComplete: 'one-time-code' }
              : { autoComplete: 'off' })}
            className={`${AUTH_INPUT_CLASS} font-mono tracking-widest`}
          />
        </div>
        <button type="submit" disabled={submitting || !code.trim()} className={AUTH_PRIMARY_BUTTON_CLASS}>
          {submitting && <AuthSpinner />}
          {submitting ? strings.verifyingButton : strings.verifyButton}
        </button>
      </form>

      <div className="space-y-1">
        {kind === 'totp' ? (
          <button
            type="button"
            onClick={() => switchKind('backup-code')}
            disabled={submitting}
            className={SECONDARY_BUTTON_CLASS}
          >
            {strings.useBackupCodeText}
          </button>
        ) : offersAuthenticator ? (
          <button
            type="button"
            onClick={() => switchKind('totp')}
            disabled={submitting}
            className={SECONDARY_BUTTON_CLASS}
          >
            {strings.useAuthenticatorText}
          </button>
        ) : null}
        <button
          type="button"
          data-testid="two-factor-back"
          onClick={cancelTwoFactorChallenge}
          disabled={submitting}
          className={SECONDARY_BUTTON_CLASS}
        >
          {strings.backText}
        </button>
      </div>
    </div>
  );
}
