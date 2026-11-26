// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Book } from '@objectstack/spec/system';

/**
 * The Studio app's manual (ADR-0046 §6), registered beside its docs.
 *
 * Its job is the `audience`: Studio's pages are builder help, so they are read
 * by exactly the callers who may open the Studio app — whoever holds
 * `studio.access` (the app's `requiredPermissions`), through ANY permission
 * set. A `{ permissionSet }` audience would name one set and shut out the
 * holders of every other one.
 *
 * Membership is derived (`include: '*'` over this package's own docs), so a
 * page this package adds later is gated the same way with no edit here.
 */
export const STUDIO_MANUAL_BOOK: Book = {
  name: 'studio_manual',
  label: 'Studio',
  slug: 'studio',
  audience: { systemPermission: 'studio.access' },
  groups: [{ key: 'all', label: 'Documentation', include: '*' }],
};
