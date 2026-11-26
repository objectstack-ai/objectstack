// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Book } from '@objectstack/spec/system';

/**
 * The Setup app's manual (ADR-0046 §6), registered beside its docs.
 *
 * Its job is the `audience`: Setup's pages are administrator help, so they are
 * read by exactly the callers who may open the Setup app — whoever holds
 * `setup.access` (the app's `requiredPermissions`), through ANY permission set
 * (`organization_admin`, `admin_full_access`, a delegated-admin set an
 * application authors). A `{ permissionSet }` audience would name one of
 * those sets and shut out the holders of every other one.
 *
 * Membership is derived by this package's doc namespace (`include: 'setup_*'`),
 * so a page this package adds later under that prefix is gated the same way
 * with no edit here. Not `'*'`: a package scope drops only a doc stamped with
 * ANOTHER package, so a stored doc bound to no package (ADR-0070) is in every
 * scope, and a catch-all would claim it and gate it on `setup.access` too.
 * Without a book claiming them, the docs fall back to `org` (§3.6): listed
 * only to admins by the Console's docs index, but readable at their address,
 * and through `?include=content`, by every member.
 */
export const SETUP_MANUAL_BOOK: Book = {
  name: 'setup_manual',
  label: 'Setup',
  slug: 'setup',
  audience: { systemPermission: 'setup.access' },
  groups: [{ key: 'all', label: 'Documentation', include: 'setup_*' }],
};
