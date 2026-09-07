// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Walled-posture MEMBERSHIP-POLICY gate (cloud#1092) — a deployment that puts
// up the organization wall must SAY what a new user joins.
//
// ## What went wrong before
//
// On a walled posture (`isolated` / `group`) a deployment that never
// configured `auth.membership_policy` runs the framework default, `auto`.
// `auto` means "bind every newly created user to this deployment's default
// organization". Today that binds nobody — but only as a SIDE EFFECT: under a
// wall `TenancyService.defaultOrgId()` refuses to guess a target org (ADR-0093
// D3), so the reconciler answers `no-target-org` and writes nothing.
//
// The end state is right and was never declared. `no-target-org` and
// `policy-skip` look identical from outside, so "the new user has no
// organization" is green on an undeclared deployment and locks in nothing. The
// posture resolution underneath has already regressed once (cloud#957 / #962:
// self-serve sign-ups landed as `member` of a stranger's organization, able to
// list and open that org's environments), and the day it degrades again the
// same undeclared deployment starts auto-joining strangers — silently, because
// nothing ever claimed otherwise. cloud#1012 raised exactly this; PR #1091 made
// the policy configurable and left the undeclared case open.
//
// ## The shape
//
// Refuse to boot. Not warn: warnings on a boot screen are read once and then
// scrolled past, and the maintainer's ruling on cloud#1092 (2026-08-04) is that
// `declared = enforced` lands in one step rather than through a warn → refuse
// migration nobody would be around to complete.
//
// That ruling was argued from EE having no deployed customers — zero breakage
// surface — and that argument does NOT transfer to open core. The conclusion
// does, from a fact anyone can check instead: on the day this gate arrived in
// the open tree, no open installation could reach a walled posture at all.
// `serve` treats every posture but `single` as multi-tenant and refuses the
// boot when no `org-scoping` runtime is present (ADR-0093 D5); the only way
// past that refusal was `OS_ALLOW_DEGRADED_TENANCY=1`, which leaves the runtime
// unmounted — so this gate never ran on any open deployment either. The
// breakage surface at the moment of the move is genuinely zero, and it is zero
// for a reason a reader can re-derive from `serve.ts` rather than from a
// customer count. ADR-0132 is the record.
//
// The gate lives HERE, in the package that implements the wall, for the same
// reason cloud#1020's licensing gate does: the component that needs the
// guarantee answers for it, so no host can forget it and no new knob can route
// around it. That reasoning is about the WALL, not about the entitlement — the
// licence gate stays in the commercial runtime (ADR-0132 boundary 1), and this
// one moved with the wall it guards.
//
// ## What counts as a declaration
//
// DECLARED vs DEFAULTED is the whole question, so the gate reads the settings
// service's own `source` for `auth.membership_policy` rather than its value:
//
//   • `env` (`OS_AUTH_MEMBERSHIP_POLICY`) or a stored row (`global` / `tenant`
//     / `user`) — an operator wrote it. ALLOWED, including explicit `auto`:
//     knowingly accepting automatic joins is a decision, and this gate exists
//     to force the decision, not to pick it.
//   • `default` — the manifest default (`auto`) nobody chose. REFUSED.
//   • a declared value outside the closed vocabulary (a typo'd `invite_only`
//     through the env, which bypasses the settings option table) — REFUSED.
//     The framework logs an error and keeps running `auto`, so the operator
//     believes the wall is up while every sign-up is auto-bound. That is the
//     failure this gate is for, wearing a different hat.
//
// A host may also declare the policy where it constructs `AuthPlugin`
// (`membershipPolicy: 'invite-only'` — what the cloud control plane's preset
// does). No setting is involved there, so the gate accepts any EFFECTIVE
// policy that is not `auto`: a non-default policy cannot arrive by accident.
//
// ## Deliberate NON-features
//
//  • **No env escape hatch.** `OS_ALLOW_DEGRADED_TENANCY=1` does NOT open this
//    gate (it covers an ABSENT multi-org runtime, ADR-0093 D5), and neither
//    does a licence. The remedy for this refusal is to configure the policy —
//    which is one env variable or one Setup toggle away, on purpose.
//  • **No `single`-posture check.** An unwalled deployment has one
//    organization; `auto` there is the documented, harmless product default.
//    Non-walled postures see no check and no behavior change at all.

import { isMembershipPolicy, MEMBERSHIP_POLICIES } from '@objectstack/plugin-auth';
import { resolveTenancyPosture } from '@objectstack/types';

/** The settings key this gate adjudicates, in the framework's `auth` namespace. */
export const MEMBERSHIP_POLICY_SETTING = 'auth.membership_policy';

/** The env pathway the settings service accepts for {@link MEMBERSHIP_POLICY_SETTING}. */
export const MEMBERSHIP_POLICY_ENV = 'OS_AUTH_MEMBERSHIP_POLICY';

/** Stable, cross-module-instance discriminator for this refusal. */
export const MEMBERSHIP_POLICY_ERROR_CODE = 'WALLED_MEMBERSHIP_POLICY_UNDECLARED';

/**
 * A refusal on DECLARATION grounds — deliberately distinct from cloud#1020's
 * `MULTI_ORG_NOT_LICENSED` (authorization) and from ADR-0093 D5's
 * "the multi-org runtime could not be loaded" (capability absence). All
 * three refuse the same boot for different reasons with different remedies, so
 * every message says which one it is in its first sentence.
 */
export class WalledMembershipPolicyError extends Error {
  /** Structural tag — survives duplicate module instances, unlike `instanceof`. */
  readonly code = MEMBERSHIP_POLICY_ERROR_CODE;

  /** The walled posture this deployment requested. */
  readonly posture: string;

  /** What the gate found, for hosts that want to re-report it structurally. */
  readonly declaration: MembershipPolicyDeclaration;

  constructor(message: string, posture: string, declaration: MembershipPolicyDeclaration) {
    super(message);
    this.name = 'WalledMembershipPolicyError';
    this.posture = posture;
    this.declaration = declaration;
  }
}

/**
 * Whether an unknown error is this gate's refusal.
 *
 * Structural (`code`), not `instanceof`: hosts reach this package through a
 * dynamic `import()` and may hold a different module instance than the thrower
 * — a multi-kernel host that imports this package per environment is exactly
 * that case.
 */
export function isWalledMembershipPolicyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === MEMBERSHIP_POLICY_ERROR_CODE
  );
}

/**
 * Where the configured value came from. The first four are the settings
 * service's own `source` values; `unreadable` is this gate's own verdict when
 * the `auth` namespace could not be consulted at all.
 */
export type MembershipPolicySource = 'env' | 'global' | 'tenant' | 'user' | 'default' | 'unreadable';

export interface MembershipPolicyDeclaration {
  /** True when an operator wrote the value (env or a stored row). */
  declared: boolean;
  /** True when a DECLARED value is outside {@link MEMBERSHIP_POLICIES}. */
  invalid: boolean;
  /** Where the value came from. */
  source: MembershipPolicySource;
  /** The raw configured value, exactly as the settings service reports it. */
  configured: unknown;
  /** Why the namespace could not be read — set only when `source` is `unreadable`. */
  readError?: string;
}

/** The slice of the settings service this gate needs. Structural on purpose. */
export interface MembershipPolicySettingsSurface {
  getNamespace(
    namespace: string,
    ctx?: unknown,
  ): Promise<{ values?: Record<string, { value?: unknown; source?: unknown } | undefined> }>;
}

/** The slice of the `auth` service this gate needs (plugin-auth's AuthManager). */
export interface MembershipPolicyAuthSurface {
  getMembershipPolicy(): string;
}

/** The slice of `PluginContext` this gate needs. */
export interface MembershipPolicyProbe {
  getService(name: string): unknown;
  // `meta` is `Record<string, any>` to stay assignable from the framework's
  // `PluginContext['logger']`, whose parameter is exactly that — a narrower
  // `unknown` here would make every real ctx fail to satisfy this interface.
  logger?: {
    info?: (msg: string, meta?: Record<string, any>) => void;
    warn?: (msg: string, meta?: Record<string, any>) => void;
  };
}

/** `ctx.getService`, without the throw — an absent service is a normal answer here. */
function probeService<T>(ctx: MembershipPolicyProbe, name: string): T | undefined {
  try {
    return (ctx.getService(name) as T | undefined) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read what this deployment DECLARED for {@link MEMBERSHIP_POLICY_SETTING}.
 *
 * Total — never throws. `unreadable` is a distinct outcome from `default` on
 * purpose: "nobody chose" and "we could not find out" need different messages,
 * because on an unreadable kernel `OS_AUTH_MEMBERSHIP_POLICY` is inert and
 * telling the operator to set it would be a lie.
 */
export async function readMembershipPolicyDeclaration(
  settings: MembershipPolicySettingsSurface | undefined,
): Promise<MembershipPolicyDeclaration> {
  const unreadable = (readError: string): MembershipPolicyDeclaration => ({
    declared: false,
    invalid: false,
    source: 'unreadable',
    configured: undefined,
    readError,
  });

  if (!settings || typeof settings.getNamespace !== 'function') {
    return unreadable('no `settings` service is registered on this kernel');
  }

  let payload: Awaited<ReturnType<MembershipPolicySettingsSurface['getNamespace']>>;
  try {
    payload = await settings.getNamespace('auth');
  } catch (e) {
    return unreadable(`reading the \`auth\` settings namespace failed: ${(e as Error)?.message ?? e}`);
  }

  const entry = payload?.values?.membership_policy;
  if (!entry) {
    return unreadable(
      'the `auth` settings namespace does not carry a `membership_policy` key on this kernel',
    );
  }

  const source = String(entry.source ?? 'default') as MembershipPolicySource;
  const declared = source !== 'default';
  return {
    declared,
    invalid: declared && !isMembershipPolicy(entry.value),
    source,
    configured: entry.value,
  };
}

/** Why the gate refused — selects the middle paragraphs of the message. */
type RefusalReason = 'undeclared' | 'invalid' | 'unreadable';

function refusalReason(declaration: MembershipPolicyDeclaration): RefusalReason {
  if (declaration.source === 'unreadable') return 'unreadable';
  if (declaration.invalid) return 'invalid';
  return 'undeclared';
}

/**
 * The operator-facing refusal, in cloud#1020's licensing-gate register. Every
 * block is load-bearing:
 *
 *  - the first sentence names DECLARATION as the failure, and rules out the two
 *    neighbouring refusals (licence, missing package) outright — an operator who
 *    has met either of those will otherwise reach for their remedies first;
 *  - it explains why an outcome that looks correct today is still refused,
 *    because "but no user is being auto-joined" is the obvious objection;
 *  - it lists BOTH ways forward, `auto` included, so it reads as "decide", not
 *    as "we picked invite-only for you".
 */
export function walledMembershipPolicyFatalMessage(
  posture: string,
  declaration: MembershipPolicyDeclaration,
): string {
  const reason = refusalReason(declaration);
  const vocabulary = MEMBERSHIP_POLICIES.join(' | ');

  const found: string[] =
    reason === 'unreadable'
      ? [
          `    membership policy : UNKNOWN — ${declaration.readError}`,
          `    setting key       : ${MEMBERSHIP_POLICY_SETTING} (env: ${MEMBERSHIP_POLICY_ENV})`,
          `    tenancy posture   : ${posture}`,
        ]
      : [
          `    membership policy : ${JSON.stringify(declaration.configured)} (source: ${declaration.source}${declaration.source === 'default' ? ' — nobody configured it' : ''})`,
          `    setting key       : ${MEMBERSHIP_POLICY_SETTING} (env: ${MEMBERSHIP_POLICY_ENV})`,
          `    tenancy posture   : ${posture}`,
        ];

  const why: string[] =
    reason === 'invalid'
      ? [
          `    ${JSON.stringify(declaration.configured)} is not a membership policy. The closed vocabulary is`,
          `    ${vocabulary} (framework \`MEMBERSHIP_POLICIES\`), and the framework REJECTS an`,
          '    unrecognised value rather than coercing it — so this deployment is running `auto`',
          '    while its configuration says something else. An operator reading that configuration',
          '    believes the wall decides membership; every new user is auto-join eligible instead.',
          '    Refusing to boot on a policy that was set but never took effect.',
        ]
      : reason === 'unreadable'
        ? [
            '    A walled deployment decides what a NEW USER joins, and this kernel cannot be asked',
            '    what it decided — so the answer in force is the framework default, `auto`: bind every',
            '    newly created user to the default organization. Refusing to boot on a wall whose',
            '    membership rule cannot be established.',
          ]
        : [
            '    A walled deployment decides what a NEW USER joins. This one has not: the effective',
            '    policy is `auto` — bind every newly created user to this deployment\'s default',
            '    organization — purely because nothing ever set it.',
            '',
            '    That binds nobody TODAY, but only as a side effect: under a wall the framework',
            '    refuses to guess a target organization (ADR-0093 D3), so the reconciler answers',
            '    `no-target-org` and writes nothing. An outcome, not a declaration — and the',
            // The tracker ids this sentence used to carry (cloud#957 / #962) are
            // in the header instead — an operator reading a boot refusal has no
            // tracker to resolve them against.
            '    resolution underneath has already regressed once: self-serve sign-ups landed',
            '    inside a stranger\'s organization. The day it degrades again, this',
            '    deployment starts auto-joining strangers without anything having claimed otherwise.',
          ];

  const remedy: string[] =
    reason === 'unreadable'
      ? [
          '    Fix one of:',
          '      • mount the platform settings service (@objectstack/service-settings) so',
          `        ${MEMBERSHIP_POLICY_SETTING} — and ${MEMBERSHIP_POLICY_ENV} — resolve here, then`,
          '        declare the policy, or',
          '      • declare it where this host constructs AuthPlugin:',
          "        `new AuthPlugin({ membershipPolicy: 'invite-only' })` (what the cloud control",
          '        plane does), or',
          '      • run single-organization: set OS_TENANCY_POSTURE=single.',
        ]
      : [
          '    Fix one of — EITHER is a declaration, and that is the entire point:',
          '      • invitation only, what a walled deployment almost always wants: set',
          `        ${MEMBERSHIP_POLICY_ENV}=invite-only, or Setup → Authentication →`,
          '        Membership → "Invitation only". Membership then comes solely from an explicit',
          '        act — creating a workspace, accepting an invitation, an admin adding you, SSO',
          '        just-in-time provisioning; or',
          `      • knowingly accept automatic joins: set ${MEMBERSHIP_POLICY_ENV}=auto`,
          '        (or pick "Join the default organization automatically" in Setup). Boot then',
          '        proceeds with exactly the behavior above — declared this time, so it survives',
          '        a change in how the posture resolves; or',
          '      • run single-organization: set OS_TENANCY_POSTURE=single, where `auto` is the',
          '        documented product default and this gate does not apply.',
        ];

  // The headline states which of the three refusals this is. "Never declared"
  // would be a lie on the other two, and an operator who typo'd the env value
  // would spend the first minute looking for a setting they know they set.
  const headline =
    reason === 'invalid'
      ? `✖ FATAL: tenancy posture '${posture}' is walled, and its membership policy is not one this runtime can enforce.`
      : reason === 'unreadable'
        ? `✖ FATAL: tenancy posture '${posture}' is walled, and its membership policy cannot be established on this kernel.`
        : `✖ FATAL: tenancy posture '${posture}' is walled, but this deployment never declared a membership policy.`;

  return [
    headline,
    '',
    ...why,
    '',
    '    This is NOT a licensing failure and NOT a missing package: the multi-org runtime is',
    '    present and about to enforce the wall. Do not chase either.',
    '',
    ...found,
    '',
    ...remedy,
    '',
    // ⛔ No tracker id in the rendered text (`pnpm check:doc-authoring`): an
    // operator reading a boot refusal cannot resolve `#NNNN`. The provenance
    // lives in this file's header, which the reader who CAN resolve it reads.
    '    OS_ALLOW_DEGRADED_TENANCY does NOT apply here — it covers an ABSENT multi-org runtime',
    '    (ADR-0093 D5), never a present one asking to be configured.',
  ].join('\n');
}

/**
 * Throw unless a walled deployment has DECLARED its membership policy.
 *
 * Ordering, in the order the checks appear:
 *
 *  1. Non-walled posture → return. `single` sees no check and no behavior
 *     change; `resolveTenancyPosture()` throwing (malformed knob) is NOT this
 *     gate's failure to report, so it fails open here and the framework's own
 *     posture validation reports it.
 *  2. No `auth` service → return. The membership reconciler lives in
 *     plugin-auth; with no plugin-auth mounted nothing creates memberships
 *     automatically, so there is no policy to declare and nothing to refuse.
 *  3. A DECLARED, valid setting → return, whichever of the two values it is.
 *  4. An effective policy that is not `auto` → return: the host declared it at
 *     AuthPlugin construction, and a non-default policy cannot arrive by
 *     accident. Checked AFTER the setting so a declared-but-invalid setting
 *     still refuses even when construction happens to have set `invite-only` —
 *     configuration that says one thing while the runtime does another is the
 *     defect, not a detail.
 *  5. Otherwise → refuse.
 */
export async function assertWalledMembershipPolicyDeclared(
  ctx: MembershipPolicyProbe,
  posture?: string,
): Promise<void> {
  let requested: string;
  if (posture !== undefined) {
    requested = posture;
  } else {
    try {
      requested = resolveTenancyPosture();
    } catch {
      // A malformed OS_TENANCY_POSTURE is the framework's refusal to make, and
      // it makes it. Reporting it from here would blame the wrong knob.
      return;
    }
  }
  if (requested === 'single') return;

  const auth = probeService<MembershipPolicyAuthSurface>(ctx, 'auth');
  if (!auth || typeof auth.getMembershipPolicy !== 'function') {
    ctx.logger?.info?.(
      // Same rule as the fatal message above: no tracker id in the rendered
      // string. This gate's provenance is cloud#1092, recorded in the header.
      '[org-scoping] membership-policy gate skipped: no `auth` service on this kernel, so nothing ' +
        'creates memberships automatically and there is no policy to declare',
      { posture: requested },
    );
    return;
  }

  const declaration = await readMembershipPolicyDeclaration(
    probeService<MembershipPolicySettingsSurface>(ctx, 'settings'),
  );

  if (declaration.declared && !declaration.invalid) return;

  let effective: string | undefined;
  try {
    effective = auth.getMembershipPolicy();
  } catch {
    effective = undefined;
  }
  if (!declaration.invalid && effective !== undefined && effective !== 'auto') return;

  throw new WalledMembershipPolicyError(
    walledMembershipPolicyFatalMessage(requested, declaration),
    requested,
    declaration,
  );
}
