// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/studio` — the Studio metadata-builder app as its own ObjectStack
 * package (ADR-0048: one app per package).
 *
 * Studio is a console navigation-shell app (an `AppSchema`), not a kernel
 * extension — but it still needs a thin registration entry to publish its
 * manifest into the running kernel, mirroring how `@objectstack/plugin-auth`
 * registers its own manifest. Giving it a distinct package id
 * (`com.objectstack.studio`) is what lets `/apps/<packageId>` resolve to exactly
 * this app instead of being ambiguous inside a multi-app package.
 *
 * NOTE (transitional): the `STUDIO_APP` schema is still imported from
 * `@objectstack/platform-objects/apps`; a follow-up moves the definition into
 * this package and drops the dependency. This package is intentionally NOT yet
 * wired into the dev/serve plugin set — that boot-path switch (and removing the
 * app from plugin-auth's manifest) lands separately so it can be verified
 * against a live `os dev` boot.
 */

import { STUDIO_APP } from '@objectstack/platform-objects/apps';

import { STUDIO_OVERVIEW_DOC } from './studio-overview.doc.js';

export const STUDIO_APP_PACKAGE_ID = 'com.objectstack.studio';
export const STUDIO_APP_NAMESPACE = 'studio';
export const STUDIO_APP_VERSION = '9.3.0';

/** Manifest header for the Studio app package. */
export const studioAppManifestHeader = {
  id: STUDIO_APP_PACKAGE_ID,
  namespace: STUDIO_APP_NAMESPACE,
  version: STUDIO_APP_VERSION,
  type: 'plugin' as const,
  scope: 'system' as const,
  name: 'Studio',
  description: 'ObjectStack Studio — metadata builder app.',
  // Studio navigates platform metadata owned by plugin-auth; declare the
  // dependency so it loads after the auth objects are registered.
  dependencies: ['com.objectstack.plugin-auth'],
};

/**
 * Thin plugin that registers the Studio app manifest. Structurally typed
 * against the kernel `Plugin` contract (no compile-time kernel dependency),
 * exactly like `AuthPlugin`.
 */
export class StudioAppPlugin {
  readonly name = STUDIO_APP_PACKAGE_ID;
  readonly type = 'standard';
  readonly version = STUDIO_APP_VERSION;
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
      ...studioAppManifestHeader,
      apps: [STUDIO_APP],
      // ADR-0046 package docs — grouped under "Studio" at /_console/docs.
      docs: [STUDIO_OVERVIEW_DOC],
    });
  }
}

/** Convenience factory mirroring the rest of the plugin ecosystem. */
export function createStudioAppPlugin(): StudioAppPlugin {
  return new StudioAppPlugin();
}

export { STUDIO_APP };
export { STUDIO_OVERVIEW_DOC };
