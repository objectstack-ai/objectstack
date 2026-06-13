// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/account` — the end-user Account self-service app as its own
 * ObjectStack package (ADR-0048: one app per package).
 *
 * Account is a console navigation-shell app (`AppSchema`) given a distinct
 * package id (`com.objectstack.account`) so `/apps/<packageId>` (alias
 * `/apps/account`) resolves to exactly this app. It navigates auth/identity
 * objects owned by `@objectstack/plugin-auth`, hence the dependency.
 *
 * (The package name `@objectstack/account` was previously held by a deprecated
 * standalone account-portal SPA, now removed; this reclaims it for the console
 * account app.)
 *
 * NOTE (transitional): `ACCOUNT_APP` is still imported from
 * `@objectstack/platform-objects/apps`, and this package is NOT yet wired into
 * the dev/serve plugin set — that boot-path switch lands separately so it can
 * be verified against a live `os dev` boot.
 */

import { ACCOUNT_APP } from '@objectstack/platform-objects/apps';

export const ACCOUNT_APP_PACKAGE_ID = 'com.objectstack.account';
export const ACCOUNT_APP_NAMESPACE = 'account';
export const ACCOUNT_APP_VERSION = '9.3.0';

/** Manifest header for the Account app package. */
export const accountAppManifestHeader = {
  id: ACCOUNT_APP_PACKAGE_ID,
  namespace: ACCOUNT_APP_NAMESPACE,
  version: ACCOUNT_APP_VERSION,
  type: 'plugin' as const,
  scope: 'system' as const,
  name: 'Account',
  description: 'ObjectStack Account — end-user account & self-service app.',
  dependencies: ['com.objectstack.plugin-auth'],
};

/**
 * Thin plugin that registers the Account app manifest. Structurally typed
 * against the kernel `Plugin` contract.
 */
export class AccountAppPlugin {
  readonly name = ACCOUNT_APP_PACKAGE_ID;
  readonly type = 'standard';
  readonly version = ACCOUNT_APP_VERSION;
  readonly dependencies: string[] = ['com.objectstack.plugin-auth'];

  async init(_ctx: any): Promise<void> {
    // No-op: registration happens in start() once the manifest service exists.
  }

  async start(ctx: any): Promise<void> {
    const manifest = ctx?.getService?.('manifest');
    if (!manifest || typeof manifest.register !== 'function') return;
    manifest.register({ ...accountAppManifestHeader, apps: [ACCOUNT_APP] });
  }
}

/** Convenience factory mirroring the rest of the plugin ecosystem. */
export function createAccountAppPlugin(): AccountAppPlugin {
  return new AccountAppPlugin();
}

export { ACCOUNT_APP };
