// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/plugin-auth
 * 
 * Authentication & Identity Plugin for ObjectStack
 * Powered by better-auth for robust, secure authentication
 * Uses ObjectQL for data persistence (no third-party ORM required)
 */

export * from './auth-plugin.js';
export * from './auth-manager.js';
export * from './ensure-default-organization.js';
// better-auth 1.7 account-identity backfill. Exported because a host that
// upgrades outside this plugin's boot path (a migration job, the cloud control
// plane) needs to stamp `sys_account.issuer` on its own schedule.
export * from './backfill-account-issuer.js';
export * from './set-initial-password.js';
export * from './admin-user-endpoints.js';
export * from './placeholder-email.js';
export * from './admin-import-users.js';
export * from './identity-write-guard.js';
// [cloud ADR-0024 D5.2 / #5892 / #5941] The break-glass guard — one invariant
// on both writes that can take the last administrator away (`banned = true`
// and deleting the `sys_user` row). Exported for the same reason its ADR-0092
// neighbour above is: a host that stands up its own ObjectQL engine (the cloud
// control plane, an embedding that skips this plugin's `kernel:ready` wiring)
// has to be able to register the invariant itself rather than ship an
// environment that can ban or delete its last administrator.
export * from './last-admin-guard.js';
// [#8317] `sys_member.role` canonicalisation — the write-path hooks and the
// one-off convergent pass. Exported for the same reason the two guards above
// are, plus one of its own: a host that upgrades outside this plugin's boot
// path still has to converge its stored rows, because every non-canonical one
// is an authorization inversion (an owner to ObjectStack, a plain member to
// better-auth's raw `split(',')`).
export * from './member-role-canonical.js';
export * from './sys-user-writable-fields.js';
export * from './otp-send-guard.js';
// ADR-0069 D2 / #4772 — the cross-node rate-limit counter store (kernel cache,
// resolved lazily) and the `cache` → better-auth `secondaryStorage` adapter.
// The adapter is exported rather than auto-wired: it also relocates the SESSION
// of record out of `sys_session`, which disables the ADR-0069 D4 session
// controls, so a host opts into that trade explicitly or not at all.
export * from './rate-limit-storage.js';
export * from './secondary-storage.js';
export * from './register-sso-provider.js';
export * from './send-verification-email.js';
export * from './objectql-adapter.js';
// [#7732] ADR-0069 D4's revoke-audit trail. Exported alongside the adapter it
// plugs into, so a host reading `sys_session` knows the one rule that governs
// those rows: a `revoked_at` row is a TOMBSTONE — an ended session kept as the
// audit record of its ending — never a live session.
export * from './session-tombstone.js';
// [#4586] The better-auth actor seam. Exported because a host that writes an
// identity table on better-auth's behalf (a control-plane provisioning hook,
// an SSO JIT path) must construct the SAME two-part context —
// `isSystem` for authorization, `attributedUserId` for attribution — rather
// than inventing a second way to say "the system did this, for that person".
export * from './auth-actor-attribution.js';
// [#8144] The `login`/`logout` ledger seam. Exported because a host that
// composes its own `databaseHooks.session.*` (the cloud does) needs the same
// mapping — and because `AuthEventAuditSurface` is the shape anything
// registering the `audit` service must satisfy.
export * from './auth-session-audit.js';
export * from './auth-schema-config.js';
// ADR-0093 — membership reconciler + tenancy service (public host API: hosts
// compose the reconciler into their own hooks; embeddings query tenancy mode).
export * from './reconcile-membership.js';
// [#7725] The other half of that invariant: what happens when better-auth tries
// to create a membership the reconciler already created. Exported alongside the
// reconciler because a host composing its own membership writes needs the same
// "the unique pair IS the membership, and acceptance never demotes" rule.
export * from './adopt-membership.js';
export * from './tenancy-service.js';
// [ADR-0108 / #3723] `./org-roles.js` is gone: there is no app-declared
// organization-role vocabulary to collect, normalize or materialize. The four
// framework roles live in `@objectstack/spec`
// (`BUILTIN_MEMBERSHIP_ROLE_OPTIONS`), which the platform objects read
// directly. An app's own business roles are POSITIONS.
export type { AuthConfig, AuthProviderConfig, AuthPluginConfig } from '@objectstack/spec/system';
