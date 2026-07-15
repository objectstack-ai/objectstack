// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * bootstrapDeclaredSharingRules — seed stack-declared `sharingRules` into
 * `sys_sharing_rule` (ADR-0057 D6, closes #2077; reconciles #1887).
 *
 * The spec authoring shape (`SharingRuleSchema`: CEL `condition`, `ownedBy`,
 * `sharedWith{type,value}`) diverges from the enforced runtime shape
 * (`criteria_json` JSON filter + `recipient_type`/`recipient_id`). ADR-0057 D6
 * makes the RUNTIME shape canonical and translates only the directly-mappable
 * fields. Parts the runtime cannot enforce statically are SKIPPED (logged
 * `[experimental]`) rather than seeded as a match-all rule — silently
 * over-sharing would be worse than not enforcing (ADR-0049):
 *   - `owner`-type rules (`ownedBy`): role membership is dynamic, no static
 *     `criteria_json` equivalent.
 *   - a CEL `condition` the canonical compiler cannot lower (functions,
 *     cross-object traversal) — ADR-0058 D2. Compound predicates (AND/OR,
 *     comparisons, null, in) DO lower now and are enforced (ADR-0058 D3, #1887).
 *   - `sharedWith.type` of `group`/`guest`: no runtime recipient mapping.
 *
 * Seeding upserts via `SharingRuleService.defineRule` (idempotent by name) and
 * MUST run before `listRules()`/`bindRuleHooks` so the lifecycle hooks bind to
 * a populated table.
 */

import type { SharingRuleService } from './sharing-rule-service.js';
import type { SharingRuleRecipientType, ShareAccessLevel } from '@objectstack/spec/contracts';
import { compileCelToFilter } from '@objectstack/formula';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

type Logger = { info?: (m: string, meta?: any) => void; warn?: (m: string, meta?: any) => void };

/** Map the spec `sharedWith.type` onto a runtime recipient_type, or null. */
function mapRecipientType(t: unknown): SharingRuleRecipientType | null {
  switch (t) {
    case 'user': return 'user';
    case 'position': return 'position';
    // ADR-0057 D5: business-unit subtree recipient.
    case 'business_unit': return 'business_unit' as SharingRuleRecipientType;
    case 'unit_and_subordinates': return 'unit_and_subordinates' as SharingRuleRecipientType;
    default: return null; // group / guest — no runtime mapping yet
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
  const result = compileCelToFilter(cel as string | { source?: string }, { variables: {} });
  return result.ok ? (result.filter as Record<string, unknown>) : null;
}

function readDeclared(engine: any, type: string): any[] {
  try {
    const reg = engine?._registry;
    if (reg?.listItems) {
      return (reg.listItems(type) ?? []).map((i: any) => i?.content ?? i).filter(Boolean);
    }
  } catch { /* fall through */ }
  return [];
}

export async function bootstrapDeclaredSharingRules(
  ruleService: SharingRuleService,
  metadataService: any,
  engine: any,
  logger?: Logger,
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
  for (const r of rules) {
    if (!r?.name || !r?.object) { skipped += 1; continue; }
    const recipientType = mapRecipientType(r.sharedWith?.type);
    if (!recipientType || !r.sharedWith?.value) {
      logger?.warn?.('[sharing-rule] skipped (unmappable recipient) [experimental]', { rule: r.name, sharedWith: r.sharedWith?.type });
      skipped += 1; continue;
    }
    // owner-type rules have no static criteria_json equivalent.
    if (r.type === 'owner') {
      logger?.warn?.('[sharing-rule] skipped owner-based rule (no static criteria) [experimental]', { rule: r.name });
      skipped += 1; continue;
    }
    // criteria rules: translate CEL → filter. Empty condition = match-all (intentional).
    let criteria: Record<string, unknown> | undefined;
    if (r.condition != null && String(r.condition).trim() !== '') {
      const f = celToFilter(r.condition);
      if (!f) {
        logger?.warn?.('[sharing-rule] skipped (untranslatable CEL condition) [experimental]', { rule: r.name, condition: r.condition });
        skipped += 1; continue;
      }
      criteria = f;
    }
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
      } as any, SYSTEM_CTX as any);
      seeded += 1;
    } catch (err: any) {
      logger?.warn?.('[sharing-rule] seed failed', { rule: r.name, error: err?.message });
      skipped += 1;
    }
  }
  logger?.info?.('[sharing-rule] declared rules seeded into sys_sharing_rule', { seeded, skipped, total: rules.length });
  return { seeded, skipped };
}
