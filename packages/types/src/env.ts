// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Environment-variable helpers shared across `@objectstack/*` packages.
 *
 * The framework standardises on `OS_*` prefixed env vars (see AGENTS.md
 * "Environment Variables" section). Some historical names predate this
 * convention — `AUTH_SECRET`, `ROOT_DOMAIN`, `OBJECTSTACK_*`, …
 *
 * To migrate without breaking user `.env` files mid-release, call
 * {@link readEnvWithDeprecation} at every legacy read site:
 *
 *   const v = readEnvWithDeprecation('OS_AUTH_SECRET', 'AUTH_SECRET');
 *
 * If only the legacy name is set, the value is still returned but a
 * one-shot `console.warn` fires (per-process per-variable) telling
 * operators to rename it.
 */

import {
  normalizeTenancyPosture,
  postureEnforcesWall,
  postureUsesUnionScope,
  TENANCY_POSTURES,
  type TenancyPosture,
} from '@objectstack/spec/security';

const _warnedKeys = new Set<string>();

/**
 * Read an env var, preferring the canonical `OS_*` name and falling
 * back to one or more legacy aliases.
 *
 * When only a legacy alias is set, emits a one-shot deprecation warning.
 * The warning is process-wide deduplicated: identical (preferred, legacy)
 * pairs will only warn once even if read from multiple call sites.
 *
 * Legacy aliases are checked in order; the first one with a defined
 * value wins (and triggers the warning for that specific alias).
 *
 * Safe to call from environments where `process` is unavailable (returns
 * `undefined`); the warning is suppressed when running outside Node-like
 * runtimes that lack `console.warn`.
 *
 * @param preferred  Canonical OS_*-prefixed env var name.
 * @param legacy     Older name (or array of older names) to fall back on.
 * @param options    Optional behaviour flags. Set `silent: true` for aliases
 *                   that remain accepted conventions rather than true legacy
 *                   names — e.g. `PORT`, which PaaS platforms (Render, Railway,
 *                   Heroku, Fly, …) inject automatically. Warning on those
 *                   would nag operators about env they never set.
 * @returns The resolved value, or `undefined` if neither is set.
 */
export function readEnvWithDeprecation(
  preferred: string,
  legacy: string | readonly string[],
  options?: { silent?: boolean },
): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  if (!env) return undefined;

  const preferredValue = env[preferred];
  if (preferredValue !== undefined) return preferredValue;

  const legacyList = typeof legacy === 'string' ? [legacy] : legacy;
  for (const legacyName of legacyList) {
    const legacyValue = env[legacyName];
    if (legacyValue !== undefined) {
      const dedupeKey = `${preferred}|${legacyName}`;
      if (!options?.silent && !_warnedKeys.has(dedupeKey)) {
        _warnedKeys.add(dedupeKey);
        const consoleRef = (globalThis as { console?: { warn?: (msg: string) => void } }).console;
        try {
          consoleRef?.warn?.(
            `[ObjectStack] Env var \`${legacyName}\` is deprecated; rename it to \`${preferred}\`. ` +
            `The legacy name still works for now but will be removed in a future major release.`,
          );
        } catch {
          /* `console.warn` unavailable (exotic runtime) — ignore */
        }
      }
      return legacyValue;
    }
  }

  return undefined;
}

/**
 * Read the LEGACY `OS_MULTI_ORG_ENABLED` boolean.
 *
 * ⚠️ **[ADR-0105 D1] DEMOTED — not the knob to gate on.** `OS_TENANCY_POSTURE`
 * superseded this flag and is the authoritative one;
 * {@link resolveTenancyPosture} is where the two are reconciled (posture when
 * set, else this boolean). This function only reports the legacy input, so a
 * deployment that sets ONLY the canonical `OS_TENANCY_POSTURE` reads `false`
 * here while genuinely running a walled multi-organization posture.
 *
 * **Answering "is this deployment multi-org?" with this function is a bug.**
 * Ask the posture instead — `postureEnforcesWall(resolveTenancyPosture())`
 * (`@objectstack/spec/security`) — or, inside a running kernel, the `tenancy`
 * service, which additionally knows whether the requested wall is actually
 * ENFORCED (ADR-0093 D4/D5). Two shipped defects came from gating on this
 * boolean after the demotion: cloud#1020 (the EE licence gate) and #5233
 * (`organization/create` 403'd on a posture-only deployment whose organization
 * wall was fully mounted — the guided "create your workspace" path dead-ended).
 * The sentence this paragraph replaced actively instructed both.
 *
 * Legitimate remaining callers are the ones that specifically mean *the legacy
 * input*: {@link resolveTenancyPosture}'s own back-compat fallback, and
 * back-compat/reporting surfaces that must echo what the operator typed.
 *
 * Resolution: `OS_MULTI_ORG_ENABLED`; else `false`. Any value other than a
 * case-insensitive `'false'` enables it. (The legacy `OS_MULTI_TENANT` alias was
 * removed in 11.0.)
 *
 * Reads `process.env` live on each call; memoise at the call site if the
 * result must be stable for the process lifetime.
 */
export function resolveMultiOrgEnabled(): boolean {
  const raw = readEnvWithDeprecation('OS_MULTI_ORG_ENABLED', []);
  return String(raw ?? 'false').toLowerCase() !== 'false';
}

/**
 * [ADR-0105 D1] Resolve the deployment's REQUESTED tenancy posture —
 * `single` | `group` | `isolated`.
 *
 * `OS_TENANCY_POSTURE` is the canonical knob and generalizes the boolean
 * `OS_MULTI_ORG_ENABLED` it supersedes:
 *
 * - set → that posture (the legacy spelling `multi` normalizes to `isolated`)
 * - unset → derived from `OS_MULTI_ORG_ENABLED`: `true` ⇒ `isolated`, else `single`
 *
 * so every existing deployment keeps its current posture with no config change.
 *
 * An unrecognized value THROWS rather than falling back. A typo'd posture that
 * quietly resolved to `single` would silently remove the organization wall —
 * the deployment-layer form of the "declared but unenforced" defect ADR-0049
 * forbids, and the same reasoning behind ADR-0093 D5's refusal to boot into
 * undeclared degradation.
 *
 * This resolves what the operator ASKED FOR. Whether the posture is actually
 * enforced is the `tenancy` service's answer (`isolationActive` / `degraded`).
 */
export function resolveTenancyPosture(): TenancyPosture {
  // Read through `globalThis` like `readEnvWithDeprecation` does — this package
  // targets non-Node runtimes too, where a bare `process` reference throws.
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.OS_TENANCY_POSTURE;
  if (raw != null && String(raw).trim() !== '') {
    const posture = normalizeTenancyPosture(raw);
    if (!posture) {
      throw new Error(
        `Invalid OS_TENANCY_POSTURE=${JSON.stringify(String(raw))}. ` +
          `Expected one of: ${TENANCY_POSTURES.join(', ')} (or the legacy alias 'multi' = 'isolated'). ` +
          'Refusing to boot rather than silently falling back to a posture with no organization wall.',
      );
    }
    return posture;
  }
  return resolveMultiOrgEnabled() ? 'isolated' : 'single';
}

/**
 * The env variable gating PACKAGE-AUTHORED SCHEDULED WORK — every time-triggered
 * flow and every declarative `defineJob` a package ships (#17396).
 *
 * Exported as a constant so every surface that names it quotes exactly one
 * spelling: both time triggers, the automation engine's binding audit, the
 * AppPlugin job loop, `os doctor` and the four deployment docs pages.
 */
export const SCHEDULED_WORK_ENV = 'OS_AUTOMATION_SCHEDULED_WORK_ENABLED';

/**
 * Whether this DEPLOYMENT runs package-authored scheduled work at all.
 *
 * ## What it gates
 *
 * Everything a package ships that fires on a clock rather than on a caller:
 *
 *  - time-triggered FLOWS — a `type: 'schedule'` flow carrying a
 *    `config.schedule` cadence, and the `timeRelative` sweep that carries its
 *    cadence in the same slot (`FlowTriggerKind` `schedule` / `time_relative`);
 *  - package-authored declarative JOBS — `defineJob` entries reaching the job
 *    service through `defineStack({ jobs })` / a package bundle.
 *
 * ⛔ It does NOT gate platform-internal jobs — approvals escalation, the
 * lifecycle Reaper, the messaging dispatch loop, membership backfill. The
 * boundary is **authored by a package**, not "runs on the job service": the
 * platform's own maintenance work is part of the runtime a deployment asked
 * for, while package-authored scheduled work is arbitrary tenant-supplied load
 * on a clock the operator never sized.
 *
 * ## Why a deployment variable and not metadata
 *
 * Maintainer ruling, 2026-09-12, verbatim, untranslated:
 *
 * > schedule 是风险很大的模型，尤其在云端，无算是单独多租户还是每库一租户，可能造成极大的资源浪费。对于单租户或着集团版私有部署，我觉得不需要做限制。定时任务 如果不好处理，现在也没想清楚，有没有可能定义为一个环境变量，根据环境变量控制？
 *
 * > group 默认也关，云端每库一租户全局默认关
 *
 * Whether a clock-driven workload is affordable is a fact about the DEPLOYMENT
 * — its database, its tenants, its budget — not about the flow. An author
 * cannot know it and a metadata key would ask them to; so this is read from the
 * environment at boot, beside {@link resolveTenancyPosture}, and there is
 * deliberately no spec key for it.
 *
 * ## Default OFF, in every posture and every kernel
 *
 * Unset means off. A deployment that wants package-authored scheduled work
 * turns it on explicitly — including a `single` private install and a `group`
 * one. ⚠️ The switch is orthogonal to the posture and stays OFF by default in
 * all three: whether clock-driven work is affordable is a fact about the
 * deployment's database, tenants and budget, which no posture answers.
 *
 * [#18378] What the posture decides is what binds ONCE THE OPERATOR HAS TURNED
 * IT ON — see {@link resolveScheduledWorkPolicy}. `group` used to be walled
 * here by analogy with `isolated`, on the ground that
 * `resolveSystemWriteOrganization` refuses an organization-less system insert
 * under any wall and `TenancyService.defaultOrgId()` answers `null` (ADR-0093
 * D3), leaving which organization a group-wide sweep's inserts belong to
 * undecided. That question is answered (ruling A′, 2026-09-16): the swept
 * record's own. Both facts above still hold — they are why an undeclared
 * `group` run with NO record to derive from is still refused at the write.
 *
 * Accepts `true`/`1`/`on`/`yes`, case-insensitive; anything else — including an
 * unset variable and an empty string — is off. ⚠️ Deliberately NOT the
 * `!== 'false'` shape {@link resolveMultiOrgEnabled} uses: that one is opt-OUT
 * and reads a typo as "on", which for this switch would arm exactly the
 * workload the operator meant to refuse.
 *
 * Reads `process.env` live on each call; memoise at the call site if the result
 * must be stable for the process lifetime.
 */
export function resolveScheduledWorkEnabled(): boolean {
  const raw = readEnvWithDeprecation(SCHEDULED_WORK_ENV, [], { silent: true });
  if (raw == null) return false;
  return ['1', 'true', 'on', 'yes'].includes(String(raw).trim().toLowerCase());
}

/**
 * The deployment's scheduled-work policy as one reading — the three states
 * every binder and every audit surface must agree about (#17396).
 *
 * One resolver rather than two reads at each call site, because the three
 * states are not independent and spelling them apart is how they drift:
 *
 * | state | `enabled` | `requiresActingOrganization` | `runOwnership` | what binds |
 * |:--|:--|:--|:--|:--|
 * | OFF (default) | `false` | `false` | the posture's rule (moot) | nothing — no time trigger arms, no package job schedules |
 * | ON under `single` | `true` | `false` | `'unscoped'` | every time-triggered flow, carrying NO organization |
 * | ON under `group` | `true` | `false` | `'per-record'` | every time-triggered flow; a declared one acts as its declaration, an undeclared one acts as each swept record's own organization |
 * | ON under `isolated` | `true` | `true` | `'declared'` | only a flow that declares `config.organization` |
 *
 * [#18378, ruling A′] The `group` row was `requiresActingOrganization: true`
 * until 2026-09-16 — it was walled by analogy with `isolated`, recorded as
 * provisional at the time because which organization a group-wide run's inserts
 * belong to was the part that was not yet thought through. It is answered now:
 * the swept record's own, which is the subject-first order `sys_automation_run`
 * was already ruled to use. ⛔ Do not re-derive this row from
 * `postureEnforcesWall` — `group` DOES enforce a wall, and that is precisely
 * why its reads span the group and its writes still need an owner. The
 * predicate that separates it is {@link postureUsesUnionScope}.
 *
 * `requiresActingOrganization` is `false` when the switch is OFF because
 * nothing binds there at all: reporting a declaration requirement for a flow
 * that is not going to arm either way would put the operator on the authoring
 * remedy for a deployment decision. The OFF state has its own reason —
 * {@link SCHEDULED_WORK_DISABLED_REASON} — and it is the one that must be
 * reported.
 *
 * ⚠️ `runOwnership` is NOT gated on the switch the way that boolean is, and the
 * OFF row above says "the posture's rule" rather than a value for exactly that
 * reason: it answers a question about the POSTURE — where a bound run's writes
 * would get their organization — so with the switch off it still reports
 * `'per-record'` under `group` and `'declared'` under `isolated`, not
 * `'unscoped'`. Nothing binds there, so no run can reach the state it names:
 * ⛔ never read `runOwnership` alone as evidence that a run exists or that one
 * is going to; {@link ScheduledWorkPolicy.enabled} is the discriminator, and
 * the OFF reason above is what an operator gets told. Both halves are pinned in
 * `env.test.ts`.
 *
 * ⚠️ `posture` is what the deployment ASKED FOR, exactly as
 * {@link resolveTenancyPosture} answers it — whether the wall is actually
 * ENFORCED is the `tenancy` service's answer. That is the right authority here:
 * a deployment that asked for `isolated` owes the declaration whether or not
 * its isolation is currently degraded, and a flow that binds while the wall is
 * down would otherwise re-arm org-less the moment the wall came back.
 *
 * @throws the same refusal {@link resolveTenancyPosture} throws on an
 * unrecognized `OS_TENANCY_POSTURE` — a typo'd posture must not silently
 * resolve to `single` and drop the declaration requirement with it.
 */
/**
 * [#18378] Where a BOUND time-triggered run's writes get their organization,
 * once the flow's own declaration has been consulted and found absent.
 *
 * It is a separate axis from {@link ScheduledWorkPolicy.requiresActingOrganization}
 * because the two answer different doors: that boolean decides whether BIND
 * refuses, this decides what a run that DID bind carries. Collapsing them is
 * what made `group` walled by analogy in the first place — the posture has a
 * wall (so an org-less insert is refused) AND group-wide reads (so the batch is
 * legitimate), and only a second axis can say both.
 */
export type ScheduledRunOwnership =
  /**
   * `single`: the run carries no organization at all. The install holds exactly
   * one (plugin-auth's org-create posture gate refuses a second) and the #8844
   * guard resolves it beneath every tenant-scoped insert.
   */
  | 'unscoped'
  /**
   * `group`: the run acts as the SWEPT RECORD's own organization. Reads stay
   * group-wide — inherent to the posture (ADR-0105 D1) — and ownership follows
   * the row, which is the order `ObjectStoreSuspendedRunStore` already uses for
   * `sys_automation_run` (`organizationOf(record) ?? ctx.tenantId`, subject
   * first). A run with no record to derive from resolves nothing and takes the
   * existing `walled-posture` refusal at its first tenant-scoped write; ⛔ there
   * is no limb that picks one instead.
   */
  | 'per-record'
  /**
   * `isolated`: the declaration, or the flow does not arm. The 2026-09-08
   * ruling on cross-organization scheduled tasks, unchanged.
   */
  | 'declared';

export interface ScheduledWorkPolicy {
  /** Whether package-authored scheduled work runs on this deployment at all. */
  readonly enabled: boolean;
  /** The deployment's REQUESTED tenancy posture. */
  readonly posture: TenancyPosture;
  /**
   * Whether an armed time-triggered flow must declare `config.organization`.
   * True only under `isolated` with the switch on — the 2026-09-08 ruling on
   * cross-organization scheduled tasks, narrowed to that posture by #18378.
   */
  readonly requiresActingOrganization: boolean;
  /**
   * What an armed run that declared nothing acts as. ⚠️ A fact about
   * {@link posture}, NOT about the switch: it reports that posture's rule
   * (`group` ⇒ `'per-record'`, `isolated` ⇒ `'declared'`) whether or not
   * {@link enabled}. With the switch off nothing binds, so no run can reach the
   * state this names — ⛔ read it together with {@link enabled}, never alone as
   * evidence that a run exists.
   */
  readonly runOwnership: ScheduledRunOwnership;
}

/**
 * Which ownership rule a posture implies, independent of the switch.
 *
 * ⛔ Deliberately NOT `postureEnforcesWall ? 'declared' : 'unscoped'`. Both
 * walled postures enforce a wall; what separates them is READ REACH, and
 * {@link postureUsesUnionScope} is the protocol's existing name for exactly
 * that distinction (`group` only). A posture whose reads already span every
 * organization in the deployment is one where a batch job is a capability
 * rather than a boundary violation — so it is the one posture that can own its
 * writes per-row instead of demanding a declaration up front.
 */
function scheduledRunOwnershipFor(posture: TenancyPosture): ScheduledRunOwnership {
  if (!postureEnforcesWall(posture)) return 'unscoped';
  return postureUsesUnionScope(posture) ? 'per-record' : 'declared';
}

/** Resolve {@link ScheduledWorkPolicy} from the environment. */
export function resolveScheduledWorkPolicy(): ScheduledWorkPolicy {
  const enabled = resolveScheduledWorkEnabled();
  const posture = resolveTenancyPosture();
  const runOwnership = scheduledRunOwnershipFor(posture);
  return {
    enabled,
    posture,
    requiresActingOrganization: enabled && runOwnership === 'declared',
    runOwnership,
  };
}

/**
 * The one sentence a surface prints when package-authored scheduled work is
 * OFF — so the bind refusal, the engine's binding audit, the CLI startup
 * summary and the flow status door cannot drift about WHY a flow is not armed.
 *
 * ⚠️ [#18235] Studio's own door carries it now: `GET /automation/_status`
 * answers `FlowRuntimeState` rows (`@objectstack/spec`
 * `contracts/automation-service.ts`), and their optional `reason` holds this
 * sentence verbatim for a policy-disabled flow — read from the engine's
 * RECORDED refusal, the same computation the binding audit reads. What is on
 * the wire is the reason; what a console DISPLAYS is its own card
 * (objectui#9217, open). ⛔ So do not write that Studio *renders* this
 * distinctly until that lands — reaching the wire is not being shown.
 *
 * ⛔ It must never read as "binding failed". A binding failure is a defect with
 * an engineering remedy; this is a deployment POLICY with an operator remedy,
 * and the two send the reader to different places. The distinction is the whole
 * of ruled item 6.
 */
export const SCHEDULED_WORK_DISABLED_REASON =
  `disabled by deployment policy — package-authored scheduled work is off on this deployment `
  + `(${SCHEDULED_WORK_ENV} is unset or not truthy), so no time trigger arms and no packaged `
  + `\`defineJob\` is scheduled. This is not a binding failure and nothing about the flow needs `
  + `fixing: set ${SCHEDULED_WORK_ENV}=true to run package-authored scheduled work on this `
  + `deployment. It is OFF by default in every posture — a clock-driven workload's cost is a `
  + `fact about the deployment, not about the flow.`;

/**
 * The env variable naming the deployment's PLATFORM OWNER account
 * (#11184, the framework leg of cloud#1509).
 *
 * Exported as a constant so every message that names it quotes exactly one
 * spelling: the walled boot guard in plugin-auth, and plugin-security's
 * `bootstrapPlatformAdmin` — its fail-closed backstop for an undeclared or
 * refused config, and the config-derived standing it logs beside it.
 *
 * ⚠️ That second site is no longer an ELEVATION refusal. Since the #11663
 * platform-admin re-anchor (leg L4) the walled `bootstrapPlatformAdmin` writes
 * no grant row and elevates nobody — it reports. Standing is derived PER
 * REQUEST at `resolve-authz-context.ts` §6b-config, from a declared address
 * held on a VERIFIED `sys_user` row.
 */
export const PLATFORM_OWNER_EMAIL_ENV = 'OS_PLATFORM_OWNER_EMAIL';

/**
 * [#11184 / cloud#1509] Resolve the env-declared platform OWNER email —
 * `OS_PLATFORM_OWNER_EMAIL`.
 *
 * Under a WALLED tenancy posture (`group` / `isolated`) the "first registrant
 * becomes owner/platform admin" bootstrap path is REMOVED (maintainer ruling
 * 2026-08-23, verbatim: 「1509 选择 env 指定 owner 邮箱」): on a walled
 * deployment with self-registration reachable, whoever curls the sign-up
 * endpoint first would otherwise receive the cross-tenant `admin_full_access`
 * grant — measured on a real walled SaaS in cloud#1509. Platform admin is
 * granted ONLY to the account whose email matches this variable, and a walled
 * posture with no value declared REFUSES STARTUP (fail-closed, same reasoning
 * as {@link resolveTenancyPosture}'s throw and ADR-0093 D5) rather than
 * silently reverting to first-registrant elevation.
 *
 * The `single` posture never consults this: "first user is owner" is ruled
 * reasonable there and unchanged.
 *
 * Returns the operator's value trimmed, or `undefined` when unset/blank.
 * Comparison against `sys_user.email` is the CONSUMER's job and must be
 * case-insensitive (this resolver echoes what the operator typed so refusal
 * messages can quote it verbatim).
 *
 * Reads `process.env` live on each call, through `globalThis` like the other
 * resolvers here (this package targets non-Node runtimes too).
 */
export function resolvePlatformOwnerEmail(): string | undefined {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.[PLATFORM_OWNER_EMAIL_ENV];
  if (raw == null) return undefined;
  const trimmed = String(raw).trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Escape hatch for the degraded-tenancy boot guard (ADR-0093 D5).
 *
 * When `OS_MULTI_ORG_ENABLED=true` but the `@objectstack/organizations`
 * package cannot provide tenant isolation, the platform refuses to boot — a
 * deployment that asked for tenant isolation must not serve traffic pretending
 * to have it (ADR-0049 at the deployment layer). Setting this to a truthy value
 * (`true`/`1`/`on`/`yes`, case-insensitive) boots anyway in an explicitly
 * *degraded* state that is branded everywhere an operator looks. Defaults OFF —
 * an unset flag means "fail fast".
 */
export function resolveAllowDegradedTenancy(): boolean {
  const raw = readEnvWithDeprecation('OS_ALLOW_DEGRADED_TENANCY', [], { silent: true });
  if (raw == null) return false;
  return ['1', 'true', 'on', 'yes'].includes(String(raw).trim().toLowerCase());
}

/**
 * Escape hatch for the driver-connect boot guard (framework#3741).
 *
 * `ObjectQLEngine.init()` connects every boot-registered driver and, by
 * default, refuses to boot when any of them fails — a server whose database is
 * unreachable must not report itself started and then 500 every request with an
 * error that reads nothing like "the database is down". Failing there is also
 * what gives a driver the ability to REFUSE STARTUP at all: any fatal startup
 * check a driver wants to run (licence, server version, incompatible
 * configuration, missing capability) can simply throw from `connect()`.
 *
 * Setting this to a truthy value (`true`/`1`/`on`/`yes`, case-insensitive)
 * boots anyway, in an explicitly degraded state that is logged loudly at
 * startup. Every query routed to a failed driver fails until the datasource
 * becomes reachable — the underlying clients do re-establish connections on
 * their own (framework#3759) — but the boot-time schema sync those drivers
 * missed is never re-run, so their tables may simply not exist afterwards.
 * Defaults OFF — an unset flag means "fail fast".
 */
export function resolveAllowDriverConnectFailure(): boolean {
  const raw = readEnvWithDeprecation('OS_ALLOW_DRIVER_CONNECT_FAILURE', [], { silent: true });
  if (raw == null) return false;
  return ['1', 'true', 'on', 'yes'].includes(String(raw).trim().toLowerCase());
}

/**
 * Escape hatch for plugin-dev's production boot guard (ADR-0115 D6, #3900).
 *
 * `DevPlugin.init()` refuses to run under `NODE_ENV=production`: the stack it
 * assembles is built around an auth secret published inside the npm package and
 * an in-memory driver with persistence off, neither of which a production
 * deployment should acquire by accident. Setting this to a truthy value
 * (`true`/`1`/`on`/`yes`, case-insensitive) boots anyway, in an explicitly
 * degraded state that is branded in the boot log and on the ready banner.
 * Defaults OFF — an unset flag means "fail fast".
 *
 * Lives here rather than as a bare `process.env[…] === '1'` inside plugin-dev so
 * that the whole `OS_ALLOW_*` family answers to one truthy vocabulary: the
 * strict `=== '1'` it replaced fails CLOSED on `OS_ALLOW_DEV_PLUGIN=true`, which
 * is safe but reads to an operator as the flag being broken.
 */
export function resolveAllowDevPlugin(): boolean {
  const raw = readEnvWithDeprecation('OS_ALLOW_DEV_PLUGIN', [], { silent: true });
  if (raw == null) return false;
  return ['1', 'true', 'on', 'yes'].includes(String(raw).trim().toLowerCase());
}

/**
 * SINGLE decision point for "is the MCP HTTP surface (`/api/v1/mcp`) on?".
 *
 * MCP is a core platform capability and defaults ON: an unset
 * `OS_MCP_SERVER_ENABLED` means the surface is served. Operators opt OUT with
 * an explicit falsy value (`false`/`0`/`off`/`no`, case-insensitive); any
 * other value — including the historical `true` — keeps it on.
 *
 * Every consumer of the flag — the runtime dispatcher's `/mcp` route gate,
 * the CLI's MCP plugin auto-load, the REST `/discovery` advertisement, and
 * the auth service's OAuth/DCR follow-defaults — MUST call this instead of
 * re-reading the env, so the served route, the advertised route, and the
 * authorization track can never disagree.
 *
 * Note the asymmetry with the MCP plugin's *stdio* auto-start
 * ({@link resolveMcpStdioAutoStart}), which stays opt-in and is gated by a
 * SEPARATE switch: attaching a long-lived stdio transport to every process is
 * a side effect no default should impose, while the HTTP surface is served
 * statelessly per-request.
 */
export function isMcpServerEnabled(): boolean {
  const raw = readEnvWithDeprecation('OS_MCP_SERVER_ENABLED', 'MCP_SERVER_ENABLED', {
    silent: true,
  });
  if (raw == null) return true;
  return !['0', 'false', 'off', 'no'].includes(raw.trim().toLowerCase());
}

/**
 * SINGLE decision point for "should the MCP plugin auto-start a long-lived
 * (stdio) transport?" — distinct from {@link isMcpServerEnabled}, which governs
 * the stateless HTTP surface.
 *
 * The stdio transport is a different, stricter posture: the plugin bridges the
 * RAW metadata service + data engine onto the long-lived server with NO
 * per-request principal (unscoped — see the `mcp-stdio-authority` conformance
 * row), so it is safe only as a single-operator LOCAL tool and MUST stay
 * opt-in. It defaults OFF.
 *
 * Canonical switch: `OS_MCP_STDIO_ENABLED` (truthy). The plugin also starts it
 * when constructed with `{ autoStart: true }` (that path is checked by the
 * caller, not here).
 *
 * DEPRECATED alias: `OS_MCP_SERVER_ENABLED=true` historically ALSO started
 * stdio — overloading the very var that gates the HTTP surface, so an operator
 * setting it to "make sure MCP is on" silently attached an unscoped transport.
 * That trigger still works (with a one-time warning from the caller) for one
 * release; prefer the dedicated var. Note `OS_MCP_SERVER_ENABLED=false` only
 * ever gated the HTTP surface and never started stdio, so it is unaffected.
 *
 * @returns `enabled` — whether stdio auto-start is requested by the env; and
 *   `viaDeprecatedAlias` — whether it came through the legacy
 *   `OS_MCP_SERVER_ENABLED=true` trigger (so the caller can warn once).
 */
export function resolveMcpStdioAutoStart(): { enabled: boolean; viaDeprecatedAlias: boolean } {
  const stdio = readEnvWithDeprecation('OS_MCP_STDIO_ENABLED', [], { silent: true });
  if (stdio != null && ['1', 'true', 'on', 'yes'].includes(stdio.trim().toLowerCase())) {
    return { enabled: true, viaDeprecatedAlias: false };
  }
  // Legacy trigger: only the literal `true` ever started stdio (preserved
  // exactly). `OS_MCP_SERVER_ENABLED=false`/other values never did.
  const legacy = readEnvWithDeprecation('OS_MCP_SERVER_ENABLED', 'MCP_SERVER_ENABLED', { silent: true });
  if (legacy != null && legacy.trim().toLowerCase() === 'true') {
    return { enabled: true, viaDeprecatedAlias: true };
  }
  return { enabled: false, viaDeprecatedAlias: false };
}

/**
 * Maximum number of organizations a single user may CREATE, from `OS_ORG_LIMIT`.
 * The auth plugin forwards this as better-auth's `organizationLimit` in function
 * form, counting only the caller's `role=owner` memberships — so it caps
 * self-created orgs (each of which can auto-provision a free environment on the
 * cloud control plane) without penalising a user invited into many orgs.
 *
 * Only meaningful under a posture that enforces an organization wall, i.e.
 * `postureEnforcesWall({@link resolveTenancyPosture}())` — NOT the demoted
 * `resolveMultiOrgEnabled()` boolean (ADR-0105 D1, #5233).
 * Returns `undefined` when unset or non-positive → no limit (better-auth treats
 * an absent `organizationLimit` as unlimited), preserving self-host behaviour.
 * Deployments that let users self-create orgs SHOULD set a generous cap.
 */
export function resolveOrgLimit(): number | undefined {
  const raw = readEnvWithDeprecation('OS_ORG_LIMIT', [], { silent: true });
  if (raw == null || String(raw).trim() === '') return undefined;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Maximum number of MEMBERS a single organization may hold, from
 * `OS_ORG_MEMBERSHIP_LIMIT`. A different question from {@link resolveOrgLimit},
 * which caps how many organizations one user may create.
 *
 * Unset → `undefined`, which the auth plugin forwards as "no cap". That default
 * is a product decision, not an omission: seat entitlements are metered on AI
 * seats, and plain membership is not a billed axis, so nothing about the
 * platform wants a member ceiling.
 *
 * It has to be stated explicitly because better-auth's organization plugin
 * substitutes a vendor default of **100** for an absent `membershipLimit`
 * (`count >= (membershipLimit || 100)`), which reaches the operator as
 * `Organization membership limit reached` — a refusal nobody in this codebase
 * ever chose, on an axis the product does not limit.
 *
 * A deployment that DOES want a ceiling (a pilot, a trial tenant) sets a
 * positive integer here. Non-positive or unparsable values read as unset rather
 * than as zero: a typo must not be the thing that locks an organization.
 */
export function resolveOrgMembershipLimit(): number | undefined {
  const raw = readEnvWithDeprecation('OS_ORG_MEMBERSHIP_LIMIT', [], { silent: true });
  if (raw == null || String(raw).trim() === '') return undefined;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * SINGLE decision point for "is pinyin search recall on?" (#2486).
 *
 * Pinyin search is a deployment/locale-level capability, not field metadata:
 * Chinese deployments want it, pure-Japanese/English deployments don't. The
 * flag gates the whole feature end-to-end — the SchemaRegistry's compile-time
 * `__search` companion-column seam AND the `plugin-pinyin-search` populate
 * hooks — so there is no half-state where a column exists but nobody fills it
 * (ADR-0049: no declared-but-unenforced capability).
 *
 * Resolution:
 *   1. An explicit `OS_SEARCH_PINYIN_ENABLED` always wins — truthy
 *      (`1`/`true`/`on`/`yes`) enables, anything else disables.
 *   2. When unset, the default derives from the deployment's configured
 *      locales (`opts.locales`, e.g. the stack's `i18n.defaultLocale` +
 *      `supportedLocales`): any `zh-*` locale turns it on.
 *   3. No env var and no `zh-*` locale → off. OSS / non-Chinese deployments
 *      never load `pinyin-pro` and pay zero compute cost.
 *
 * Hosts that know the stack's i18n config — the CLI `serve` boot path AND the
 * standalone artifact boot (`createStandaloneStack`, which `os migrate`
 * plan/apply and embedders go through) — resolve once with locales and stamp
 * the decision back into the env via {@link stampSearchPinyinEnabled}, so
 * downstream consumers constructed without config access (per-engine
 * SchemaRegistry) read the same answer via the no-arg form (#3955).
 */
export function resolveSearchPinyinEnabled(opts?: { locales?: readonly string[] }): boolean {
  const raw = readEnvWithDeprecation('OS_SEARCH_PINYIN_ENABLED', [], { silent: true });
  if (raw != null && String(raw).trim() !== '') {
    return ['1', 'true', 'on', 'yes'].includes(String(raw).trim().toLowerCase());
  }
  return (opts?.locales ?? []).some((l) => /^zh([-_]|$)/i.test(String(l ?? '').trim()));
}

/**
 * The locales a stack's `i18n` config declares — `defaultLocale`,
 * `fallbackLocale`, then `supportedLocales`. Accepts the config loosely typed
 * (`unknown`) so any boot path can pass whatever its stack config or compiled
 * artifact carries without importing spec schemas; non-string entries and a
 * non-object config collapse to `[]`.
 */
export function collectConfiguredLocales(i18n: unknown): string[] {
  const cfg = (i18n && typeof i18n === 'object' ? i18n : {}) as {
    defaultLocale?: unknown;
    fallbackLocale?: unknown;
    supportedLocales?: unknown;
  };
  return [
    cfg.defaultLocale,
    cfg.fallbackLocale,
    ...(Array.isArray(cfg.supportedLocales) ? cfg.supportedLocales : []),
  ].filter((l): l is string => typeof l === 'string');
}

/**
 * Resolve the pinyin-search decision from a stack's `i18n` config and stamp a
 * positive result back into `OS_SEARCH_PINYIN_ENABLED` (#2486, #3955).
 *
 * Every boot path that SEES the stack config must stamp, because consumers
 * constructed later without config access (each engine's `SchemaRegistry`
 * provisioning the `__search` companion column, the `plugin-pinyin-search`
 * gate) read the decision through the no-arg
 * {@link resolveSearchPinyinEnabled}. A boot path that skips the stamp
 * computes a schema view WITHOUT the companion columns — which is how
 * `os migrate` came to flag the dev runtime's live `__search` columns as
 * destructive orphans (#3955). Call sites: the CLI `serve`/`dev` boot
 * (`objectstack.config.ts`) and `createStandaloneStack` (compiled artifact —
 * `os migrate plan`/`apply`, embedders).
 *
 * An explicit `OS_SEARCH_PINYIN_ENABLED` always wins — the resolver reads it
 * before consulting locales, so the stamp only materializes the
 * locale-derived default. Only a positive decision is written: "unset" and
 * "off" read identically through the no-arg resolver, and leaving the var
 * untouched keeps a later boot free to re-derive from ITS config.
 */
export function stampSearchPinyinEnabled(i18n: unknown): boolean {
  const enabled = resolveSearchPinyinEnabled({ locales: collectConfiguredLocales(i18n) });
  // Write through `globalThis` like `readEnvWithDeprecation` reads — this
  // package has no Node type dependency (edge-safe); no env object → no stamp.
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  if (enabled && env) env.OS_SEARCH_PINYIN_ENABLED = 'true';
  return enabled;
}

/**
 * SINGLE decision point for a sandbox script-runner DEFAULT (ms), resolved from
 * the environment (framework#3259 / ADR-0102).
 *
 * The QuickJS sandbox meters each hook/action invocation against a per-invocation
 * budget. Two dimensions are env-tunable:
 *   - the **CPU-time budget** for hooks / actions — how much *VM-active* time a
 *     body may burn (built-in 250ms hooks / 5000ms actions); and
 *   - the **wall-clock ceiling** — the backstop bounding a body parked forever on
 *     a host call that never settles (built-in 30_000ms).
 *
 * The built-in defaults suit a warm, idle host; a heavily loaded or slow host
 * (an oversubscribed CI runner, constrained production hardware) may need a
 * higher floor. This lets an operator raise it once, deployment-wide, instead of
 * re-tuning every call site.
 *
 * Canonical vars (OS_{DOMAIN}_{NAME}, DOMAIN=SANDBOX):
 *   - hook        → `OS_SANDBOX_HOOK_TIMEOUT_MS`
 *   - action      → `OS_SANDBOX_ACTION_TIMEOUT_MS`
 *   - wallCeiling → `OS_SANDBOX_WALL_CEILING_MS`
 *
 * Only a positive integer is honored; unset / empty / non-numeric / non-positive
 * falls back to `fallback`, so behaviour is byte-for-byte unchanged when the var
 * is absent. This is a FALLBACK default ONLY: an explicit constructor option
 * still wins over it, and (for the CPU budget) a body's own declared `timeoutMs`
 * still wins over the resolved default per the runner's resolution rule.
 */
export function resolveSandboxTimeoutMs(
  kind: 'hook' | 'action' | 'wallCeiling',
  fallback: number,
): number {
  const name =
    kind === 'hook'
      ? 'OS_SANDBOX_HOOK_TIMEOUT_MS'
      : kind === 'action'
        ? 'OS_SANDBOX_ACTION_TIMEOUT_MS'
        : 'OS_SANDBOX_WALL_CEILING_MS';
  const raw = readEnvWithDeprecation(name, [], { silent: true });
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Internal: clear the dedupe set. Test-only; exposed so suite-wide
 * deprecation warnings don't bleed between tests.
 *
 * @internal
 */
export function _resetEnvDeprecationWarnings(): void {
  _warnedKeys.clear();
}
