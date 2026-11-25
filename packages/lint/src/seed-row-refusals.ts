// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Seed records the seed load refuses, judged before the load runs: a record
 * its own object's validation rules refuse, and a keyed record that leaves a
 * key field blank (#35653, folding #35486).
 *
 * ## Why
 *
 * A seed write is held to the object's validation rules, every type but
 * `state_machine` (`shouldSkipStateMachine`, `@objectstack/objectql`): a
 * refused record is dropped from the load and the rest land. Until this
 * check, nothing at `os validate` / `os build` judged a seed record against
 * those rules, so the build read as passed and the first sign was a
 * `[Seeder] … dropped record(s)` line at boot carrying the rule's MESSAGE,
 * not its name. The ruling on the parent card: seed rows are not exempt from
 * the package's own rules, and a build whose seed rows its own rule refuses
 * reports it, naming the rule.
 *
 * ## One judge, injected
 *
 * ⛔ The verdict is never modelled here. It is the write path's own evaluator,
 * `evaluateValidationRules` (`@objectstack/objectql`), handed in by the door
 * that calls this (the CLI's `os validate` and `os build`): this package
 * depends on no runtime, and `@objectstack/objectql` depends on this package.
 * This module owns the WALK: which records, which rules, and which of a
 * rule's inputs are known before the load. Each rule is judged on its own, so
 * a refusal names the rule that refused.
 *
 * ## What is judged, and what is counted as not judged
 *
 * A (record, rule) pair is judged only when the load would hand the rule
 * exactly the values this walk can read from the record as written. Anything
 * the load computes, resolves or fills first makes the pair NOT JUDGED: it is
 * counted, never reported as a refusal, and the load still judges it. So a
 * finding here is a record the load refuses; silence is not a promise that it
 * admits one.
 *
 * Not judged, by reason ({@link SeedRowNotJudgedReason}):
 *  - `update-mode`: an `update` dataset judges the STORED row merged with the
 *    record, which only a database holds;
 *  - `hook`: a `beforeInsert` hook bound to the object runs before the rules
 *    and may write any field;
 *  - `rule-reads`: the rule reads beyond the record's own literal values — a
 *    root other than `record` (`previous`, `parent`, `current_user`, `os`), a
 *    hop through a reference (`record.account.type`), a source that is not
 *    CEL or does not parse, or a rule type the evaluator answers from outside
 *    the record (`json_schema` on a structured value);
 *  - `field-value`: a field the rule reads holds, or will hold, a value the
 *    load decides — a field the object does not declare (a platform-injected
 *    column), a `formula` / `summary` / `autonumber` field, a reference or
 *    file field (resolved from its natural key), an expression envelope or a
 *    `seedFile` reference, an empty string (stored as `null`), a value whose
 *    JavaScript type is not the stored one (`'100'` on a `number` field), a
 *    present value of a non-literal type (`date`, `datetime`, a JSON or
 *    multi-valued field), or an absent / `null` value the load fills from a
 *    default (`defaultValue`,
 *    an option marked `default`, or a picklist's options).
 *
 * Skipped without a count, as the load skips them: `state_machine` rules (seed
 * writes are exempt; `validateSeedStateMachine` judges the seeded value
 * instead), inactive rules, advisory rules (`severity` `warning` / `info`
 * never refuse a write), and rules whose `events` leave out `insert`. A
 * dataset whose object the stack does not declare has no rules to judge.
 *
 * What the stack cannot show is not counted either: a `beforeInsert` hook
 * registered in plugin code, or a write middleware that fills a business
 * field, runs at load and is invisible here. A stack that relies on one to
 * fill a field a rule reads can be refused here although the load admits it.
 *
 * A rule that cannot be EVALUATED on a judged pair (a `null` compared with
 * `<`, say) is reported: the write path fails such a rule closed, so the load
 * refuses that record too, with the sentence reported here.
 *
 * ## The blank key field (#35486)
 *
 * Every live seed mode is keyed (`ignore`, `upsert`, `update`), and the load
 * refuses a record whose literal value for a key field is blank — no value,
 * `null` or `''` (`blankSeedKeyRefusal`,
 * `packages/metadata-protocol/src/seed-loader.ts`). The finding carries that
 * refusal's sentence verbatim, built the same way; a CLI test pins the two
 * equal against the real loader. A key field holding an expression is not
 * judged (its value is known only at load), nor is the object's
 * organization column, which a per-organization load stamps before the check.
 * That column is the one the loader stamps (`seedRowTenantColumn`): the
 * column `resolveTenantFieldName` (`@objectstack/core`) walls the object by —
 * a declared `tenancy.tenantField` the object has, else `organization_id` —
 * and `organization_id` when it walls the object by none. The resolver is
 * injected by the door, as the evaluator is (this package does not depend on
 * `@objectstack/core`), so the column is never re-derived here. A record
 * refused for a blank key is not judged against the rules: the load refuses
 * it first.
 */

import { analyzeRelationshipTraversals, collectCelRootIdentifiers } from '@objectstack/formula';
import { isExpressionEnvelopeShaped } from '@objectstack/spec/automation';
import { isSeedFileReference } from '@objectstack/spec/data';
import { injectedColumnsFor } from './system-fields.js';

type AnyRec = Record<string, unknown>;

/** Rule id: a seed record its object's own validation rule refuses. */
export const SEED_ROW_REFUSED_BY_VALIDATION_RULE = 'seed-row-refused-by-validation-rule';
/** Rule id: a keyed seed record that leaves a key field blank. */
export const SEED_RECORD_KEY_FIELD_BLANK = 'seed-record-key-field-blank';

/** One seed record the seed load refuses. */
export interface SeedRowRefusal {
  rule: typeof SEED_ROW_REFUSED_BY_VALIDATION_RULE | typeof SEED_RECORD_KEY_FIELD_BLANK;
  /** Where the record sits, e.g. `data[2].records[4]`. */
  location: string;
  /** The dataset's object. */
  object: string;
  /** The record's index in its dataset. */
  recordIndex: number;
  /** The refusing validation rule's name (validation-rule refusals only). */
  validationRule?: string;
  /** The blank key field(s), comma-separated (blank-key refusals only). */
  field?: string;
  /** What the load reports for this record. */
  message: string;
}

export type SeedRowNotJudgedReason = 'update-mode' | 'hook' | 'rule-reads' | 'field-value';

export interface SeedRowJudgement {
  refusals: SeedRowRefusal[];
  /** (record, rule) pairs not judged here, by reason; the load still judges them. */
  notJudged: Record<SeedRowNotJudgedReason, number>;
}

/** The object shape the evaluator is handed: the declared fields and one rule. */
export interface SeedRuleObjectSchema {
  validations: unknown[];
  fields: Record<string, AnyRec>;
}

export interface SeedRowJudgeInput {
  /** The stack's datasets, each with its location (`data[0]`, `packages[1].manifest.data[0]`). */
  datasets: ReadonlyArray<{ dataset: unknown; location: string }>;
  /** The stack the datasets belong to, its package collections folded in: read for `objects` and `hooks`. */
  stack: AnyRec;
  /**
   * The write path's evaluator (`evaluateValidationRules`, `@objectstack/objectql`).
   * Throws the write's `VALIDATION_FAILED` error (a `fields` list) when the rule
   * refuses the record. Method syntax on purpose: the real evaluator's parameters
   * are the runtime's narrower types.
   */
  evaluateValidationRules(
    objectSchema: SeedRuleObjectSchema,
    data: AnyRec,
    mode: 'insert',
    options: { skipStateMachine: boolean },
  ): unknown;
  /**
   * The tenancy-scope predicate the seed loader stamps by
   * (`resolveTenantFieldName`, `@objectstack/core`): the column an object is
   * walled by, or `null` when it is walled by none.
   */
  resolveTenantFieldName(objectSchema: unknown): string | null;
}

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** The parse's default `externalId` (`SeedSchema`), also the loader's fallback. */
const DEFAULT_EXTERNAL_ID_FIELD = 'name';
/** The loader's organization column for an object walled by no column of its own (`DEFAULT_TENANT_FIELD`). */
const DEFAULT_ORGANIZATION_COLUMN = 'organization_id';

/** Field types whose value, as written, is the value a rule reads at load — and the JS type it must have. */
const LITERAL_FIELD_TYPES: ReadonlyMap<string, 'string' | 'number' | 'boolean'> = new Map([
  ['text', 'string'], ['textarea', 'string'], ['email', 'string'], ['url', 'string'], ['phone', 'string'],
  ['markdown', 'string'], ['html', 'string'], ['richtext', 'string'],
  ['select', 'string'], ['radio', 'string'],
  ['number', 'number'], ['currency', 'number'], ['percent', 'number'],
  ['boolean', 'boolean'], ['toggle', 'boolean'],
]);
/** Field types the load computes, whatever the record holds. */
const COMPUTED_FIELD_TYPES: ReadonlySet<string> = new Set(['formula', 'summary', 'autonumber']);

/** The load's blank rule for a key value (`isBlankSeedKeyValue`): no value, `null` or `''`, no trim. */
function isBlankKeyValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * The seed loader's refusal sentence for a blank key field, built as
 * `blankSeedKeyRefusal` builds it (`packages/metadata-protocol/src/seed-loader.ts`).
 * ⛔ Not reworded here: `seed-row-refusals-35653.test.ts` in `packages/cli`
 * holds this text equal to the loader's own.
 */
function blankKeyMessage(
  objectName: string,
  recordIndex: number,
  externalId: string | string[],
  blankFields: readonly string[],
  mode: string | undefined,
): string {
  const fields = Array.isArray(externalId) ? externalId : [externalId];
  const defaultKey = fields.length === 1 && fields[0] === DEFAULT_EXTERNAL_ID_FIELD;
  const keyLabel = `externalId '${fields.join('+')}'${defaultKey ? ' (also the key a dataset gets when it names none)' : ''}`;
  const blank = blankFields.map((field) => `'${field}'`).join(', ');
  const consequence = mode === 'update'
    ? 'so an update load can never find the row it names'
    : 'so no load can ever match it to a row it wrote: written, it would be inserted again on every load';
  return (
    `Seed record #${recordIndex} of '${objectName}' was NOT loaded: it is keyed on ${keyLabel} and leaves ` +
    `${blank} blank (no value, null or an empty string), ${consequence}. Give the record a value for ` +
    `${blank}, or key the dataset on fields every record carries: a field the object declares, a list of ` +
    `fields when no single field names a row, or 'id' when the records carry their own ids.`
  );
}

/** The stack's objects by name, from either spelling: the array or the name-keyed map. */
function objectsByName(stack: AnyRec): Map<string, AnyRec> {
  const out = new Map<string, AnyRec>();
  const value = stack.objects;
  const entries: Array<[string | undefined, unknown]> = Array.isArray(value)
    ? value.map((obj) => [undefined, obj])
    : isRec(value) ? Object.entries(value) : [];
  for (const [key, obj] of entries) {
    if (!isRec(obj)) continue;
    const name = typeof obj.name === 'string' && obj.name ? obj.name : key;
    if (name && !out.has(name)) out.set(name, obj);
  }
  return out;
}

/** The objects a `beforeInsert` hook is bound to; `'*'` binds every object. */
function beforeInsertHookObjects(stack: AnyRec): Set<string> {
  const out = new Set<string>();
  for (const hook of Array.isArray(stack.hooks) ? stack.hooks : []) {
    if (!isRec(hook) || !Array.isArray(hook.events) || !hook.events.includes('beforeInsert')) continue;
    const bound = Array.isArray(hook.object) ? hook.object : [hook.object];
    for (const name of bound) if (typeof name === 'string') out.add(name);
  }
  return out;
}

/** The CEL source of a predicate input; `undefined` for another dialect or no source. */
function celSource(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw;
  if (isRec(raw) && (raw.dialect === undefined || raw.dialect === 'cel') && typeof raw.source === 'string') return raw.source;
  return undefined;
}

/** The `record` fields one CEL predicate reads; `null` when it reads anything else or cannot be read. */
function predicateReads(raw: unknown): string[] | null {
  const source = celSource(raw);
  if (source === undefined) return null;
  const roots = collectCelRootIdentifiers(source);
  if (!roots.ok || roots.roots.some((root) => root !== 'record')) return null;
  const analysis = analyzeRelationshipTraversals(source, 'record');
  if (!analysis || analysis.traversals.size > 0) return null;
  return [...analysis.bareFields];
}

/** The fields a rule reads, as the evaluator dispatches it; `null` when it reads beyond the record. */
function ruleReads(rule: AnyRec): string[] | null {
  switch (rule.type) {
    case 'script':
    case 'cross_field':
      return predicateReads(rule.condition);
    case 'format':
    case 'state_machine':
      // A `state_machine` reaches here only as a `conditional` branch, where the
      // seed exemption does not reach (it filters top-level rules).
      return typeof rule.field === 'string' ? [rule.field] : null;
    case 'conditional': {
      const when = predicateReads(rule.when);
      if (when === null || !isRec(rule.then)) return null;
      const then = ruleReads(rule.then);
      const otherwise = rule.otherwise === undefined ? [] : isRec(rule.otherwise) ? ruleReads(rule.otherwise) : null;
      if (then === null || otherwise === null) return null;
      return [...new Set([...when, ...then, ...otherwise])];
    }
    default:
      // `json_schema` judges a structured value, which this walk does not read as
      // written; any other type the evaluator does not dispatch.
      return null;
  }
}

/** Does the load fill an absent or `null` value of this field before the rules run? */
function loadFillsBlank(def: AnyRec): boolean {
  if (def.defaultValue !== undefined && def.defaultValue !== null) return true;
  if (typeof def.picklist === 'string' && def.picklist.length > 0) return true;
  return Array.isArray(def.options) && def.options.some((o) => isRec(o) && o.default === true);
}

/** Does the record hold anything the load rewrites before the write? */
function rewrittenAtLoad(value: unknown): boolean {
  if (isExpressionEnvelopeShaped(value) || isSeedFileReference(value)) return true;
  if (Array.isArray(value)) return value.some(rewrittenAtLoad);
  if (isRec(value)) return Object.values(value).some(rewrittenAtLoad);
  return false;
}

/** Is the value the record holds for `field` the value the rule reads at load? */
function fieldKnown(record: AnyRec, field: string, fields: AnyRec, injected: ReadonlySet<string>): boolean {
  const def = fields[field];
  if (!isRec(def) || injected.has(field)) return false;
  const type = typeof def.type === 'string' ? def.type : '';
  if (COMPUTED_FIELD_TYPES.has(type)) return false;
  const value = record[field];
  if (value === undefined || value === null) return !loadFillsBlank(def);
  if (rewrittenAtLoad(value) || value === '' || def.multiple === true) return false;
  const jsType = LITERAL_FIELD_TYPES.get(type);
  return jsType !== undefined && typeof value === jsType;
}

/**
 * The field map the evaluator is handed: the declared fields, without the
 * field-level predicates (`requiredWhen`, `readonlyWhen`, `visibleWhen`, an
 * option's `visibleWhen`), so a call judges the one rule it is given and no
 * field rule beside it.
 */
function ruleOnlyFields(fields: AnyRec): Record<string, AnyRec> {
  const out: Record<string, AnyRec> = {};
  for (const [name, def] of Object.entries(fields)) {
    if (!isRec(def)) continue;
    const { requiredWhen: _r, readonlyWhen: _ro, visibleWhen: _v, ...rest } = def;
    if (Array.isArray(rest.options)) {
      rest.options = rest.options.map((o) => {
        if (!isRec(o)) return o;
        const { visibleWhen: _ov, ...option } = o;
        return option;
      });
    }
    out[name] = rest;
  }
  return out;
}

/** The refusal sentence a `VALIDATION_FAILED` throw carries; rethrows anything else. */
function refusalMessage(err: unknown): string {
  const refused = err as { code?: unknown; fields?: Array<{ message?: unknown }> } | null;
  if (refused?.code !== 'VALIDATION_FAILED' || !Array.isArray(refused.fields)) throw err;
  return refused.fields.map((f) => String(f.message)).join('; ');
}

/**
 * Judge every seed record of `datasets` the way the seed load judges it: a
 * blank key field first, then each of its object's validation rules that the
 * record's own values decide. Returns the refusals and the count of pairs
 * left to the load. Reads only; the stack is not modified.
 */
export function judgeSeedRowRefusals(input: SeedRowJudgeInput): SeedRowJudgement {
  const judgement: SeedRowJudgement = {
    refusals: [],
    notJudged: { 'update-mode': 0, hook: 0, 'rule-reads': 0, 'field-value': 0 },
  };
  const objects = objectsByName(input.stack);
  const hooked = beforeInsertHookObjects(input.stack);
  const hookedAll = hooked.has('*');

  for (const { dataset, location } of input.datasets) {
    if (!isRec(dataset) || typeof dataset.object !== 'string' || !Array.isArray(dataset.records)) continue;
    const objectName = dataset.object;
    const mode = typeof dataset.mode === 'string' ? dataset.mode : undefined;
    const externalId = (typeof dataset.externalId === 'string' && dataset.externalId)
      || (Array.isArray(dataset.externalId) && dataset.externalId.length > 0 ? (dataset.externalId as string[]) : DEFAULT_EXTERNAL_ID_FIELD);
    const obj = objects.get(objectName);
    // The column the load stamps before its blank check, resolved as the
    // loader resolves it: `seedRowTenantColumn(definition) ?? DEFAULT_TENANT_FIELD`.
    const organizationColumn = (obj ? input.resolveTenantFieldName(obj) : null) ?? DEFAULT_ORGANIZATION_COLUMN;
    const keyFields = (Array.isArray(externalId) ? externalId : [externalId])
      .filter((field) => field !== organizationColumn);

    const fields = obj && isRec(obj.fields) ? obj.fields : undefined;
    const rules = obj && Array.isArray(obj.validations)
      ? obj.validations.filter((r): r is AnyRec =>
          isRec(r)
          && r.type !== 'state_machine'
          && r.active !== false
          && (r.severity ?? 'error') === 'error'
          && (!Array.isArray(r.events) || r.events.includes('insert')))
      : [];
    const injected = obj ? injectedColumnsFor(obj) : new Set<string>();
    const reads = new Map(rules.map((rule) => [rule, ruleReads(rule)] as const));
    const evaluatorFields = fields && rules.length > 0 ? ruleOnlyFields(fields) : {};

    dataset.records.forEach((record, r) => {
      if (!isRec(record)) return;
      const at = `${location}.records[${r}]`;

      const blank = keyFields.filter((field) => {
        const value = record[field];
        return !isExpressionEnvelopeShaped(value) && isBlankKeyValue(value);
      });
      if (blank.length > 0) {
        judgement.refusals.push({
          rule: SEED_RECORD_KEY_FIELD_BLANK,
          location: at,
          object: objectName,
          recordIndex: r,
          field: blank.join(', '),
          message: blankKeyMessage(objectName, r, externalId, blank, mode),
        });
        return;
      }

      if (!fields || rules.length === 0) return;
      for (const rule of rules) {
        if (mode === 'update') { judgement.notJudged['update-mode']++; continue; }
        if (hookedAll || hooked.has(objectName)) { judgement.notJudged.hook++; continue; }
        const read = reads.get(rule);
        if (read === null || read === undefined) { judgement.notJudged['rule-reads']++; continue; }
        if (!read.every((field) => fieldKnown(record, field, fields, injected))) {
          judgement.notJudged['field-value']++;
          continue;
        }
        try {
          input.evaluateValidationRules(
            { validations: [rule], fields: evaluatorFields },
            { ...record },
            'insert',
            { skipStateMachine: true },
          );
        } catch (err) {
          const ruleName = typeof rule.name === 'string' ? rule.name : '(unnamed)';
          judgement.refusals.push({
            rule: SEED_ROW_REFUSED_BY_VALIDATION_RULE,
            location: at,
            object: objectName,
            recordIndex: r,
            validationRule: ruleName,
            message: `Seed record #${r} of '${objectName}' is refused by its validation rule '${ruleName}': ${refusalMessage(err)}`,
          });
        }
      }
    });
  }
  return judgement;
}

/** The total of {@link SeedRowJudgement.notJudged}. */
export function seedRowPairsNotJudged(judgement: SeedRowJudgement): number {
  return Object.values(judgement.notJudged).reduce((sum, n) => sum + n, 0);
}
