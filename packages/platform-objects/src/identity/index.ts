// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * platform-objects/identity — Identity & Authentication Platform Objects
 *
 * Canonical ObjectSchema definitions for all authentication-related system objects.
 */

// ── Core Auth Objects ──────────────────────────────────────────────────────
export { SysUser } from './sys-user.object.js';
export { SysSession } from './sys-session.object.js';
export { SysAccount } from './sys-account.object.js';
export { SysVerification } from './sys-verification.object.js';

// ── Organization Objects ───────────────────────────────────────────────────
export { SysOrganization } from './sys-organization.object.js';
export { SysMember } from './sys-member.object.js';
export { SysInvitation } from './sys-invitation.object.js';
export { SysTeam } from './sys-team.object.js';
export { SysTeamMember } from './sys-team-member.object.js';

// ── Org Skeleton (hierarchical, distinct from flat sys_team) ────────────────
export { SysBusinessUnit } from './sys-business-unit.object.js';
export { SysBusinessUnitMember } from './sys-business-unit-member.object.js';

// ── Additional Auth Objects ────────────────────────────────────────────────
export { SysApiKey } from './sys-api-key.object.js';
export { SysTwoFactor } from './sys-two-factor.object.js';
export { SysDeviceCode } from './sys-device-code.object.js';
export { SysUserPreference } from './sys-user-preference.object.js';

// ── OIDC Provider Objects ──────────────────────────────────────────────────
export { SysOauthApplication } from './sys-oauth-application.object.js';
export { SysOauthAccessToken } from './sys-oauth-access-token.object.js';
export { SysOauthRefreshToken } from './sys-oauth-refresh-token.object.js';
export { SysOauthConsent } from './sys-oauth-consent.object.js';
export { SysJwks } from './sys-jwks.object.js';

// ── External SSO (relying-party, @better-auth/sso) ─────────────────
export { SysSsoProvider } from './sys-sso-provider.object.js';
