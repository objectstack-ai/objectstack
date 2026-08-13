// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineStack } from '@objectstack/spec';
import { authIdentityObjects, authObjectExtensions, authPluginManifestHeader } from './src/manifest';

/**
 * ObjectStack Configuration for plugin-auth
 *
 * This configuration defines the authentication and identity kernel objects
 * for the ObjectStack platform. The manifest header and objects list are
 * imported from a single canonical source (`src/manifest.ts`) so the
 * compile-time and runtime registration paths cannot drift (D7).
 */
export default defineStack({
  manifest: authPluginManifestHeader,
  objects: authIdentityObjects,
  // [#8009] Declared in the same canonical source as `objects`, so the
  // compile-time and runtime registration paths cannot drift (D7).
  objectExtensions: authObjectExtensions,
});
