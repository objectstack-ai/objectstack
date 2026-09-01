// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapDeclaredSharingRules — seed stack-declared `sharingRules` into
 * `sys_sharing_rule` (ADR-0057 D6, closes #2077; reconciles #1887).
 *
 * The spec authoring shape (`SharingRuleSchema`: CEL `condition`,
 * `sharedWith{type,value}`) diverges from the enforced runtime shape
 * (`criteria_json` JSON filter + `recipient_type`/`recipient_id`). ADR-0057 D6
 * makes the RUNTIME shape canonical and translates the authorable fields.
 * Every currently-authorable recipient (`user` / `team` / `position` /
 * `unit_and_subordinates` / `business_unit`) maps 1:1 and ENFORCES — the
 * retired `group`/`guest` recipients and `owner`-type rules no longer parse
 * at the spec (ADR-0078; `group` was renamed → `team`). What the runtime
 * still cannot enforce is SKIPPED (logged) rather than seeded as a match-all
 * rule — silently over-sharing would be worse than not enforcing (ADR-0049):
 *   - a CEL `condition` the canonical compiler cannot lower (functions,
 *     cross-object traversal) — ADR-0058 D2. Compound predicates (AND/OR,
 *     comparisons, null, in) DO lower and are enforced (ADR-0058 D3, #1887).
 *   - a missing or empty `condition`, which lowers to no predicate at all
 *     (#3896). It used to seed a rule with `criteria_json: null` — the exact
 *     permissive match-all the rest of this file exists to prevent.
 *   - defensively, any stale pre-built package that still registers an old
 *     `owner`-type / unmapped-recipient shape.
 *
 * Seeding upserts via `SharingRuleService.defineRule` and MUST run before
 * `listRules()`/`bindRuleHooks` so the lifecycle hooks bind to a populated
 * table.
 *
 * ## Per organization under a walled posture
 *
 * `defineRule` already keys its upsert on `(name, organization_id)` whenever the
 * calling context carries an organization — it is the SEEDER that never
 * supplied one, so every declared rule landed organization-less and, on a walled
 * deployment, unreadable by every principal (Layer 0's strict
 * `organization_id = :tenant` AND-composes over the driver's compatibility arm
 * and the conjunction is the strict equality alone). This pass therefore runs
 * ONCE PER ORGANIZATION under a walled posture, threading `tenantId` so
 * `callerOrgId` resolves and the rule is stamped with its owner.
 *
 * `single` posture keeps exactly ONE organization-less pass, byte for byte the
 * pre-existing behaviour: there an organization-less rule is the correct shape,
 * and it is also the platform-global class `deleteRule` guards (#7795).
 *
 * Nothing is reaped. Pre-fix organization-less rows for names this pass seeds
 * are named loudly instead, with their remedy — see
 * `plugin-security/src/per-organization-catalog.ts` for why a reap is the wrong
 * instrument on tables that grants point at.
 */

import type { SharingRuleService } from './sharing-rule-service.js';
import type { SharingRuleRecipientType, ShareAccessLevel } from '@objectstack/spec/contracts';
import { compileCelToFilter } from '@objectstack/formula';
import type { CelFilterFailReason } from '@objectstack/formula';
import { isMatchAllCriteria } from './rule-criteria.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * The context ONE seeding pass runs under. With an organization it makes
 * `SharingRuleService.callerOrgId` resolve, so `defineRule` keys its upsert on
 * `(name, organization_id)` and stamps the row with its owner. Without one it is
 * `SYSTEM_CTX` unchanged — the `single`-posture pass.
 */
function seedRuleCtx(organizationId?: string): any {
  return organizationId ? { ...SYSTEM_CTX, tenantId: organizationId } : SYSTEM_CTX;
}

/**
 * Which of the names this pass seeded ALSO still have a pre-fix
 * organization-less row standing.
 *
 * Read under the organization's own scope on purpose: that read routes through
 * `SqlDriver.applyTenantScope`, whose compatibility arm is the only reason an
 * organization-less row is visible from inside a tenant at all. A bare
 * unscoped read would answer a different question (every organization's rows),
 * and a bare equality would answer none.
 */
async function findOrganizationLessRules(
  engine: any,
  names: string[],
  organizationId: string,
): Promise<string[]> {
  if (names.length === 0) return [];
  try {
    const rows = await engine.find('sys_sharing_rule', {
      where: { name: { $in: names } },
      limit: Math.max(names.length * 4, 50),
      context: seedRuleCtx(organizationId),
    });
    return (Array.isArray(rows) ? rows : [])
      .filter((r: any) => ((r?.organization_id ?? r?.organizationId) ?? null) === null)
      .map((r: any) => r?.name)
      .filter((n: unknown): n is string => typeof n === 'string' && n !== '');
  } catch { return []; }
}

type Logger = { info?: (m: string, meta?: any) => void; warn?: (m: string, meta?: any) => void };

/** Map the spec `sharedWith.type` onto a runtime recipient_type, or null. */
function mapRecipientType(t: unknown): SharingRuleRecipientType | null {
  switch (t) {
    case 'user': return 'user';
    // Flat sys_team membership (ADR-0090 D3 vocabulary; the pre-D3 `group`
    // spelling was retired) — expanded by TeamGraphService in expandRecipient.
    case 'team': return 'team';
    case 'position': return 'position';
    // ADR-0057 D5: business-unit subtree recipient.
    case 'business_unit': return 'business_unit' as SharingRuleRecipientType;
    case 'unit_and_subordinates': return 'unit_and_subordinates' as SharingRuleRecipientType;
    // Defensive only: the authoring enum matches the cases above 1:1, but a
    // stale pre-built package could still register a retired shape — skip,
    // never seed match-all.
    default: return null;
  }
}

/**
 * Compile a sharing-rule CEL `condition` into the runtime `criteria_json`
 * FilterCondition (ADR-0058 D1, the substance of #1887).
 *
 * Delegates to the ONE canonical CEL → FilterCondition pushdown compiler in
 * `@objectstack/formula`. A sharing condition is a pure record predicate — no
 * `current_user.*` — so it resolves with the default `record` field root and an
 * empty variable scope. This lowers the full pushdown subset (`==`/`!=`,
 * comparisons, `in`, `&&`/`||`/`!`, `== null`, string ops), not just the former
 * `record.field == <literal>` shape, so compound criteria now SEED and ENFORCE
 * instead of being skipped as experimental. Anything non-pushdownable (functions,
 * cross-object traversal) still returns null → the caller skips it (logged),
 * never seeding a permissive match-all (ADR-0049).
 */
export function celToFilter(cel: unknown): Record<string, unknown> | null {
  return celToFilterOutcome(cel).filter;
}

/**
 * Why a declared rule's `condition` produced no criteria — the compiler's OWN
 * answer, carried instead of discarded. [#13943]
 *
 * `compileCelToFilter` already returns `{ reason, detail }` on every refusal;
 * `celToFilter` used to consume `!ok` and collapse the rest to `null` one line
 * before the only WARN that could surface it — so an operator whose declared
 * rule was silently not granting got the fact ("skipped") and the source text
 * back, but not WHICH shape the compiler refused or why. The extra member is
 * this FILE's own drop (the ADR-0049 match-all guard at the call site), which
 * the compiler reports as a success — same skip, same silence, so it joins the
 * same vocabulary rather than staying unnamed (the `empty-membership`
 * precedent in `plugin-security/src/rls-compiler.ts`, #13639).
 */
type SharingSkipReason = CelFilterFailReason | 'match-all-criteria';

/** A skipped rule's cause: the compiler's `reason` (the aggregatable category) plus its human `detail` (the concrete fault). */
interface SharingSkipCause {
  reason: SharingSkipReason;
  detail: string;
}

/** {@link celToFilterOutcome}'s answer: the filter, or why there is none. */
type CelToFilterOutcome =
  | { filter: Record<string, unknown>; cause?: undefined }
  | { filter: null; cause: SharingSkipCause };

/**
 * [#13943] {@link celToFilter}'s answer WITH the reason it refused.
 *
 * Same compile, same decision, same returned filter — the only difference is
 * that the compiler's `{ reason, detail }` survives to the caller instead of
 * being collapsed into `null` at the `!result.ok` line. `celToFilter` stays
 * exactly as published (`Record | null`) and delegates here — the
 * `compileExpressionOutcome` shape from `plugin-security/src/rls-compiler.ts`
 * (#13942), one seam over.
 */
export function celToFilterOutcome(cel: unknown): CelToFilterOutcome {
  const result = compileCelToFilter(cel as string | { source?: string }, { variables: {} });
  if (!result.ok) return { filter: null, cause: { reason: result.reason, detail: result.detail } };
  return { filter: result.filter as Record<string, unknown> };
}

/**
 * Read declared items straight off the engine's SchemaRegistry.
 *
 * [#8378] No `{ name, content }` unwrap: the registered item IS the authoring
 * document. `SharingRuleSchema` declares no `content` key and rejects one as
 * unrecognized, so the `i?.content ?? i` this read used to carry could only
 * ever have replaced a rule document with one of its values — see
 * `plugin-security/src/bootstrap-declared-permissions.ts` for the measurement.
 */
function readDeclared(engine: any, type: string): any[] {
  try {
    const reg = engine?._registry;
    if (reg?.listItems) {
      return (reg.listItems(type) ?? []).filter(Boolean);
    }
  } catch { /* fall through */ }
  return [];
}

export async function bootstrapDeclaredSharingRules(
  ruleService: SharingRuleService,
  metadataService: any,
  engine: any,
  logger?: Logger,
  /**
   * Seed THIS organization's copies. Omitted = the `single`-posture pass, the
   * one place an organization-less sharing rule is the correct shape.
   */
  organizationId?: string,
): Promise<{ seeded: number; skipped: number }> {
  let rules: any[] = readDeclared(engine, 'sharing_rule');
  if (rules.length === 0) {
    try {
      const listed = metadataService?.list?.('sharing_rule');
      rules = typeof (listed as any)?.then === 'function' ? await listed : (listed ?? []);
    } catch { rules = []; }
  }
  if (!Array.isArray(rules) || rules.length === 0) return { seeded: 0, skipped: 0 };

  let seeded = 0;
  let skipped = 0;
  const seededNames: string[] = [];
  for (const r of rules) {
    if (!r?.name || !r?.object) { skipped += 1; continue; }
    const recipientType = mapRecipientType(r.sharedWith?.type);
    if (!recipientType || !r.sharedWith?.value) {
      logger?.warn?.('[sharing-rule] skipped (unmappable recipient) [experimental]', { rule: r.name, sharedWith: r.sharedWith?.type });
      skipped += 1; continue;
    }
    // Defensive: `owner`-type rules were removed from the authoring spec
    // (live-membership-dependent, no static criteria_json equivalent) — this
    // guards stale pre-built packages that still register the old shape.
    if (r.type === 'owner') {
      logger?.warn?.('[sharing-rule] skipped owner-based rule (retired authoring shape — use a criteria rule)', { rule: r.name });
      skipped += 1; continue;
    }
    // criteria rules: translate CEL → filter. [#3896] A missing / empty
    // condition used to fall through this branch with `criteria` undefined,
    // which `defineRule` stored as `criteria_json: null` and the evaluator
    // read as the empty filter — the one outcome this file's header forbids.
    // It is now skipped like any other non-lowerable condition: the authoring
    // schema requires `condition`, so reaching here means a hand-crafted
    // `{ dialect, source: '' }` envelope or a stale pre-built package, and
    // neither earns a match-all.
    const outcome = celToFilterOutcome(r.condition);
    if (outcome.filter === null || isMatchAllCriteria(outcome.filter)) {
      // [#13943] The skip keeps its REASON. `reason` + `detail` are what the
      // compiler already computed — the shape it refused, the variable path,
      // the parse bound that was overrun — and discarding them here is what
      // left an operator with a skipped rule, its source text, and no why.
      // The skip decision itself is byte-identical to before (ADR-0049: an
      // unlowerable condition is never seeded as a permissive match-all).
      const cause: SharingSkipCause = outcome.filter === null
        ? outcome.cause
        : {
            // The compiler answered `ok`, so there is no compiler detail to
            // carry — this drop is THIS file's match-all guard, and it names
            // itself rather than being reported as untranslatable.
            reason: 'match-all-criteria',
            detail:
              `the condition lowered to ${JSON.stringify(outcome.filter)}, which constrains nothing — ` +
              'seeding it would share every record of the object (ADR-0049)',
          };
      logger?.warn?.('[sharing-rule] skipped (missing or untranslatable CEL condition — never seeded as match-all) [experimental]', { rule: r.name, condition: r.condition, reason: cause.reason, detail: cause.detail });
      skipped += 1; continue;
    }
    const criteria: Record<string, unknown> = outcome.filter;
    try {
      await ruleService.defineRule({
        name: r.name,
        label: r.label ?? r.name,
        description: r.description ?? undefined,
        object: r.object,
        criteria,
        recipientType,
        recipientId: String(r.sharedWith.value),
        accessLevel: (r.accessLevel ?? 'read') as ShareAccessLevel,
        active: r.active !== false,
        // [#2909 P0] Declared rules ship with the app/package → seed mode:
        // pristine rows keep receiving declared updates; admin-authored or
        // customized rows are never clobbered (defineRule seed-not-clobber).
        managedBy: 'package',
      } as any, seedRuleCtx(organizationId) as any);
      seededNames.push(r.name);
      seeded += 1;
    } catch (err: any) {
      logger?.warn?.('[sharing-rule] seed failed', { rule: r.name, error: err?.message });
      skipped += 1;
    }
  }
  // The loud guard that stands in place of a reap, measured rather than
  // inferred. `defineRule` keys its upsert on `(name, organization_id)` once an
  // organization is in hand, so a pre-fix organization-less row can never be
  // mistaken for this organization's — which is precisely why the leftover is
  // INVISIBLE to the pass itself and has to be looked for. Reading the return
  // value of `defineRule` instead would be a check that can never fire: the row
  // it hands back is always this organization's own.
  const residue = organizationId ? await findOrganizationLessRules(engine, seededNames, organizationId) : [];
  if (organizationId && residue.length > 0) {
    logger?.warn?.(
      '[sharing-rule] declared rules did not resolve to this organization\u2019s own rows — a pre-fix ' +
        'organization-less sys_sharing_rule row is standing in for names this organization seeds. Under ' +
        'a walled posture a rule that belongs to no organization is invalid state, not a platform-wide ' +
        'default. Remedy: re-initialize the deployment, or adopt each row by hand by stamping it with ' +
        'the organization that should own it. They are NOT deleted automatically — sys_record_share ' +
        'rows reference these rules by id, so reaping them would revoke standing access with no signal.',
      { object: 'sys_sharing_rule', organization: organizationId, names: [...residue].sort(), count: residue.length },
    );
  }
  logger?.info?.('[sharing-rule] declared rules seeded into sys_sharing_rule', {
    seeded, skipped, total: rules.length, ...(organizationId ? { organization: organizationId } : {}),
  });
  return { seeded, skipped };
}
