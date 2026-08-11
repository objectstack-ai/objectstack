// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { z } from 'zod';

/**
 * # Public auth feature-flag registry (#2874)
 *
 * Classification registry for the **public `/api/v1/auth/config` `features`
 * contract** produced by plugin-auth's `getPublicConfig()`. Every boolean flag
 * served there MUST be classified here — a drift guard in plugin-auth
 * (`public-feature-registry.test.ts`) asserts the served key set ≡ this
 * registry's key set, so a new flag that ships unclassified turns CI red.
 *
 * Why: the create-user `phoneNumber` bug (#2871 / objectui#2406) was one
 * instance of a broader class — *the UI advertises a capability the runtime
 * doesn't have because the plugin behind it is off*. Manual per-site gating
 * discipline inevitably leaves silent gaps; this registry is the single place
 * where each flag's consumption surface, default semantics, and gated spec
 * inputs (or exemption rationale) are recorded and CI-enforced.
 *
 * NOT to be confused with runtime rollout toggles — those live on the
 * `feature_flags` settings manifest (ADR-0007), not in the spec (the former
 * `kernel/feature.zod.ts` `FeatureFlagSchema` was removed as an orphan: zero
 * runtime consumers once its dead capabilities-descriptor home went, #3605).
 * This registry classifies the fixed, deployment-level capability flags that
 * plugin-auth advertises to anonymous clients.
 *
 * Consumers:
 * - `ui/action.zod.ts` — `requiresFeature` sugar on actions/params is lowered
 *   at parse time (see {@link lowerRequiresFeature}) into the canonical
 *   `visible` CEL predicate using {@link featureGatePredicate}.
 * - plugin-auth drift guard (key-set equivalence with `getPublicConfig()`).
 * - platform-objects completeness guard (`feature-gate-guard.test.ts`) —
 *   every path in `gatedInputs` must carry the matching predicate, and every
 *   `features.*` reference in a `visible` predicate must be booked here.
 *
 * This module is deliberately **import-free** (type-only zod import aside) so
 * schema modules can depend on it file-directly without cycle risk, and it
 * contains constants plus pure lowering helpers only (Prime Directive #2).
 */

/**
 * Where a flag is consumed:
 * - `crud`  — admin/CRUD surface: action/param `visible` predicates rendered
 *   through objectui's `filterVisibleParams` chain. The surface this registry
 *   actively guards.
 * - `login` — objectui login/auth UI reads the flag straight off
 *   `/auth/config` (no spec metadata in between).
 * - `status` — operational status indicator, not a capability gate.
 */
export type PublicAuthFeatureSurface = 'crud' | 'login' | 'status';

/**
 * Default semantics of the flag, which decide the lowered predicate:
 * - `opt-in`     — default `false`; gate with `features.X == true`.
 * - `default-on` — default `true`; gate with `features.X != false` so a
 *   missing/undefined flag (e.g. config not yet fetched) keeps the input
 *   visible.
 */
export type PublicAuthFeatureSemantics = 'opt-in' | 'default-on';

export type PublicAuthFeatureEntry = {
  surface: PublicAuthFeatureSurface;
  semantics: PublicAuthFeatureSemantics;
  /**
   * Spec inputs gated on this flag. Path grammar:
   * `<object>.actions.<action>` or `<object>.actions.<action>.params.<name|field>`.
   * The platform-objects completeness guard resolves each path and asserts the
   * target's `visible` predicate matches {@link featureGatePredicate}.
   * Mutually exclusive with `exempt`.
   */
  gatedInputs?: readonly string[];
  /** Required when `gatedInputs` is absent — why no spec input needs gating. */
  exempt?: { reason: string };
  /** Audit notes: login-surface consumption sites, known gaps, follow-ups. */
  notes?: string;
};

/**
 * The registry. Keys mirror the boolean flags assembled in plugin-auth's
 * `getPublicConfig()` (auth-manager.ts, `features` literal) — see the drift
 * guard. Login-surface consumption sites below were audited against objectui
 * on 2026-07-15 (#2874 P2②).
 */
export const PUBLIC_AUTH_FEATURES = {
  twoFactor: {
    surface: 'crud',
    semantics: 'opt-in',
    gatedInputs: [
      'sys_user.actions.enable_two_factor',
      'sys_user.actions.disable_two_factor',
      'sys_user.actions.generate_backup_codes',
      'sys_two_factor.actions.enable_two_factor',
      'sys_two_factor.actions.disable_two_factor',
      'sys_two_factor.actions.regenerate_backup_codes',
    ],
    notes:
      'Login-surface 2FA challenge is server-driven remediation (ADR-0069), ' +
      'so the flag is intentionally unread by objectui LoginForm.',
  },
  organization: {
    surface: 'crud',
    semantics: 'default-on',
    gatedInputs: [
      'sys_user.actions.invite_user',
      'sys_member.actions.add_member',
      'sys_member.actions.update_member_role',
      'sys_member.actions.remove_member',
      'sys_member.actions.transfer_ownership',
      'sys_invitation.actions.invite_user',
      'sys_invitation.actions.cancel_invitation',
      'sys_invitation.actions.resend_invitation',
      'sys_team.actions.create_team',
      'sys_team.actions.update_team',
      'sys_team.actions.remove_team',
      'sys_team_member.actions.add_team_member',
      'sys_team_member.actions.remove_team_member',
    ],
    notes: 'Org CAPABILITY gate, not multi-org (ADR-0081 D1).',
  },
  multiOrgEnabled: {
    surface: 'crud',
    semantics: 'default-on',
    gatedInputs: [
      'sys_organization.actions.create_organization',
      'sys_organization.actions.update_organization',
      'sys_organization.actions.delete_organization',
      'sys_organization.actions.set_active_organization',
      'sys_organization.actions.leave_organization',
      'sys_organization.actions.change_slug',
    ],
    notes:
      'Reflects ACTUAL multi-tenancy capability (the tenancy posture enforces ' +
      'an organization wall — `group` or `isolated`, ADR-0093 D4 / ADR-0105 D1), ' +
      'not just the requested posture.',
  },
  degradedTenancy: {
    surface: 'status',
    semantics: 'opt-in',
    exempt: {
      reason:
        'Operator status banner (ADR-0093 D5) — signals degraded tenant ' +
        'isolation, not an input capability gate.',
    },
  },
  oidcProvider: {
    surface: 'crud',
    semantics: 'default-on',
    gatedInputs: [
      'sys_oauth_application.actions.create_oauth_application',
      'sys_oauth_application.actions.delete_oauth_application',
      'sys_oauth_application.actions.disable_oauth_application',
      'sys_oauth_application.actions.enable_oauth_application',
      'sys_oauth_application.actions.rotate_client_secret',
    ],
    notes:
      'Default-ON: the embedded OIDC authorization server follows the ' +
      'default-on MCP surface (resolveOidcProviderEnabled). Login surface ' +
      'consumes the socialProviders[] array (per-provider enabled), not this ' +
      'flag.',
  },
  sso: {
    surface: 'login',
    semantics: 'opt-in',
    exempt: {
      reason:
        'Deliberately ungated on the CRUD surface: the served value is ' +
        'refined to "usable" (≥1 provider configured) via isSsoUsable() at ' +
        '/auth/config, so gating sys_sso_provider registration actions on it ' +
        'would deadlock first-provider setup. Login consumption verified: ' +
        'objectui LoginForm gates the "Sign in with SSO" button.',
    },
  },
  ssoEnforced: {
    surface: 'login',
    semantics: 'opt-in',
    exempt: {
      reason:
        'Login-surface only: objectui LoginForm hides the password form and ' +
        'self-registration (break-glass link remains). No spec input to gate.',
    },
  },
  deviceAuthorization: {
    surface: 'login',
    semantics: 'opt-in',
    exempt: {
      reason:
        'No spec input (sys_device_code declares no actions). Known gap: ' +
        'objectui DeviceAuthPage hits the device-auth endpoints without ' +
        'checking this flag (absent from its client type) — tracked in ' +
        'objectui#2513 (#2874 P2②).',
    },
  },
  admin: {
    surface: 'crud',
    semantics: 'opt-in',
    gatedInputs: [
      'sys_user.actions.create_user',
      'sys_user.actions.ban_user',
      'sys_user.actions.unban_user',
      'sys_user.actions.unlock_user',
      'sys_user.actions.set_user_password',
      'sys_user.actions.set_user_role',
      'sys_user.actions.impersonate_user',
    ],
    notes: 'SCIM forces the admin plugin (and this flag) on — ADR-0071.',
  },
  phoneNumber: {
    surface: 'crud',
    semantics: 'opt-in',
    gatedInputs: ['sys_user.actions.create_user.params.phoneNumber'],
    notes:
      'The original #2871 fix. Also read by objectui LoginForm for the ' +
      'phone+password sign-in mode.',
  },
  phoneNumberOtp: {
    surface: 'login',
    semantics: 'opt-in',
    exempt: {
      reason:
        'Login-surface only: gates the "sign in with verification code" link ' +
        '(LoginForm) and the phone branch of forgot-password. Only advertised ' +
        'when SMS is actually deliverable (#2780).',
    },
  },
} as const satisfies Record<string, PublicAuthFeatureEntry>;

export type PublicAuthFeatureName = keyof typeof PUBLIC_AUTH_FEATURES;

/** Tuple of registry keys — feeds `z.enum(...)` for the `requiresFeature` sugar. */
export const PUBLIC_AUTH_FEATURE_NAMES = Object.keys(PUBLIC_AUTH_FEATURES) as [
  PublicAuthFeatureName,
  ...PublicAuthFeatureName[],
];

/**
 * Non-boolean keys `getPublicConfig()` may spread into `features` (legal-link
 * URLs; the tenancy posture). Exempt from FLAG classification — a flag is a
 * boolean capability gate, and these are values — but the drift guard still
 * asserts no OTHER non-boolean key sneaks in.
 *
 * `tenancyPosture` (ADR-0105 D1) reports WHICH of `single` | `group` |
 * `isolated` is in force. It gates nothing: `multiOrgEnabled` remains the
 * boolean capability gate ("is an organization wall enforced at all?"), while
 * this tells the console how to render org context — under `group` the org
 * switcher picks the WRITE target and reads span every organization the member
 * belongs to.
 */
export const PUBLIC_AUTH_CONFIG_NON_FLAG_KEYS = ['termsUrl', 'privacyUrl', 'tenancyPosture'] as const;

/**
 * Capabilities that are RESERVED but deliberately **not advertised** — the
 * server-side plugin flag may exist in `AuthPluginConfig`, but nothing is
 * published on `/api/v1/auth/config` because no consumer can act on it.
 *
 * Why this list exists rather than a registry entry: {@link PUBLIC_AUTH_FEATURES}
 * classifies flags that ARE served (the plugin-auth drift guard asserts key-set
 * equivalence with `getPublicConfig()`), so an unserved flag has no honest entry
 * shape there — and leaving it served-but-exempt is precisely what this list
 * records the retirement of. Membership here is the *negative* record: these
 * names must be absent from {@link PUBLIC_AUTH_FEATURES}, absent from the
 * `features` payload, and therefore un-gateable via `requiresFeature`.
 *
 * - `passkeys` / `magicLink` (#7481, maintainer ruling 2026-08-11): both were
 *   advertised from introduction with no login UI at either consumer — an
 *   advertised-but-unconsumed capability, so a deployer could flip a flag that
 *   did nothing anywhere. objectui#2514 documented them as reserved on the
 *   consumer side (objectui PR #4182) and closed; the login UI that would make
 *   them real is scoped as **objectui#4179**. They return to
 *   {@link PUBLIC_AUTH_FEATURES} in the change that ships that UI — not before.
 *
 * `magicLink` remains a live **server** capability (`AuthPluginConfig.plugins.magicLink`
 * still wires better-auth's magic-link endpoints); what was withdrawn is the
 * public advertisement of it, not the endpoints.
 */
export const PUBLIC_AUTH_FEATURES_NOT_ADVERTISED = ['passkeys', 'magicLink'] as const;

/**
 * The canonical CEL gate for a flag, per its default semantics:
 * `opt-in` → `features.X == true`; `default-on` → `features.X != false`
 * (so an absent flag — e.g. config not yet fetched — fails open).
 */
export function featureGatePredicate(name: PublicAuthFeatureName): string {
  const op = PUBLIC_AUTH_FEATURES[name].semantics === 'opt-in' ? '== true' : '!= false';
  return `features.${name} ${op}`;
}

/** Object shape the lowering transform operates on (post field-level parse). */
type WithRequiresFeature = {
  requiresFeature?: PublicAuthFeatureName;
  /**
   * Already normalized by ExpressionInputSchema to the `{dialect, source}`
   * envelope — except for the literal arm, which surfaces here verbatim on the
   * surfaces that declare one (`ActionSchema.visible`, #5970).
   */
  visible?: boolean | ({ dialect?: unknown; source?: unknown } & Record<string, unknown>);
};

/**
 * Lower the declarative `requiresFeature: '<flag>'` sugar into the canonical
 * `visible` CEL predicate and strip the sugar key from the output — mirroring
 * `normalizeVisibleWhen` (ADR-0089): persisted artifacts, lint, runtime, and
 * objectui only ever see the canonical envelope.
 *
 * - No existing `visible` → `{ dialect: 'cel', source: <gate> }`, string-equal
 *   to the hand-written gates it replaces.
 * - Existing CEL `visible` with a `source` → composed as
 *   `(<existing>) && <gate>` (existing predicate first, gate last — the
 *   hand-written convention).
 * - Existing `visible: true` → the gate alone. `true && <gate>` IS `<gate>`, so
 *   an author who spelled the default out explicitly gets the same lowering as
 *   one who omitted the key (the literal arm arrived with #5970).
 * - Existing `visible: false` → loud parse error. Here the boolean algebra runs
 *   the other way: `false && <gate>` is `false` whatever the flag says, so the
 *   gate could never take effect and the declaration is inert on arrival —
 *   precisely the parses-clean-changes-nothing key ADR-0078 exists to reject.
 *   Drop one of the two rather than shipping a gate that reads as load-bearing.
 * - Existing `visible` that is non-CEL or AST-only → loud parse error
 *   (ADR-0078 no-silently-inert); write the combined predicate by hand.
 *
 * Designed as a zod `.transform((v, ctx) => lowerRequiresFeature(v, ctx))`
 * appended after the schema's refinements.
 */
export function lowerRequiresFeature<T extends WithRequiresFeature>(
  input: T,
  ctx: z.core.$RefinementCtx,
): Omit<T, 'requiresFeature'> {
  const { requiresFeature, ...rest } = input;
  if (requiresFeature === undefined) return rest as Omit<T, 'requiresFeature'>;

  const gate = featureGatePredicate(requiresFeature);
  // Annotated rather than inferred: `rest` is a generic `Omit<T, …>`, so
  // `rest.visible` is a deferred indexed access that control flow cannot narrow
  // — the `=== true` / `=== false` guards below would not strip the boolean arm
  // off it, and the envelope spread at the end would not compile.
  const existing: WithRequiresFeature['visible'] = rest.visible;
  // `true` is the explicit spelling of "no gate of my own" — same lowering as an
  // absent key. `false` can never be gated into visibility, so it is refused.
  if (existing === undefined || existing === true) {
    return { ...rest, visible: { dialect: 'cel', source: gate } } as Omit<T, 'requiresFeature'>;
  }
  if (existing === false) {
    ctx.addIssue({
      code: 'custom',
      path: ['requiresFeature'],
      message:
        '`requiresFeature` cannot compose with `visible: false` — the literal already hides this ' +
        'unconditionally, so the feature gate can never take effect. Drop `requiresFeature` to keep it ' +
        'hidden, or drop `visible: false` to let the flag decide.',
    });
    return rest as Omit<T, 'requiresFeature'>;
  }
  if (existing.dialect !== 'cel' || typeof existing.source !== 'string') {
    ctx.addIssue({
      code: 'custom',
      path: ['requiresFeature'],
      message:
        '`requiresFeature` composes only with a CEL `visible` carrying a `source` string; ' +
        'this expression is AST-only or non-CEL — write the combined predicate by hand.',
    });
    return rest as Omit<T, 'requiresFeature'>;
  }
  return {
    ...rest,
    visible: { ...existing, source: `(${existing.source}) && ${gate}` },
  } as Omit<T, 'requiresFeature'>;
}
