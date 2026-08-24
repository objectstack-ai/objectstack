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
 * The env variable naming the deployment's PLATFORM OWNER account
 * (#11184, the framework leg of cloud#1509).
 *
 * Exported as a constant so every message that refuses over it (the walled
 * boot guard in plugin-auth, the elevation refusal in plugin-security's
 * `bootstrapPlatformAdmin`) names exactly one spelling.
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
 * When `OS_MULTI_ORG_ENABLED=true` but the enterprise `@objectstack/organizations`
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
 * `OS_ORG_MEMBERSHIP_LIMIT`. The auth plugin forwards this as better-auth's
 * `membershipLimit`, which gates `addMember` and invitation acceptance with a
 * 403 `ORGANIZATION_MEMBERSHIP_LIMIT_REACHED` once the org's member count
 * reaches the cap.
 *
 * Returns `undefined` when unset or non-positive → NO limit, preserving
 * self-host behaviour like {@link resolveOrgLimit}. This is deliberately NOT
 * the vendor's default: better-auth falls back to a 100-member cap when the
 * option is absent (`membershipLimit || 100`, measured on 1.7.1
 * `routes/crud-members.mjs`), and that arbitrary ceiling blocked real
 * deployments — a hospital org's 101st staff member simply could not be added,
 * with no knob to turn. The auth plugin therefore always passes an explicit
 * limit (this value, or effectively-unlimited when unset) so the vendor
 * fallback never applies. Metered SaaS postures that want a cap set the env.
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
