// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/setup` — the Setup platform-administration app as its own
 * ObjectStack package (ADR-0048: one app per package).
 *
 * Like `@objectstack/studio`, Setup is a console navigation-shell app
 * (`AppSchema`) given a distinct package id (`com.objectstack.setup`) so
 * `/apps/<packageId>` resolves to exactly this app. Setup also ships the
 * baseline navigation contributions other packages extend into the Setup app.
 *
 * NOTE (transitional): `SETUP_APP` / `SETUP_NAV_CONTRIBUTIONS` are still
 * imported from `@objectstack/platform-objects/apps`, and this package is NOT
 * yet wired into the dev/serve plugin set — that boot-path switch lands
 * separately so it can be verified against a live `os dev` boot.
 */

import { SETUP_APP, SETUP_NAV_CONTRIBUTIONS } from '@objectstack/platform-objects/apps';

import { SETUP_OVERVIEW_DOC } from './setup-overview.doc.js';

export const SETUP_APP_PACKAGE_ID = 'com.objectstack.setup';
export const SETUP_APP_NAMESPACE = 'setup';
export const SETUP_APP_VERSION = '9.3.0';

/** Manifest header for the Setup app package. */
export const setupAppManifestHeader = {
  id: SETUP_APP_PACKAGE_ID,
  namespace: SETUP_APP_NAMESPACE,
  version: SETUP_APP_VERSION,
  type: 'plugin' as const,
  scope: 'system' as const,
  name: 'Setup',
  description: 'ObjectStack Setup — platform administration app.',
  dependencies: ['com.objectstack.plugin-auth'],
};

/**
 * Thin plugin that registers the Setup app manifest (app + its baseline nav
 * contributions). Structurally typed against the kernel `Plugin` contract.
 */
export class SetupAppPlugin {
  readonly name = SETUP_APP_PACKAGE_ID;
  readonly type = 'standard';
  readonly version = SETUP_APP_VERSION;
  // Kernel plugin dependency is matched by plugin NAME (AuthPlugin.name =
  // 'com.objectstack.auth'), not by package id.
  readonly dependencies: string[] = ['com.objectstack.auth'];

  async init(_ctx: any): Promise<void> {
    // No-op: registration happens in start() once the manifest service exists.
  }

  async start(ctx: any): Promise<void> {
    const manifest = ctx?.getService?.('manifest');
    if (!manifest || typeof manifest.register !== 'function') return;
    manifest.register({
      ...setupAppManifestHeader,
      apps: [SETUP_APP],
      navigationContributions: SETUP_NAV_CONTRIBUTIONS,
      // ADR-0046 package docs — grouped under "Setup" at /_console/docs.
      docs: [SETUP_OVERVIEW_DOC],
    });
  }
}

/** Convenience factory mirroring the rest of the plugin ecosystem. */
export function createSetupAppPlugin(): SetupAppPlugin {
  return new SetupAppPlugin();
}

export { SETUP_APP, SETUP_NAV_CONTRIBUTIONS };
export { SETUP_OVERVIEW_DOC };
