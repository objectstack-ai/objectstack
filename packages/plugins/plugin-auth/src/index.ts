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
export * from './sys-user-writable-fields.js';
export * from './otp-send-guard.js';
export * from './register-sso-provider.js';
export * from './send-verification-email.js';
export * from './objectql-adapter.js';
export * from './auth-schema-config.js';
// ADR-0093 — membership reconciler + tenancy service (public host API: hosts
// compose the reconciler into their own hooks; embeddings query tenancy mode).
export * from './reconcile-membership.js';
export * from './tenancy-service.js';
// [ADR-0108 / #3723] `./org-roles.js` is gone: there is no app-declared
// organization-role vocabulary to collect, normalize or materialize. The four
// framework roles live in `@objectstack/spec`
// (`BUILTIN_MEMBERSHIP_ROLE_OPTIONS`), which the platform objects read
// directly. An app's own business roles are POSITIONS.
export type { AuthConfig, AuthProviderConfig, AuthPluginConfig } from '@objectstack/spec/system';
