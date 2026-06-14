// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Doc } from '@objectstack/spec/system';

/**
 * Setup app overview doc (ADR-0046), registered in this package's manifest so
 * it groups under "Setup" in the `/_console/docs` index.
 *
 * Authored inline rather than as a flat `src/docs/*.md` file because this is a
 * TS-first code package built by tsup, not a user app built by `os build` —
 * `defineStack({ docs })` / manifest `docs[]` is the supported path for those
 * (see `DocSchema` in `@objectstack/spec/system`). The `content` below is plain
 * CommonMark + GFM with no images/MDX, per ADR-0046 §3.4.
 *
 * Principle (from the HotCRM reference docs): document the *invisible* concepts,
 * not what the Setup UI already shows on screen.
 */
export const SETUP_OVERVIEW_DOC: Doc = {
  name: 'setup_overview',
  label: 'Setup overview',
  description: 'Orientation for administrators: users, roles & permissions, and record visibility.',
  content: `# Setup overview

Setup is the administrator app for the platform. Its screens are mostly
self-explanatory — this page covers the concepts behind them that the UI does
not make obvious. For the full reference, see <https://docs.objectstack.ai>.

## Users & authentication

Every person who signs in is a \`sys_user\` record. Authentication (passwords,
SSO, API keys, sessions) is handled by the platform's auth layer, so creating a
user here grants *identity*, not access — what they can do is decided entirely
by the roles and permissions assigned to them. Deactivating a user revokes
sign-in without deleting their records, preserving ownership and history.

## Roles & permissions

Permission sets define *what* a user can do (which objects and fields they can
read or write, which apps they can open); roles place a user in the
organization hierarchy and drive *which records* they can reach. A user's
effective access is the union of all permission sets granted to them — access is
additive, so you grant capability rather than taking it away.

## Record visibility (sharing)

Object-level permissions decide whether a user can touch a *kind* of record;
sharing decides *which* rows of that kind they actually see. Visibility starts
from an org-wide default (private or public) and is then widened by the role
hierarchy and explicit sharing rules — it is never silently narrowed. When a
user "can't see a record they should," the cause is almost always sharing, not
object permissions.

See <https://docs.objectstack.ai> for the full security model.
`,
};
