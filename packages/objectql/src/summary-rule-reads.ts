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
 * "Read by a rule" is three classes, judged on the summary field that is read,
 * never on the object written:
 *
 * - (i) a validation rule of ANY object that reads the field one hop through a
 *   reference (`record.supplier.primary_contact_count`), by the same judgement
 *   that decides which hops a rule is hydrated for
 *   ({@link collectPredicateRelationships}) — the class #25579 covers for a
 *   multi-row insert;
 * - (ii) a field-level `requiredWhen` / `readonlyWhen` of a detail object that
 *   reads the field on its `parent` (the master-detail header), by field name;
 * - (iii) a rule of the summary's OWN object that reads the field on `record`
 *   or `previous`: a validation rule (a CEL condition, or the field a
 *   `state_machine` / `format` / `json_schema` rule names) or a field-level
 *   `requiredWhen` / `readonlyWhen`. The recompute's own write is an update of
 *   that row, judged by those rules: one by one they judge every intermediate
 *   value (an atomic move A→B then B→A over a cap refuses the first), so
 *   deferred they would judge only the last. That write also judges every
 *   value it stores against its declaration, so the same holds without a
 *   rule: a declared bound on the summary itself (`min`, `max`, `minLength`,
 *   `maxLength`, `pattern`, `precision`, `unique`, `required`, or an
 *   object-level unique index naming it) counts as reading it, and EVERY
 *   stored computed field of its object counts as read, bound or not, since
 *   the write computes it and judges it whatever it declares (a bound, an
 *   option list, a value domain, or a number that is not finite).
 *
 * A stored computed field (an `expression` on a field that is not a
 * `formula`) that reads another row one hop is stored from what it read at its
 * own write, so what it reads counts as read too: one by one each row stores a
 * value over the recompute of the rows before it.
 *
 * Then the set is closed over what the fields read are computed from: a
 * formula or stored computed field a rule reads reads what its expression
 * reads, and a summary over a summary that a rule reads makes the summary it
 * aggregates read too, so the chain recomputes row by row up to the rule.
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

/**
 * The declared bounds a write judges on the summary's stored value
 * (`validateRecord`'s `min_value` / `max_value` / `min_length` / `max_length`
 * / `max_precision` and `required` checks, and a field-level unique index).
 * `pattern` / `regex` are read by no check today: an over-read, which costs
 * only statements. A declared index with `unique` is read beside this list.
 */
const SUMMARY_BOUND_KEYS = ['min', 'max', 'minLength', 'maxLength', 'pattern', 'regex', 'precision', 'unique', 'required'] as const;

/** The fields an object-level declared index with `unique` names (`'global'`, `'organization'`, or a stored bare `true`). */
function uniquelyIndexed(indexes: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(indexes)) return out;
  for (const index of indexes) {
    if (!index || typeof index !== 'object') continue;
    const { unique, fields } = index as { unique?: unknown; fields?: unknown };
    if (unique === undefined || unique === null || unique === false || !Array.isArray(fields)) continue;
    for (const field of fields) if (typeof field === 'string') out.add(field);
  }
  return out;
}

/** The CEL roots a rule reads its own row under: the row, and the row before the write. */
const OWN_ROW_ROOTS = ['record', 'previous'] as const;

/** Every field `source` reads on `root`, as a value or through it. Empty when it does not parse. */
function fieldsReadOn(source: string, root: string): string[] {
  const analysis = analyzeRelationshipTraversals(source, root);
  return analysis ? [...analysis.bareFields, ...analysis.traversals.keys()] : [];
}

/**
 * (iii) The fields of its own row a validation rule reads: its CEL condition
 * (`script`, `cross_field`, a `conditional`'s `when`, at every depth) on
 * `record` or `previous`, and the field a `state_machine` / `format` /
 * `json_schema` rule names.
 */
function ownFieldsReadByRule(rule: unknown, out: Set<string>, depth = 0): void {
  if (!rule || typeof rule !== 'object' || depth > 8) return;
  const r = rule as { type?: unknown; condition?: unknown; when?: unknown; then?: unknown; otherwise?: unknown; field?: unknown };
  for (const slot of [r.condition, r.when]) {
    const source = celSource(slot);
    if (!source) continue;
    for (const root of OWN_ROW_ROOTS) for (const field of fieldsReadOn(source, root)) out.add(field);
  }
  if (typeof r.field === 'string' && r.field) out.add(r.field);
  if (r.type === 'conditional') {
    ownFieldsReadByRule(r.then, out, depth + 1);
    ownFieldsReadByRule(r.otherwise, out, depth + 1);
  }
}

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

/** An object definition as this module reads it. */
type ObjectDef = { name?: unknown; fields?: Record<string, Record<string, unknown> | null | undefined>; validations?: unknown[]; indexes?: unknown } | null | undefined;

/** The parts of a roll-up descriptor the chain closure reads. */
export interface ChainLink {
  parentObject: string;
  summaryField: string;
  childObject: string;
  sourceField?: string;
  filter?: Record<string, unknown>;
}

/**
 * The `<object>.<field>` keys a CEL source reads, evaluated against a row of
 * `object`: its own fields on `record` (as a value or as the reference a hop
 * goes through), and one hop through a reference to the target's field.
 */
function keysReadFrom(source: string, object: string, fields: NonNullable<NonNullable<ObjectDef>['fields']>, out: Set<string>): void {
  const analysis = analyzeRelationshipTraversals(source, 'record');
  if (!analysis) return;
  for (const field of analysis.bareFields) out.add(ruleReadKey(object, field));
  for (const [reference, related] of analysis.traversals) {
    out.add(ruleReadKey(object, reference));
    const target = referenceTargetOf(fields[reference] as never);
    if (!target) continue;
    for (const field of related) out.add(ruleReadKey(target, field));
  }
}

/**
 * Every `<object>.<field>` a rule of `objects` reads, closed over what those
 * fields are computed from. Direct reads: on another row through a reference,
 * one hop (class i), on the master-detail header by a field-level predicate
 * (class ii), or on its own row (class iii). Then, to a fixed point:
 *
 * - a computed field read (a `formula`, or a stored field with an
 *   `expression`) makes what its expression reads read too, on its own row and
 *   one hop through a reference: a rule reading `record.project.remaining`,
 *   where `remaining` is `record.budget - record.spent_total`, reads the
 *   summary `spent_total`;
 * - a summary read that aggregates a field of its child rows (`sourceField`,
 *   from `links`) makes that field read; a filtered one makes every summary of
 *   its child object read (the filter may name any of them). So a rule on the
 *   top of a chain of summaries keeps every link under it recomputing row by
 *   row, as one by one, where the rule judges each step.
 *
 * A field that is not a summary may be in the set; the caller asks only about
 * summary fields.
 */
export function summaryFieldsReadByRules(objects: Iterable<unknown>, links: Iterable<ChainLink> = []): Set<string> {
  const out = new Set<string>();
  /** `<object>.<field>` → the CEL source a computed field is computed from. */
  const computed = new Map<string, { source: string; object: string; fields: NonNullable<NonNullable<ObjectDef>['fields']> }>();
  for (const candidate of objects) {
    const schema = candidate as ObjectDef;
    const fields = schema?.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
    const name = typeof schema?.name === 'string' && schema.name ? schema.name : undefined;
    if (name) {
      for (const [field, def] of Object.entries(fields)) {
        const source = def && typeof def === 'object' ? celSource(def.expression) : undefined;
        if (source) computed.set(ruleReadKey(name, field), { source, object: name, fields });
      }
    }
    // (iii) A rule reading its own row: validation rules, then field-level predicates.
    const own = new Set<string>();
    if (Array.isArray(schema?.validations)) for (const rule of schema.validations) ownFieldsReadByRule(rule, own);
    for (const def of Object.values(fields)) {
      if (!def || typeof def !== 'object') continue;
      for (const slot of PARENT_PREDICATE_SLOTS) {
        const source = celSource(def[slot]);
        if (!source) continue;
        for (const root of OWN_ROW_ROOTS) for (const field of fieldsReadOn(source, root)) own.add(field);
      }
    }
    // (iii) What the recompute's own write judges without a rule. It stores
    // the summary and every stored computed field (an `expression` on a field
    // that is not a `formula`), computed onto its payload, and judges each
    // against its declaration (`validateRecord`, a unique index), so one by
    // one every intermediate value is judged. The summary counts when it
    // declares a bound or a unique index names it; a stored computed field
    // counts always, since its type alone can refuse a value (an option, a
    // value domain, a number that is not finite). The closure below adds
    // what a stored computed field reads.
    const indexed = uniquelyIndexed(schema?.indexes);
    for (const [field, def] of Object.entries(fields)) {
      if (!def || typeof def !== 'object') continue;
      if (def.type === 'summary') {
        if (indexed.has(field) || SUMMARY_BOUND_KEYS.some((key) => def[key] !== undefined && def[key] !== null && def[key] !== false)) own.add(field);
      } else if (def.type !== 'formula' && celSource(def.expression) !== undefined) {
        own.add(field);
      }
    }
    if (name) for (const field of own) out.add(ruleReadKey(name, field));
    // A stored computed field reading another row one hop (`record.inv.line_total`)
    // stores what it read at its own write: one by one each row reads the
    // recompute of the rows before it, so what it reads counts as read.
    if (name) {
      for (const def of Object.values(fields)) {
        if (!def || typeof def !== 'object' || def.type === 'formula') continue;
        const source = celSource(def.expression);
        if (!source) continue;
        const analysis = analyzeRelationshipTraversals(source, 'record');
        for (const [reference, related] of analysis?.traversals ?? []) {
          const target = referenceTargetOf(fields[reference] as never);
          if (target) for (const field of related) out.add(ruleReadKey(target, field));
        }
      }
    }
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
        const read = fieldsReadOn(source, PARENT_ROOT);
        if (read.length === 0) continue;
        // No single master-detail relation: `parent` is unbound and the
        // predicate faults where it is judged; it reads no header field.
        if (master === undefined) master = resolveMasterDetailRelation(schema as never)?.master ?? null;
        if (!master) continue;
        for (const field of read) out.add(ruleReadKey(master, field));
      }
    }
  }
  // The closure: computed fields, then summary chains, to a fixed point.
  const chain = [...links];
  let grew = true;
  while (grew) {
    grew = false;
    const add = new Set<string>();
    for (const key of out) {
      const formula = computed.get(key);
      if (formula) keysReadFrom(formula.source, formula.object, formula.fields, add);
    }
    for (const link of chain) {
      if (!out.has(ruleReadKey(link.parentObject, link.summaryField))) continue;
      if (link.sourceField) add.add(ruleReadKey(link.childObject, link.sourceField));
      if (link.filter && Object.keys(link.filter).length > 0) {
        for (const other of chain) if (other.parentObject === link.childObject) add.add(ruleReadKey(other.parentObject, other.summaryField));
      }
    }
    for (const key of add) if (!out.has(key)) { out.add(key); grew = true; }
  }
  return out;
}
