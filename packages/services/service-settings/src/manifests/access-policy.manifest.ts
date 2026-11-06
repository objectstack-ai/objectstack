// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SettingsManifest } from '@objectstack/spec/system';

/**
 * [ADR-0069 TL;DR 6] An organization's own access policy (ruling of record on
 * objectstack-ai/cloud#3668, 「支持按组织（推荐）」): the allowed IP ranges, the
 * idle, absolute and concurrent session limits and the multi-factor
 * requirement, one row per organization (scope `tenant`, ADR-0131), written by
 * the organization's administrators (`setup.write`, the tenant manifests'
 * permission — `organization_admin` holds it).
 *
 * Each key is the twin of the `auth` key of the same name, which is the
 * deployment's value: the default AND the floor. An organization may tighten
 * and never loosen; each key's zero value (empty, `0`, `off`) means "nothing
 * beyond the deployment's". plugin-auth enforces it — the save checks it
 * registers on these keys refuse a weaker value, and enforcement combines the
 * two values so the floor holds whatever is stored. The rule per key is the
 * table in plugin-auth's `organization-access-policy.ts`.
 */
const manifest = {
  namespace: 'access_policy',
  version: 1,
  label: 'Access policy',
  icon: 'ShieldCheck',
  description:
    "This organization's sign-in restrictions. The deployment's authentication settings always apply; these can only add to them.",
  scope: 'tenant',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  category: 'Security',
  order: 16,
  specifiers: [
    {
      type: 'group',
      id: 'network',
      label: 'Network',
      required: false,
      description: 'Where members of this organization may sign in from.',
    },
    {
      type: 'textarea',
      key: 'allowed_ip_ranges',
      label: 'Allowed IP ranges',
      required: false,
      description:
        "CIDR ranges or exact IPs (one per line, or comma-separated), e.g. 203.0.113.0/24. When set, a member's session is not opened for this organization from outside these ranges, and a session that comes from outside them later is signed out; so is any request whose client address the server cannot establish. Each range must lie inside the deployment's allowed IP ranges, when it sets any, and the list must include the address you save it from. Empty = only the deployment's ranges apply. Platform administrators are held to the deployment's ranges only.",
    },
    {
      type: 'group',
      id: 'sessions',
      label: 'Sessions',
      required: false,
      description: "How long a member's session stays valid. Each limit can only be shorter than the deployment's.",
    },
    {
      type: 'number',
      key: 'session_idle_timeout_minutes',
      label: 'Idle timeout (minutes)',
      required: false,
      default: 0,
      min: 0,
      max: 10080,
      description:
        "Sign a member out after this many minutes of inactivity. No longer than the deployment's idle timeout when it sets one. 0 = the deployment's idle timeout.",
    },
    {
      type: 'number',
      key: 'session_absolute_max_hours',
      label: 'Absolute session lifetime (hours)',
      required: false,
      default: 0,
      min: 0,
      max: 8760,
      description:
        "Force re-authentication this many hours after sign-in, regardless of activity. No longer than the deployment's lifetime when it sets one. 0 = the deployment's lifetime.",
    },
    {
      type: 'number',
      key: 'max_concurrent_sessions_per_user',
      label: 'Max concurrent sessions per user',
      required: false,
      default: 0,
      min: 0,
      max: 100,
      description:
        "Cap a member's simultaneous signed-in sessions in this organization; the oldest of them are signed out past the cap, and sessions in other organizations are not counted or signed out. Checked at sign-in and when a member switches into this organization. No higher than the deployment's cap when it sets one, which still counts all of a member's sessions. 0 = the deployment's cap only.",
    },
    {
      type: 'group',
      id: 'multi_factor',
      label: 'Multi-factor',
      required: false,
      description: 'Who in this organization must protect their account with an authenticator app (TOTP).',
    },
    {
      type: 'select',
      key: 'mfa_required',
      label: 'Require multi-factor authentication',
      required: false,
      default: 'off',
      options: [
        { value: 'off', label: 'Off' },
        { value: 'administrators', label: 'Administrators' },
        { value: 'everyone', label: 'Everyone' },
      ],
      description:
        "Who must use an authenticator app: administrators (platform, organization and delegated administrators) or everyone. Those required who have not enrolled are blocked from data once the deployment's grace period ends. A level weaker than the deployment's is refused; Off = the deployment's requirement. Needs two-factor authentication on for this deployment; while it is off, saving a requirement is refused.",
    },
  ],
};

/** Access policy — one organization's sign-in restrictions, held to the deployment's `auth` values. */
export const accessPolicySettingsManifest = manifest as unknown as SettingsManifest;
