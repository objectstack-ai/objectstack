/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useState } from 'react';
import { useAuth } from './useAuth.js';
import { SocialSignInButtons } from './SocialSignInButtons.js';
import type { AuthLinkComponentProps } from './types.js';
import {
  AUTH_FIELD_LABEL_CLASS,
  AUTH_INPUT_CLASS,
  AUTH_LINK_CLASS,
  AUTH_PRIMARY_BUTTON_CLASS,
  AuthErrorBanner,
  AuthFormHeader,
  AuthSpinner,
} from './authStyles.js';

/** Translatable labels for the RegisterForm */
export interface RegisterFormLabels {
  nameLabel?: string;
  namePlaceholder?: string;
  emailLabel?: string;
  emailPlaceholder?: string;
  passwordLabel?: string;
  passwordPlaceholder?: string;
  confirmPasswordLabel?: string;
  confirmPasswordPlaceholder?: string;
  passwordMismatchError?: string;
  passwordTooShortError?: string;
  submitButton?: string;
  submittingButton?: string;
  hasAccountText?: string;
  signInText?: string;
  /**
   * Divider label between the social provider buttons and the email/password
   * form (defaults to "or continue with email"). Rendered only when the server
   * reports at least one social provider.
   */
  orText?: string;
  /**
   * Social provider button label (defaults to "Sign up with {provider}");
   * `{provider}` is replaced with the provider's display name.
   */
  socialButton?: string;
}

export interface RegisterFormProps {
  /** Callback on successful registration AND auto sign-in. Not called when the
   *  server requires email verification — use `onVerificationRequired` for that. */
  onSuccess?: () => void;
  /** Callback when the server accepted the registration but is gating
   *  sign-in on email verification. The page should swap the form for a
   *  "check your inbox" confirmation. */
  onVerificationRequired?: (email: string) => void;
  /**
   * Where the email-verification link should land once the address is
   * verified — e.g. the invitation page the user registered from
   * (objectui#10893). Forwarded to `signUp` as better-auth's sign-up
   * `callbackURL`; see `SignUpData.callbackURL` for the only shapes the server
   * accepts (a document-relative `./…` fails the whole sign-up). Omitted, the
   * server default (`/`) applies. Only matters when the server requires email
   * verification — an auto-signed-in registration calls `onSuccess` instead.
   */
  verificationCallbackURL?: string;
  /** Callback on registration error */
  onError?: (error: Error) => void;
  /** Link to login page */
  loginUrl?: string;
  /** Custom title */
  title?: string;
  /** Custom description */
  description?: string;
  /** Custom icon shown above the title (defaults to a small user-plus disc) */
  icon?: React.ReactNode;
  /** Custom link component for SPA navigation (e.g. React Router's Link) */
  linkComponent?: React.ComponentType<AuthLinkComponentProps>;
  /** Override default labels for i18n */
  labels?: RegisterFormLabels;
  /**
   * Map of better-auth error `code` → localized message (e.g.
   * `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`). Unknown codes fall back to the
   * raw server message.
   */
  errorMessages?: Record<string, string>;
  /** Hide the icon disc above the form title. Defaults to false. */
  hideIcon?: boolean;
}

const DefaultLink = ({ href, className, children }: AuthLinkComponentProps) => (
  <a href={href} className={className}>{children}</a>
);

const DefaultUserPlusIcon = () => (
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
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <line x1="19" y1="8" x2="19" y2="14" />
    <line x1="22" y1="11" x2="16" y2="11" />
  </svg>
);

/**
 * Registration form component with name, email, and password fields.
 * Uses Tailwind CSS utility classes for styling. Drop inside an `AuthShell`
 * for a polished split-screen experience.
 *
 * @example
 * ```tsx
 * <RegisterForm
 *   onSuccess={() => navigate('/dashboard')}
 *   loginUrl="/login"
 * />
 * ```
 */
export function RegisterForm({
  onSuccess,
  onVerificationRequired,
  verificationCallbackURL,
  onError,
  loginUrl = '/login',
  title = 'Create an account',
  description = 'Enter your information to get started',
  icon,
  hideIcon = false,
  linkComponent: LinkComp = DefaultLink,
  labels = {},
  errorMessages,
}: RegisterFormProps) {
  const { signUp, isLoading } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const l = {
    nameLabel: labels.nameLabel ?? 'Name',
    namePlaceholder: labels.namePlaceholder ?? 'John Doe',
    emailLabel: labels.emailLabel ?? 'Email',
    emailPlaceholder: labels.emailPlaceholder ?? 'name@example.com',
    passwordLabel: labels.passwordLabel ?? 'Password',
    passwordPlaceholder: labels.passwordPlaceholder ?? 'Create a password (min. 8 characters)',
    confirmPasswordLabel: labels.confirmPasswordLabel ?? 'Confirm Password',
    confirmPasswordPlaceholder: labels.confirmPasswordPlaceholder ?? 'Confirm your password',
    passwordMismatchError: labels.passwordMismatchError ?? 'Passwords do not match',
    passwordTooShortError: labels.passwordTooShortError ?? 'Password must be at least 8 characters',
    submitButton: labels.submitButton ?? 'Create Account',
    submittingButton: labels.submittingButton ?? 'Creating account…',
    hasAccountText: labels.hasAccountText ?? 'Already have an account?',
    signInText: labels.signInText ?? 'Sign in',
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(l.passwordMismatchError);
      return;
    }

    if (password.length < 8) {
      setError(l.passwordTooShortError);
      return;
    }

    // Autofill and copy-paste routinely smuggle in leading/trailing whitespace
    // that the server rejects as "Invalid email" (#3238) — trim before use.
    const trimmedEmail = email.trim();
    try {
      const result = await signUp(name, trimmedEmail, password, verificationCallbackURL);
      if (result?.requiresVerification) {
        onVerificationRequired?.(trimmedEmail);
        return;
      }
      onSuccess?.();
    } catch (err) {
      const authError = err instanceof Error ? err : new Error(String(err));
      const code = (authError as Error & { code?: string }).code;
      setError((code && errorMessages?.[code]) || authError.message);
      onError?.(authError);
    }
  };

  return (
    <div className="mx-auto flex w-full flex-col justify-center space-y-7 sm:w-[400px]">
      <AuthFormHeader
        icon={hideIcon ? undefined : (icon ?? <DefaultUserPlusIcon />)}
        title={title}
        description={description}
      />

      <div className="space-y-5">
        {/* Unset labels stay `undefined` here, so the component's own English
            defaults apply — one copy of each default, not two. */}
        <SocialSignInButtons
          mode="sign-up"
          dividerText={labels.orText}
          buttonText={labels.socialButton}
        />

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* No divider here: SocialSignInButtons already renders its own
              "or continue with email" divider under the provider buttons —
              stacking a second "or" line read as a rendering glitch (#2625,
              matching the LoginForm fix). */}
          {error && <AuthErrorBanner message={error} />}

          <div className="space-y-2">
            <label htmlFor="register-name" className={AUTH_FIELD_LABEL_CLASS}>
              {l.nameLabel}
            </label>
            <input
              id="register-name"
              type="text"
              placeholder={l.namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              disabled={isLoading}
              className={AUTH_INPUT_CLASS}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="register-email" className={AUTH_FIELD_LABEL_CLASS}>
              {l.emailLabel}
            </label>
            <input
              id="register-email"
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

          <div className="space-y-2">
            <label htmlFor="register-password" className={AUTH_FIELD_LABEL_CLASS}>
              {l.passwordLabel}
            </label>
            <input
              id="register-password"
              type="password"
              placeholder={l.passwordPlaceholder}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              disabled={isLoading}
              className={AUTH_INPUT_CLASS}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="register-confirm-password" className={AUTH_FIELD_LABEL_CLASS}>
              {l.confirmPasswordLabel}
            </label>
            <input
              id="register-confirm-password"
              type="password"
              placeholder={l.confirmPasswordPlaceholder}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              disabled={isLoading}
              className={AUTH_INPUT_CLASS}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className={AUTH_PRIMARY_BUTTON_CLASS}
          >
            {isLoading && <AuthSpinner />}
            {isLoading ? l.submittingButton : l.submitButton}
          </button>
        </form>
      </div>

      {loginUrl && (
        <p className="px-8 text-center text-sm text-muted-foreground">
          {l.hasAccountText}{' '}
          <LinkComp href={loginUrl} className={AUTH_LINK_CLASS}>
            {l.signInText}
          </LinkComp>
        </p>
      )}
    </div>
  );
}
