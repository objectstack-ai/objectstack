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
 * Membership is derived by this package's doc namespace (`include: 'studio_*'`),
 * so a page this package adds later under that prefix is gated the same way
 * with no edit here. Not `'*'`: a package scope drops only a doc stamped with
 * ANOTHER package, so a stored doc bound to no package (ADR-0070) is in every
 * scope, and a catch-all would claim it and gate it on `studio.access` too.
 */
export const STUDIO_MANUAL_BOOK: Book = {
  name: 'studio_manual',
  label: 'Studio',
  slug: 'studio',
  audience: { systemPermission: 'studio.access' },
  groups: [{ key: 'all', label: 'Documentation', include: 'studio_*' }],
};
