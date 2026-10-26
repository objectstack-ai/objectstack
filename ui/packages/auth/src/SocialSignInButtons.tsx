/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from './useAuth.js';
import { AuthSpinner } from './authStyles.js';
import type { AuthSocialProvider } from './types.js';

// Brand name overrides for providers whose `name` from the server may be unset
// or where we want to canonicalize casing.
const PROVIDER_LABEL: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  microsoft: 'Microsoft',
  apple: 'Apple',
  facebook: 'Facebook',
  twitter: 'Twitter',
  discord: 'Discord',
  gitlab: 'GitLab',
  linkedin: 'LinkedIn',
};

// Inline brand-mark SVGs (single-color, currentColor where possible). Kept inline
// so the package has zero new icon-library dependencies.
const PROVIDER_ICON: Record<string, React.ReactNode> = {
  google: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.74-6-6.1s2.7-6.1 6-6.1c1.88 0 3.14.8 3.86 1.5l2.64-2.55C16.84 3.36 14.66 2.4 12 2.4 6.92 2.4 2.8 6.52 2.8 11.6S6.92 20.8 12 20.8c6.92 0 9.2-4.86 9.2-7.4 0-.5-.06-.88-.14-1.2H12z"/>
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.07c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.25 3.34.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11.04 11.04 0 015.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.7 5.39-5.27 5.68.41.36.78 1.06.78 2.13v3.16c0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/>
    </svg>
  ),
  microsoft: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#F25022" d="M2 2h9.5v9.5H2z"/>
      <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z"/>
      <path fill="#00A4EF" d="M2 12.5h9.5V22H2z"/>
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z"/>
    </svg>
  ),
  apple: (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M16.37 12.55c-.02-2.27 1.85-3.36 1.94-3.42-1.06-1.55-2.71-1.76-3.3-1.79-1.4-.14-2.74.83-3.45.83-.71 0-1.81-.81-2.98-.79-1.53.02-2.95.89-3.74 2.27-1.6 2.77-.41 6.86 1.14 9.11.76 1.1 1.66 2.34 2.83 2.3 1.14-.05 1.57-.74 2.94-.74 1.37 0 1.76.74 2.96.71 1.22-.02 2-1.12 2.75-2.23.87-1.28 1.22-2.52 1.24-2.59-.03-.01-2.38-.91-2.4-3.66zM14.1 5.31c.62-.76 1.05-1.81.93-2.86-.9.04-2 .6-2.65 1.35-.58.66-1.1 1.74-.96 2.76 1.01.08 2.04-.51 2.68-1.25z"/>
    </svg>
  ),
  facebook: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#1877F2" d="M24 12C24 5.37 18.63 0 12 0S0 5.37 0 12c0 5.99 4.39 10.95 10.13 11.85V15.47H7.08V12h3.05V9.36c0-3.01 1.79-4.67 4.53-4.67 1.31 0 2.69.23 2.69.23v2.96h-1.51c-1.49 0-1.96.93-1.96 1.88V12h3.33l-.53 3.47h-2.8v8.38C19.61 22.95 24 17.99 24 12z"/>
    </svg>
  ),
  twitter: (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  ),
  discord: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#5865F2" d="M20.32 4.37A19.79 19.79 0 0016.56 3l-.18.36a18.27 18.27 0 00-8.76 0L7.44 3a19.79 19.79 0 00-3.76 1.37C.99 8.4.27 12.34.63 16.22a19.94 19.94 0 006.07 3.07l.49-.7a13.2 13.2 0 01-2.07-.99c.17-.13.34-.27.5-.41a14.13 14.13 0 0012.76 0c.16.14.33.28.5.41-.66.4-1.36.73-2.07.99l.49.7a19.92 19.92 0 006.07-3.07c.43-4.5-.66-8.41-2.95-11.85zM8.52 14.12c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.09 2.15 2.42 0 1.33-.96 2.41-2.15 2.41zm6.96 0c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.09 2.15 2.42 0 1.33-.95 2.41-2.15 2.41z"/>
    </svg>
  ),
  gitlab: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#FC6D26" d="M23.6 9.6L23.57 9.5 20.3.81a.84.84 0 00-1.6.05L16.5 7.6H7.5L5.3.86a.84.84 0 00-1.6-.05L.43 9.5l-.03.1a5.84 5.84 0 001.94 6.74l.01.01.03.02 4.8 3.6 2.38 1.8 1.45 1.1a1 1 0 001.2 0l1.45-1.1 2.38-1.8 4.83-3.62.01-.01a5.84 5.84 0 001.93-6.74z"/>
    </svg>
  ),
  linkedin: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#0A66C2" d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 11.01-4.13 2.06 2.06 0 010 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z"/>
    </svg>
  ),
};

function ProviderIcon({ id }: { id: string }) {
  const icon = PROVIDER_ICON[id];
  if (icon) return <span className="mr-2 flex h-4 w-4 items-center justify-center">{icon}</span>;
  return (
    <span className="mr-2 flex h-4 w-4 items-center justify-center rounded-sm bg-muted text-[10px] font-bold uppercase">
      {id[0]}
    </span>
  );
}

export interface SocialSignInButtonsProps {
  /** Sign-in vs sign-up changes the button label ("Continue with" vs "Sign up with") */
  mode?: 'sign-in' | 'sign-up';
  /** Where the provider should redirect after success. Defaults to current page. */
  callbackURL?: string;
  /** Where the provider should redirect on error. Defaults to current page. */
  errorCallbackURL?: string;
  /** Divider text shown between social buttons and the email form (defaults to "or continue with email") */
  dividerText?: string;
  /**
   * Omit the divider under the buttons. For a host that draws no email form
   * beneath them at that moment, e.g. `LoginForm` under SSO-only mode until
   * the password form is revealed. Defaults to false: the divider renders.
   */
  hideDivider?: boolean;
  /**
   * Provider button label, for i18n. `{provider}` is replaced with the
   * provider's display name, so a translation places the name where its
   * grammar needs it. Defaults to "Continue with {provider}" in `sign-in`
   * mode and "Sign up with {provider}" in `sign-up` mode.
   */
  buttonText?: string;
  /** Called once after config resolves with whether any social providers are available. */
  onProvidersResolved?: (hasProviders: boolean) => void;
}

/**
 * Renders one button per enabled third-party provider returned by
 * `GET {authUrl}/config`. Clicking a button initiates an OAuth redirect via
 * better-auth (`signIn.social` or `signIn.oauth2`).
 *
 * Returns `null` while loading or when the server reports no providers.
 */
export function SocialSignInButtons({
  mode = 'sign-in',
  callbackURL,
  errorCallbackURL,
  dividerText = 'or continue with email',
  hideDivider = false,
  buttonText,
  onProvidersResolved,
}: SocialSignInButtonsProps) {
  const { getAuthConfig, signInWithProvider } = useAuth();
  const [providers, setProviders] = useState<AuthSocialProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Provider id of the in-flight `signInWithProvider` call. Sign-in ends in a
  // full-page navigation, so the spinner deliberately stays on until unload —
  // it is only cleared when the call FAILS and the user needs the button back.
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Wrap in Promise.resolve so synchronous throws (e.g. mock client without
    // getConfig) become rejections we can swallow rather than uncaught errors.
    Promise.resolve()
      .then(() => getAuthConfig())
      .then((config) => {
        if (cancelled) return;
        const list = config?.socialProviders ?? [];
        const enabled = list.filter((p) => p.enabled);
        setProviders(enabled);
        onProvidersResolved?.(enabled.length > 0);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Don't surface as a hard error — providers are an enhancement, not required.
        console.warn('[SocialSignInButtons] failed to load auth config', err);
        onProvidersResolved?.(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [getAuthConfig]);

  if (loading || providers.length === 0) return null;

  const labelTemplate =
    buttonText ?? (mode === 'sign-in' ? 'Continue with {provider}' : 'Sign up with {provider}');
  const defaultCallback =
    typeof window !== 'undefined' ? window.location.href : undefined;

  const onClick = async (provider: AuthSocialProvider) => {
    if (pendingId) return;
    setError(null);
    setPendingId(provider.id);
    try {
      await signInWithProvider(provider.id, {
        callbackURL: callbackURL ?? defaultCallback,
        errorCallbackURL: errorCallbackURL ?? callbackURL ?? defaultCallback,
        type: provider.type ?? 'social',
      });
      // Success = the browser is navigating to the provider. Keep the pending
      // state so the button doesn't "un-busy" during the page teardown.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPendingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}
      {providers.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onClick(p)}
          disabled={pendingId !== null}
          aria-busy={pendingId === p.id}
          className="inline-flex h-10 w-full items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
        >
          {pendingId === p.id ? <AuthSpinner /> : <ProviderIcon id={p.id} />}
          {/* A replacer FUNCTION, so a `$` in a provider name is never read as a replacement pattern. */}
          {labelTemplate.replace('{provider}', () => PROVIDER_LABEL[p.id] ?? p.name)}
        </button>
      ))}
      {hideDivider ? null : (
        <div className="relative my-1">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">{dividerText}</span>
          </div>
        </div>
      )}
    </div>
  );
}
