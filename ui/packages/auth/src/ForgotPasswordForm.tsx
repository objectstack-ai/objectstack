/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from './useAuth.js';
import type { AuthLinkComponentProps } from './types.js';
import {
  AUTH_FIELD_LABEL_CLASS,
  AUTH_INPUT_CLASS,
  AUTH_LINK_CLASS,
  AUTH_PRIMARY_BUTTON_CLASS,
  AuthErrorBanner,
  AuthFormHeader,
  AuthMailIcon,
  AuthSpinner,
} from './authStyles.js';

/** Translatable labels for the ForgotPasswordForm */
export interface ForgotPasswordFormLabels {
  emailLabel?: string;
  emailPlaceholder?: string;
  submitButton?: string;
  submittingButton?: string;
  successTitle?: string;
  successDescription?: string;
  backToSignInText?: string;
  rememberPasswordText?: string;
  signInText?: string;
  /** Phone reset (framework#2780) — phone field label (defaults to "Phone number"). */
  phoneLabel?: string;
  /** Phone reset — phone field placeholder (defaults to "+1 555 000 0000"). */
  phonePlaceholder?: string;
  /** Phone reset — code field label (defaults to "Verification code"). */
  otpCodeLabel?: string;
  /** Phone reset — code field placeholder (defaults to "6-digit code"). */
  otpCodePlaceholder?: string;
  /** Phone reset — "send code" button (defaults to "Get code"). */
  sendOtpButton?: string;
  /** Phone reset — resend countdown, `{seconds}` hole (defaults to "Resend in {seconds}s"). */
  resendOtpCountdownText?: string;
  /** Phone reset — new password field label (defaults to "New password"). */
  newPasswordLabel?: string;
  /** Phone reset — new password placeholder (defaults to "Enter a new password"). */
  newPasswordPlaceholder?: string;
  /** Phone reset — submit button (defaults to "Reset Password"). */
  resetButton?: string;
  /** Link that switches to the phone (SMS code) branch (defaults to "Reset via SMS code"). */
  usePhoneResetText?: string;
  /** Link that switches back to the email branch (defaults to "Reset via email instead"). */
  useEmailResetText?: string;
  /** Phone reset — success screen title (defaults to "Password reset"). */
  phoneSuccessTitle?: string;
  /** Phone reset — success screen description. */
  phoneSuccessDescription?: string;
}

export interface ForgotPasswordFormProps {
  /** Callback on successful submission */
  onSuccess?: () => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Link to login page */
  loginUrl?: string;
  /** Custom title */
  title?: string;
  /** Custom description */
  description?: string;
  /** Custom icon shown above the title (defaults to a small key disc) */
  icon?: React.ReactNode;
  /** Custom link component for SPA navigation (e.g. React Router's Link) */
  linkComponent?: React.ComponentType<AuthLinkComponentProps>;
  /** Override default labels for i18n */
  labels?: ForgotPasswordFormLabels;
  /** Hide the icon disc above the form title. Defaults to false. */
  hideIcon?: boolean;
}

const DefaultLink = ({ href, className, children }: AuthLinkComponentProps) => (
  <a href={href} className={className}>{children}</a>
);

const DefaultKeyIcon = () => (
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
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
);

/**
 * Forgot password form component.
 * Sends a password reset email to the user. Drop inside an `AuthShell`
 * for a polished split-screen experience.
 *
 * @example
 * ```tsx
 * <ForgotPasswordForm
 *   onSuccess={() => setShowSuccess(true)}
 *   loginUrl="/login"
 * />
 * ```
 */
export function ForgotPasswordForm({
  onSuccess,
  onError,
  loginUrl = '/login',
  title = 'Reset your password',
  description = "Enter your email address and we'll send you a link to reset your password",
  icon,
  hideIcon = false,
  linkComponent: LinkComp = DefaultLink,
  labels = {},
}: ForgotPasswordFormProps) {
  const {
    forgotPassword,
    isLoading,
    getAuthConfig,
    requestPhonePasswordReset,
    resetPasswordWithPhoneOtp,
  } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  // Phone (SMS OTP) reset branch (framework#2780). Only offered when the
  // server reports `features.phoneNumberOtp` — the phoneNumber plugin plus a
  // deliverable SMS service — so the link never leads to codes that can't
  // arrive.
  const [phoneOtpEnabled, setPhoneOtpEnabled] = useState(false);
  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [phoneResetDone, setPhoneResetDone] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => getAuthConfig())
      .then((config) => {
        if (!cancelled) setPhoneOtpEnabled(config?.features?.phoneNumberOtp === true);
      })
      .catch(() => {
        // Phone reset is an enhancement — a failed config fetch just hides it.
      });
    return () => {
      cancelled = true;
    };
  }, [getAuthConfig]);

  // Tick the resend cooldown down once per second while it's armed.
  useEffect(() => {
    if (otpCooldown <= 0) return;
    const timer = setTimeout(() => setOtpCooldown((s) => (s > 1 ? s - 1 : 0)), 1000);
    return () => clearTimeout(timer);
  }, [otpCooldown]);

  const l = {
    emailLabel: labels.emailLabel ?? 'Email',
    emailPlaceholder: labels.emailPlaceholder ?? 'name@example.com',
    submitButton: labels.submitButton ?? 'Send Reset Link',
    submittingButton: labels.submittingButton ?? 'Sending…',
    successTitle: labels.successTitle ?? 'Check your email',
    successDescription:
      labels.successDescription ??
      "We've sent a password reset link to {email}. Please check your inbox.",
    backToSignInText: labels.backToSignInText ?? 'Back to sign in',
    rememberPasswordText: labels.rememberPasswordText ?? 'Remember your password?',
    signInText: labels.signInText ?? 'Sign in',
    phoneLabel: labels.phoneLabel ?? 'Phone number',
    phonePlaceholder: labels.phonePlaceholder ?? '+1 555 000 0000',
    otpCodeLabel: labels.otpCodeLabel ?? 'Verification code',
    otpCodePlaceholder: labels.otpCodePlaceholder ?? '6-digit code',
    sendOtpButton: labels.sendOtpButton ?? 'Get code',
    resendOtpCountdownText: labels.resendOtpCountdownText ?? 'Resend in {seconds}s',
    newPasswordLabel: labels.newPasswordLabel ?? 'New password',
    newPasswordPlaceholder: labels.newPasswordPlaceholder ?? 'Enter a new password',
    resetButton: labels.resetButton ?? 'Reset Password',
    usePhoneResetText: labels.usePhoneResetText ?? 'Reset via SMS code',
    useEmailResetText: labels.useEmailResetText ?? 'Reset via email instead',
    phoneSuccessTitle: labels.phoneSuccessTitle ?? 'Password reset',
    phoneSuccessDescription:
      labels.phoneSuccessDescription ??
      'Your password has been reset. You can now sign in with your new password.',
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      // Trim pasted/autofilled whitespace before the reset request (#3238).
      await forgotPassword(email.trim());
      setSubmitted(true);
      onSuccess?.();
    } catch (err) {
      const authError = err instanceof Error ? err : new Error(String(err));
      setError(authError.message);
      onError?.(authError);
    }
  };

  /**
   * Request a reset OTP for the entered number (framework#2780). The server
   * always answers success (no account-existence oracle); a 429 from the
   * per-number cooldown surfaces its honest "retry in Ns" message.
   */
  const handleSendOtp = async () => {
    if (!phone.trim() || otpSending || otpCooldown > 0) return;
    setError(null);
    setOtpSending(true);
    try {
      await requestPhonePasswordReset(phone.trim());
      setOtpSent(true);
      setOtpCooldown(60);
    } catch (err) {
      const authError = err instanceof Error ? err : new Error(String(err));
      setError(authError.message);
      onError?.(authError);
    } finally {
      setOtpSending(false);
    }
  };

  const handlePhoneReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResetting(true);
    try {
      await resetPasswordWithPhoneOtp(phone.trim(), otpCode.trim(), newPassword);
      setPhoneResetDone(true);
      onSuccess?.();
    } catch (err) {
      const authError = err instanceof Error ? err : new Error(String(err));
      setError(authError.message);
      onError?.(authError);
    } finally {
      setResetting(false);
    }
  };

  const switchMode = (next: 'email' | 'phone') => {
    setMode(next);
    setError(null);
  };

  if (phoneResetDone) {
    return (
      <div className="mx-auto flex w-full flex-col justify-center space-y-7 sm:w-[400px]">
        <AuthFormHeader
          icon={
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/15 dark:text-emerald-400">
              <AuthMailIcon />
            </span>
          }
          title={l.phoneSuccessTitle}
          description={l.phoneSuccessDescription}
        />
        {loginUrl && (
          <p className="text-center text-sm text-muted-foreground">
            <LinkComp href={loginUrl} className={AUTH_LINK_CLASS}>
              ← {l.backToSignInText}
            </LinkComp>
          </p>
        )}
      </div>
    );
  }

  if (submitted) {
    const successMsg = l.successDescription.includes('{email}')
      ? l.successDescription.replace('{email}', email)
      : `${l.successDescription} ${email}`;
    return (
      <div className="mx-auto flex w-full flex-col justify-center space-y-7 sm:w-[400px]">
        <AuthFormHeader
          icon={
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/15 dark:text-emerald-400">
              <AuthMailIcon />
            </span>
          }
          title={l.successTitle}
          description={successMsg}
        />
        {loginUrl && (
          <p className="text-center text-sm text-muted-foreground">
            <LinkComp href={loginUrl} className={AUTH_LINK_CLASS}>
              ← {l.backToSignInText}
            </LinkComp>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full flex-col justify-center space-y-7 sm:w-[400px]">
      <AuthFormHeader
        icon={hideIcon ? undefined : (icon ?? <DefaultKeyIcon />)}
        title={title}
        description={description}
      />

      {mode === 'phone' ? (
      /* Phone (SMS OTP) reset branch — framework#2780: request a code for
         the number, then set the new password with it. */
      <form onSubmit={handlePhoneReset} className="space-y-4">
        {error && <AuthErrorBanner message={error} />}

        <div className="space-y-2">
          <label htmlFor="forgot-phone" className={AUTH_FIELD_LABEL_CLASS}>
            {l.phoneLabel}
          </label>
          <input
            id="forgot-phone"
            type="tel"
            placeholder={l.phonePlaceholder}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            autoComplete="tel"
            disabled={resetting}
            className={AUTH_INPUT_CLASS}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="forgot-otp" className={AUTH_FIELD_LABEL_CLASS}>
            {l.otpCodeLabel}
          </label>
          <div className="flex gap-2">
            <input
              id="forgot-otp"
              type="text"
              inputMode="numeric"
              placeholder={l.otpCodePlaceholder}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              required
              autoComplete="one-time-code"
              disabled={resetting}
              className={AUTH_INPUT_CLASS}
            />
            <button
              type="button"
              onClick={handleSendOtp}
              disabled={otpSending || otpCooldown > 0 || !phone.trim() || resetting}
              className="shrink-0 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
            >
              {otpSending && <AuthSpinner />}
              {otpCooldown > 0
                ? l.resendOtpCountdownText.replace('{seconds}', String(otpCooldown))
                : l.sendOtpButton}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="forgot-new-password" className={AUTH_FIELD_LABEL_CLASS}>
            {l.newPasswordLabel}
          </label>
          <input
            id="forgot-new-password"
            type="password"
            placeholder={l.newPasswordPlaceholder}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            autoComplete="new-password"
            disabled={resetting}
            className={AUTH_INPUT_CLASS}
          />
        </div>

        <button
          type="submit"
          disabled={resetting || !otpSent}
          className={AUTH_PRIMARY_BUTTON_CLASS}
        >
          {resetting && <AuthSpinner />}
          {resetting ? l.submittingButton : l.resetButton}
        </button>

        <button
          type="button"
          onClick={() => switchMode('email')}
          className="w-full text-center text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
        >
          {l.useEmailResetText}
        </button>
      </form>
      ) : (
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <AuthErrorBanner message={error} />}

        <div className="space-y-2">
          <label htmlFor="forgot-email" className={AUTH_FIELD_LABEL_CLASS}>
            {l.emailLabel}
          </label>
          <input
            id="forgot-email"
            type="email"
            placeholder={l.emailPlaceholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            disabled={isLoading}
            className={AUTH_INPUT_CLASS}
          />
        </div>

        <button type="submit" disabled={isLoading} className={AUTH_PRIMARY_BUTTON_CLASS}>
          {isLoading && <AuthSpinner />}
          {isLoading ? l.submittingButton : l.submitButton}
        </button>

        {phoneOtpEnabled && (
          <button
            type="button"
            onClick={() => switchMode('phone')}
            className="w-full text-center text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
          >
            {l.usePhoneResetText}
          </button>
        )}
      </form>
      )}

      {loginUrl && (
        <p className="px-8 text-center text-sm text-muted-foreground">
          {l.rememberPasswordText}{' '}
          <LinkComp href={loginUrl} className={AUTH_LINK_CLASS}>
            {l.signInText}
          </LinkComp>
        </p>
      )}
    </div>
  );
}
