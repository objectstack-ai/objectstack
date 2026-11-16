// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33795] Which roll-up `summary` fields a rule reads (ruling 6928862195,
 * letter B: 「被规则读到的合计不延后」).
 *
 * A bulk update runs inside the engine's roll-up batch scope
 * (`deferSummaryRecompute`), which records each row's recompute and runs it
 * once when the batch ends. A rule that reads the parent's summary would then
 * read the value from before the batch on every row, where one-by-one updates
 * read each earlier row's recompute: "a supplier has at most one primary
 * contact" would admit two primaries set in one grid edit. So a summary field
 * a rule reads is NOT deferred: inside the scope its recompute runs after each
 * row, as it does outside one, and a rule's answer during a bulk update is the
 * answer one-by-one updates give, for every summary function.
 *
 * "Read by a rule" is two classes, judged on the summary field that is read,
 * never on the object written:
 *
 * - (i) a validation rule of ANY object that reads the field one hop through a
 *   reference (`record.supplier.primary_contact_count`), by the same judgement
 *   that decides which hops a rule is hydrated for
 *   ({@link collectPredicateRelationships}) — the class #25579 covers for a
 *   multi-row insert;
 * - (ii) a field-level `requiredWhen` / `readonlyWhen` of a detail object that
 *   reads the field on its `parent` (the master-detail header), by field name.
 *
 * ⛔ A `parent.` predicate that reads a field which is not a summary (the
 * showcase invoice line's `parent.status == 'paid'`) names that field and no
 * other, so it does not turn the deferral off. Hooks and flow steps are not
 * here: the engine cannot know what they read, and they read the pre-batch
 * value inside one batch, on create and update alike.
 */

import { analyzeRelationshipTraversals } from '@objectstack/formula';
import { referenceTargetOf } from '@objectstack/spec/data';
import { collectPredicateRelationships } from './validation/rule-validator.js';
import { resolveMasterDetailRelation } from './master-detail.js';

/** The CEL scope root a master-detail header is bound under (`rule-validator.ts`). */
const PARENT_ROOT = 'parent';

/** The field-level predicates that may read `parent` (#4889, #4977). */
const PARENT_PREDICATE_SLOTS = ['requiredWhen', 'readonlyWhen'] as const;

/** The CEL source of an authored predicate slot, or `undefined` when it is not CEL. */
function celSource(slot: unknown): string | undefined {
  if (typeof slot === 'string') return slot || undefined;
  if (!slot || typeof slot !== 'object') return undefined;
  const { dialect, source } = slot as { dialect?: unknown; source?: unknown };
  if (dialect !== undefined && dialect !== 'cel') return undefined;
  return typeof source === 'string' && source ? source : undefined;
}

/** The key {@link summaryFieldsReadByRules} answers in: `<object>.<field>`. */
export function ruleReadKey(object: string, field: string): string {
  return `${object}.${field}`;
}

/**
 * Every `<object>.<field>` a rule of `objects` reads on ANOTHER row: through a
 * reference, one hop (class i), or on the master-detail header by a
 * field-level predicate (class ii). A field that is not a summary may be in
 * the set; the caller asks only about summary fields.
 */
export function summaryFieldsReadByRules(objects: Iterable<unknown>): Set<string> {
  const out = new Set<string>();
  for (const candidate of objects) {
    const schema = candidate as { fields?: Record<string, Record<string, unknown> | null | undefined>; validations?: unknown[] } | null | undefined;
    const fields = schema?.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
    // (i) A validation rule reading through a reference, one hop.
    for (const [reference, related] of collectPredicateRelationships(schema as never)) {
      const target = referenceTargetOf(fields[reference] as never);
      if (!target) continue;
      for (const field of related) out.add(ruleReadKey(target, field));
    }
    // (ii) A field-level predicate reading the master-detail header.
    let master: string | null | undefined;
    for (const def of Object.values(fields)) {
      if (!def || typeof def !== 'object') continue;
      for (const slot of PARENT_PREDICATE_SLOTS) {
        const source = celSource(def[slot]);
        if (!source) continue;
        const analysis = analyzeRelationshipTraversals(source, PARENT_ROOT);
        if (!analysis) continue;
        const read = [...analysis.bareFields, ...analysis.traversals.keys()];
        if (read.length === 0) continue;
        // No single master-detail relation: `parent` is unbound and the
        // predicate faults where it is judged; it reads no header field.
        if (master === undefined) master = resolveMasterDetailRelation(schema as never)?.master ?? null;
        if (!master) continue;
        for (const field of read) out.add(ruleReadKey(master, field));
      }
    }
  }
  return out;
}
