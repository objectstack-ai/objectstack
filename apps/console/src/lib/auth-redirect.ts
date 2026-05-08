// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Cross-SPA auth redirect helpers.
 *
 * The Console defers all sign-in / sign-up UI to the Account SPA mounted
 * at `/_account/`. These helpers build absolute URLs preserving the
 * original Console location so the user lands back where they started
 * after auth.
 */

const ACCOUNT_BASE = '/_account';

/** Compose a Console absolute path from `pathname + search`. */
function currentConsoleHref(): string {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname + window.location.search;
}

/**
 * Hard-navigate the browser to the Account login page, preserving the
 * current Console path as `?redirect=...`.
 */
export function gotoAccountLogin(redirect?: string): void {
  const target = redirect ?? currentConsoleHref();
  const url = `${ACCOUNT_BASE}/login?redirect=${encodeURIComponent(target)}`;
  window.location.assign(url);
}

/** Hard-navigate to the Account registration page. */
export function gotoAccountRegister(redirect?: string): void {
  const target = redirect ?? currentConsoleHref();
  const url = `${ACCOUNT_BASE}/register?redirect=${encodeURIComponent(target)}`;
  window.location.assign(url);
}

/** Hard-navigate to the Account forgot-password page. */
export function gotoAccountForgotPassword(): void {
  window.location.assign(`${ACCOUNT_BASE}/forgot-password`);
}

/** Hard-navigate to a path under the Account SPA (e.g. `/account`, `/organizations`). */
export function gotoAccount(path: string): void {
  const clean = path.startsWith('/') ? path : `/${path}`;
  window.location.assign(`${ACCOUNT_BASE}${clean}`);
}
