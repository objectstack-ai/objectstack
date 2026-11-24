// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Configuration → Public forms (objectstack#36444): the page's ref,
 * kept apart from `publicForms.ts` so the eager registry (`builtinComponents`)
 * imports a constant, never the page's writers.
 *
 * The entry that opens the page is a Setup navigation contribution
 * (`@objectstack/platform-objects`, `group_configuration`); this ref is what
 * that entry names, and its `requiredPermissions` is
 * {@link PUBLIC_FORMS_CAPABILITY}.
 */

import { componentRefToUrlSegments } from '../../services/componentRegistry.js';

/** The component ref of the Setup page. */
export const PUBLIC_FORMS_REF = 'forms:public-forms';

/** The capability the page and its Setup entry ask: a system administrator's. */
export const PUBLIC_FORMS_CAPABILITY = 'manage_platform_settings';

/** Where the page opens inside the Setup app. */
export function publicFormsPagePath(): string {
  return `/apps/setup/component/${componentRefToUrlSegments(PUBLIC_FORMS_REF).join('/')}`;
}
