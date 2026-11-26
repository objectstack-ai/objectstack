// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Access control → Positions and permissions: the page's ref, path and
 * gate, kept apart from `accessDirectory.ts` so the eager registry
 * (`builtinComponents`) imports constants, never the routing model's imports.
 *
 * The entry that opens the page is a Setup navigation contribution
 * (`@objectstack/platform-objects`, `group_access_control`); this ref is what
 * that entry names, and its `requiredPermissions` is
 * {@link ACCESS_DIRECTORY_CAPABILITY}.
 */

import { componentRefToUrlSegments } from '../../services/componentRegistry.js';

/** The component ref of the Setup page. */
export const ACCESS_DIRECTORY_REF = 'security:access-directory';

/**
 * The capability the page and its Setup entry ask on top of Setup's own entry:
 * Studio's entry capability, the one that admitted a principal to the
 * directory while it was in Studio. Moving the page must not widen who sees it.
 */
export const ACCESS_DIRECTORY_CAPABILITY = 'studio.access';

/** The page's root inside the Setup app. */
export const ACCESS_DIRECTORY_PATH = `/apps/setup/component/${componentRefToUrlSegments(ACCESS_DIRECTORY_REF).join('/')}`;

/** The Setup app's entry capability: who may open a Setup page at all. */
export const SETUP_ACCESS_CAPABILITY = 'setup.access';

/**
 * Whether a capability set opens Setup, so Studio may send the environment
 * catalog's lists to Setup's page (objectstack#37565). Without it they stay on
 * Studio's cross-package leg, where they were: a Studio author who cannot open
 * Setup keeps the lists. `undefined` (no answer reported) holds nothing.
 */
export function holdsSetupAccess(systemPermissions: readonly string[] | undefined): boolean {
  return Array.isArray(systemPermissions) && systemPermissions.includes(SETUP_ACCESS_CAPABILITY);
}
