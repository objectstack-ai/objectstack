// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build-time expression validation (ADR-0032 §Decision 1a + 1b).
 *
 * Runs at `objectstack compile`, where the whole normalized stack is in hand —
 * so flow conditions can be checked against the *resolved* object schema
 * (field existence) in addition to CEL syntax. Uses the one shared validator
 * from `@objectstack/formula`, so the verdict matches `registerFlow` and the
 * agent `validate_expression` tool exactly.
 *
 * Scope: flow predicates (start/decision `config.condition` + edge `condition`),
 * every **descriptor-declared** expression slot named by
 * `FLOW_NODE_EXPRESSION_PATHS` (#4027 — e.g. a screen field's `visibleWhen`),
 * object validation-rule / formula predicates, and UI action `visible` /
 * `disabled` predicates. Each error is located (flow/object/action +
 * node/edge/field) with a corrective message.
 *
 * Since #4763 it also carries the **null-guard** verdict: an ordering /
 * arithmetic operator applied to a nullable declared field that no `!= null`
 * test dominates is rejected here, so the `has(a) && has(b) && a < b` trap
 * (which reads as a guard and is not one) never reaches a production write.
 * See `validate-null-guards.ts` for the decision procedure and its scope.
 *
 * ## Scope — the keys this rule reads, and the ones it deliberately does not
 *
 * This rule is registered `input: 'parsed'` (`authoring-rules.ts`), so what it
 * sees on the compile path is what `ObjectStackSchema` returned. Every key it
 * reads is one `@objectstack/spec` DECLARES. That is a contract, not a style
 * preference: the strict sub-schemas reject an undeclared key by NAME, so a
 * branch keyed on one is inert for every stack an author can ship (#4984,
 * #5009, #5017).
 *
 * | Read                                   | Declared by                       |
 * |----------------------------------------|-----------------------------------|
 * | `objects[].validations[]`              | `ObjectSchema`                    |
 * | `validations[].condition` / `.when` / `.then` / `.otherwise` | the six `*ValidationSchema` variants |
 * | `objects[].fields[].reference`         | `FieldSchema`                     |
 * | `objects[].fields[].expression`        | `FieldSchema`                     |
 * | `objects[].fields[].options`           | `FieldSchema`                     |
 * | `options[].value` / `.visibleWhen`     | `SelectOptionSchema`              |
 * | `actions[].objectName`                 | the action schema                 |
 * | `sharingRules[].condition` / `.object` | `SharingRuleSchema`               |
 *
 * NOT read, and each for a reason that is a schema fact (all verified against
 * the live `.shape` in `validate-expressions.test.ts`):
 *
 * - `objects[].validationRules` — `ObjectSchema` declares `validations` and is
 *   strict; the alias is refused with "Did you mean `validationRules` →
 *   `validations`?".
 * - `validations[].expression` / `.predicate` / `.formula` / `.rule` — the four
 *   names `validation.zod.ts` lists in `aliases: { … : 'condition' }`, i.e. the
 *   ones it rejects by name. This one was the worst of the family: the chain
 *   read them BEFORE `condition`, so for a rule carrying both spellings the
 *   canonical predicate was short-circuited away and the rejected alias
 *   validated in its place. Producer and consumer gave two different accounts
 *   of the same metadata (#5017).
 * - `sharingRules[].criteria` / `.predicate` — `criteria` is the runtime's own
 *   spelling of the COMPILED predicate (`criteria_json`), mapped back to the
 *   authored `condition` in the schema's rejection (#3896); `predicate` is
 *   refused outright. #4984 removed the same pair from the org-axis rule.
 * - `objects[].fields[].referenceTo` — `field.zod.ts:331` maps it (with
 *   `relatedTo` / `target` / `targetObject` / `lookupObject`) to `reference`.
 * - `actions[].object` — the action schema's own rejection says "Did you mean
 *   `object` → `objectName`?".
 * - `objects[].fields[].formula` / `.calculation` / `.compute` — the three names
 *   `field.zod.ts:333` aliases back to `expression`. The field-formula pass read
 *   `formula` until #5026, so it had never run against a stack that parses;
 *   converging it onto `expression` ACTIVATED the check rather than deleting a
 *   dead branch, which is why it moved on its own PR with a real-metadata sweep
 *   attached rather than riding along with #5017's five removals.
 *
 * Alias tolerance belongs at the schema's refusal, not in a consumer (Prime
 * Directive #12) — in a consumer it also converts a loud, named rejection into
 * a silently-inert (or, above, silently-WRONG) gate.
 *
 * Every read in this file is now a key the spec declares; the meta-guard in
 * `validate-expressions.test.ts` pins that with no tracked exceptions left.
 */

import { validateExpression, collectCelRootIdentifiers, parseCelToAst, SCOPE_ROOTS } from '@objectstack/formula';
import { collectFlowGraphs, resolveFlowNodeExpressions } from '@objectstack/spec/automation';
import type { FlowNodeParsed } from '@objectstack/spec/automation';

import { injectedColumnsFor, unprovisionedInjectedColumnsFor } from './system-fields.js';
import { findUnguardedNullableOperands, nullGuardMessage } from './validate-null-guards.js';
import type { NullGuardOutcome } from './validate-null-guards.js';

export interface ExprIssue {
  where: string;
  message: string;
  source: string;
  /**
   * `error` fails the build (e.g. a bare ref in a record-scoped formula). `warning`
   * is advisory and never fails it (e.g. a possible field typo in a flattened flow
   * condition, which might be a flow variable). Absent ⇒ treat as `error`.
   */
  severity?: 'error' | 'warning';
}

type AnyRec = Record<string, unknown>;

/** Coerce an `objects` collection (array or name-keyed map) to an array. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

/**
 * object name → set of its field names, for schema-aware field checks.
 *
 * Authored fields UNION the system columns the platform injects on that object
 * (#5378). Both halves are needed because the runtime resolves both: a predicate
 * saying `has(record.owner_id)` on an object that never declares `owner_id`
 * evaluates fine, because the registry provisioned the column — so rejecting it
 * here was the platform's own linter denying the platform's own contract, and it
 * pushed apps into re-declaring system columns purely to satisfy this pass
 * (hotcrm#548 declared `owner_id` on all 12 business objects for that reason).
 *
 * The injected half is CONDITIONAL, per object, via the spec derivation the
 * registry itself consumes — not a blanket allowance of every system name. That
 * distinction is the whole value: on `ownership: 'none'` the platform injects no
 * `owner_id`, so `record.owner_id` there stays the error it should be. A blanket
 * union would have traded a false positive for a false negative and called it
 * fixed.
 */
function buildFieldIndex(objects: AnyRec[]): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const obj of objects) {
    const name = typeof obj.name === 'string' ? obj.name : undefined;
    if (!name) continue;
    const fields = obj.fields;
    let names: string[] = [];
    if (Array.isArray(fields)) names = fields.map(f => (f as AnyRec).name).filter((n): n is string => typeof n === 'string');
    else if (fields && typeof fields === 'object') names = Object.keys(fields as AnyRec);
    // Injected columns come second, de-duplicated by insertion order: a DECLARED
    // `owner_id` is the author's field (the registry lets it win), so the
    // authored spelling keeps its position in the "did you mean?" candidates.
    idx.set(name, [...new Set([...names, ...injectedColumnsFor(obj)])]);
  }
  return idx;
}

/**
 * [#8116] The roots this file's unprovisioned-anchor warning resolves against
 * the bound object — the same pair the #4763 null-guard gate resolves, for the
 * same reason: both bind the object's record shape, so a single-segment member
 * read off either names one of the object's columns.
 */
const BOUND_RECORD_ROOTS = ['record', 'previous'] as const;

/** Minimal structural view of a `parseCelToAst` node (`{ op, args }`). */
type CelNodeLike = { op?: string; args?: unknown };

function isCelNode(v: unknown): v is CelNodeLike {
  return !!v && typeof v === 'object' && typeof (v as CelNodeLike).op === 'string';
}

/**
 * [#8116] Every single-segment `record.<f>` / `previous.<f>` member read in
 * the source, as `field → operand-as-written` (first spelling wins). Empty
 * when the source does not parse — the syntax pass owns that defect, and one
 * broken predicate must produce one finding, not two.
 *
 * Deliberately NEVER a bare identifier: in a flattened flow scope a bare name
 * may be a flow variable, and a false finding here is the trust-killer
 * ADR-0072 D1 names. A `has(record.x)` guard is covered for free — `record.x`
 * is an ordinary member-read node inside the call's argument list. Nested
 * traversal (`record.owner_id.name`) contributes its FIRST segment, which is
 * the column the query engine must resolve on this object.
 */
function collectBoundRecordReads(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const ast = parseCelToAst(source);
  if (!ast) return out;
  // NB: local names are chosen to stay out of the #5017 meta-guard's receiver
  // scan (`node` is a METADATA receiver there — flow `nodes[]` — and this walk
  // reads AST internals, not metadata keys).
  const pending: unknown[] = [ast];
  while (pending.length > 0) {
    const celNode = pending.pop();
    if (!isCelNode(celNode)) continue;
    if (
      (celNode.op === '.' || celNode.op === '.?') &&
      Array.isArray(celNode.args) &&
      celNode.args.length >= 2
    ) {
      const [celRecv, seg] = celNode.args as [unknown, unknown];
      if (
        typeof seg === 'string' &&
        isCelNode(celRecv) &&
        celRecv.op === 'id' &&
        typeof celRecv.args === 'string' &&
        (BOUND_RECORD_ROOTS as readonly string[]).includes(celRecv.args)
      ) {
        if (!out.has(seg)) out.set(seg, `${celRecv.args}.${seg}`);
      }
    }
    const celArgs = celNode.args;
    if (isCelNode(celArgs)) pending.push(celArgs);
    else if (Array.isArray(celArgs)) {
      for (const a of celArgs) {
        if (isCelNode(a)) pending.push(a);
        else if (Array.isArray(a)) for (const b of a) if (isCelNode(b)) pending.push(b);
      }
    }
  }
  return out;
}

/**
 * object name → (field name → field type), for the #1928 tier-4 type-soundness
 * check. Handles both `fields` shapes (array of `{name, type}` and name-keyed
 * map). Fields with a non-string `type` are simply omitted (treated as `dyn`).
 *
 * DECLARED fields only — deliberately NOT widened with the injected columns
 * {@link buildFieldIndex} resolves (#5378). Their TYPES are the registry's
 * (`AUDIT_FIELD_DEFS` and its siblings own what each column looks like; the spec
 * derivation owns only which ones exist), so typing them here would be the
 * hand-copied second table this change exists to avoid. Omitted ⇒ `dyn` ⇒ no
 * type-soundness verdict on an injected column, which is the safe direction: the
 * pass gains no false finding, it simply does not cover them yet.
 */
function buildFieldTypeIndex(objects: AnyRec[]): Map<string, Record<string, string>> {
  const idx = new Map<string, Record<string, string>>();
  for (const obj of objects) {
    const name = typeof obj.name === 'string' ? obj.name : undefined;
    if (!name) continue;
    const fields = obj.fields;
    const types: Record<string, string> = {};
    if (Array.isArray(fields)) {
      for (const f of fields as AnyRec[]) {
        const fn = (f as AnyRec)?.name;
        const ft = (f as AnyRec)?.type;
        if (typeof fn === 'string' && typeof ft === 'string') types[fn] = ft;
      }
    } else if (fields && typeof fields === 'object') {
      for (const [fn, def] of Object.entries(fields as AnyRec)) {
        const ft = (def as AnyRec)?.type;
        if (typeof ft === 'string') types[fn] = ft;
      }
    }
    idx.set(name, types);
  }
  return idx;
}

/** The field list of an object, whichever of the two `fields` shapes it uses. */
function fieldEntries(obj: AnyRec): Array<[string, AnyRec]> {
  const fields = obj.fields;
  if (Array.isArray(fields)) {
    return (fields as AnyRec[])
      .filter((f) => f && typeof f === 'object' && typeof f.name === 'string')
      .map((f) => [f.name as string, f] as [string, AnyRec]);
  }
  if (fields && typeof fields === 'object') {
    return Object.entries(fields as AnyRec)
      .filter(([, def]) => !!def && typeof def === 'object')
      .map(([n, def]) => [n, def as AnyRec] as [string, AnyRec]);
  }
  return [];
}

/**
 * Can this declared field hold `null` when a predicate reads it? (#4763)
 *
 * Deliberately conservative — this feeds a **build-breaking** verdict, so every
 * uncertainty resolves to "not nullable" (no finding). A field is treated as
 * always-valued when it is `required`, carries a `defaultValue`, declares a
 * default option (`options: [{ …, default: true }]` — the select idiom), or is
 * an autonumber the platform populates.
 *
 * The select-idiom branch is grounded, not assumed (#7246). It was the only
 * consumer of `SelectOption.default` anywhere in the repo while the insert path
 * ignored the key entirely, so it concluded "always valued" about a column that
 * really did store `null` — a build-breaking verdict resting on a declaration
 * nothing honoured, and a predicate reading such a field could be silenced by
 * it. `ObjectQL.applyFieldDefaults` now falls back to the marked option when
 * the field declares no `defaultValue`, so the premise this branch always
 * stated is true on the write path. The two sides are kept honest BY
 * CONSTRUCTION: the engine reads the canonical `default` spelling, without a
 * `type` test, exactly as this does — so there is no field this calls
 * always-valued that the engine leaves empty.
 */
function isNullableField(def: AnyRec): boolean {
  if (def.required === true) return false;
  if (def.defaultValue !== undefined && def.defaultValue !== null) return false;
  if (def.type === 'autonumber') return false;
  const options = def.options;
  if (Array.isArray(options) && options.some((o) => !!o && typeof o === 'object' && (o as AnyRec).default === true)) {
    return false;
  }
  return true;
}

/**
 * object name → set of field names that may hold `null` (#4763).
 *
 * DECLARED fields only, like {@link buildFieldTypeIndex} and for a sharper
 * reason: this index feeds a BUILD-BREAKING verdict, so adding the injected
 * columns {@link buildFieldIndex} now resolves would turn `record.created_at`
 * comparisons into errors on stacks that ship today. Nullability there is also
 * genuinely per-column and not derivable from the existence plan — the driver
 * always populates `created_at`, while `owner_id` really can be NULL — so it
 * needs the registry's column definitions, not this module's guesses. Leaving
 * them out costs coverage, never a false error.
 */
function buildNullableFieldIndex(objects: AnyRec[]): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  for (const obj of objects) {
    const name = typeof obj.name === 'string' ? obj.name : undefined;
    if (!name) continue;
    const nullable = new Set<string>();
    for (const [fname, def] of fieldEntries(obj)) {
      if (isNullableField(def)) nullable.add(fname);
    }
    idx.set(name, nullable);
  }
  return idx;
}

/**
 * [#4889] Does this CEL source read the `parent` root — the master-detail
 * header the write path binds for a detail object's field predicates?
 *
 * Decided from the parsed AST (the same `collectCelRootIdentifiers` the runtime
 * gate uses, so build and runtime can never disagree about what "reads
 * `parent`" means), never a substring scan: a field named `parent_id`, or the
 * string literal `'parent'`, is not a reference to the binding. A source that
 * does not parse answers `false` — the ordinary syntax pass already reports it,
 * and this gate must not report the same defect twice under a worse name.
 */
function readsParentRoot(source: string): boolean {
  const roots = collectCelRootIdentifiers(source);
  return roots.ok && roots.roots.includes('parent');
}

/**
 * The number of `master_detail` relationships an object declares — what decides
 * whether `parent` is a fact the metadata states (#4889). Exactly one ⇒ the
 * write path binds that master as `parent`. Zero ⇒ nothing to bind. Two ⇒ no
 * single "the parent", and picking one by declaration order would make a
 * data-integrity lock depend on field ordering.
 */
function masterDetailCount(obj: AnyRec): number {
  let n = 0;
  for (const [, def] of fieldEntries(obj)) {
    if (def.type !== 'master_detail') continue;
    // `reference` is the ONLY spelling `FieldSchema` declares. `referenceTo`
    // (with `relatedTo` / `target` / `targetObject` / `lookupObject`) is a
    // rejected alias — `field.zod.ts:331` maps it to `reference` in the strict
    // error map, so a field spelling it does not parse (#5017). See the
    // `## Scope` table on this module for why a consumer must not re-admit it.
    const ref = def.reference;
    if (typeof ref === 'string' && ref.trim() !== '') n += 1;
  }
  return n;
}

/** The raw CEL source behind a predicate slot (string or `{ dialect, source }`). */
function celSourceOf(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const rec = raw as AnyRec;
    // A non-CEL dialect (`js`) has its own null semantics — not ours to judge.
    if (typeof rec.dialect === 'string' && rec.dialect !== 'cel') return undefined;
    if (typeof rec.source === 'string') return rec.source;
  }
  return undefined;
}

/**
 * Every predicate a validation rule carries, including the ones nested inside a
 * `conditional` rule's `then` / `otherwise` — the trap hides there just as
 * happily as at the top level.
 */
function rulePredicates(rule: AnyRec, path: string): Array<{ label: string; raw: unknown }> {
  const out: Array<{ label: string; raw: unknown }> = [];
  const name = typeof rule.name === 'string' ? rule.name : '?';
  const here = path ? `${path} → '${name}'` : `'${name}'`;
  // `condition` is the declared predicate key on every validation-rule variant
  // that has one (`script`, `cross_field`). `expression` / `predicate` /
  // `formula` / `rule` are the four names `validation.zod.ts` REJECTS by name
  // (`aliases: { formula: 'condition', expression: 'condition', predicate:
  // 'condition', rule: 'condition' }`), so a rule spelling any of them does not
  // parse. Reading them here put the canonical key in THIRD position — an
  // author who wrote both `condition` and a rejected alias had their canonical
  // predicate short-circuited away and the alias validated instead (#5017).
  const main = rule.condition;
  if (main != null) out.push({ label: `validation rule ${here}`, raw: main });
  if (rule.when != null) out.push({ label: `validation rule ${here} when-predicate`, raw: rule.when });
  for (const branch of ['then', 'otherwise'] as const) {
    const nested = rule[branch];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      out.push(...rulePredicates(nested as AnyRec, `${here} ${branch}`));
    }
  }
  return out;
}

/**
 * Validate every predicate in the stack. Returns the list of issues (empty =
 * clean). Caller decides how to surface / whether to fail the build.
 */
export function validateStackExpressions(stack: AnyRec): ExprIssue[] {
  const issues: ExprIssue[] = [];
  const objects = asArray(stack.objects);
  const fieldIndex = buildFieldIndex(objects);
  const fieldTypeIndex = buildFieldTypeIndex(objects);
  const nullableIndex = buildNullableFieldIndex(objects);

  // [#8116] object name → the injected anchors registered with NO storage
  // behind them (non-empty only for ADR-0015 `external` objects). The other
  // half of {@link buildFieldIndex}'s #5378 widening: the anchors ARE
  // addressable — the field-existence pass rightly resolves them — but on a
  // federated object nothing backs them, so a predicate over one silently
  // matches nothing. Existence stays green; provenance warns.
  const unprovisionedIndex = new Map<string, ReadonlySet<string>>();
  for (const obj of objects) {
    const name = typeof obj.name === 'string' ? obj.name : undefined;
    if (!name) continue;
    const anchors = unprovisionedInjectedColumnsFor(obj);
    if (anchors.size > 0) unprovisionedIndex.set(name, anchors);
  }

  /**
   * [#8116] The unprovisioned-anchor warning — the author-time half of the
   * #7865 provenance marker (runtime halves: #7833 / #7859 / #7858). Fires on
   * a `record.<anchor>` / `previous.<anchor>` read where the anchor is an
   * injected system column the platform registers on this `external` object
   * but provisions no storage for.
   *
   * `warning`, not `error`, on the #7219 family's criterion: an error needs a
   * closed oracle, and this pass cannot see the remote table — it knows the
   * anchor has no PLATFORM storage, not what the deployment's remote schema or
   * a runtime plugin might resolve. The runtime degradation is also non-fatal
   * (silently empty results), the class this package reports advisorily; and
   * the security-critical member of the class is already fenced at runtime by
   * the #7859/#7858 guards. An author-DECLARED column of the same name is the
   * author's (`'author'` provenance — it maps a remote column they vouch for)
   * and never enters the index, so the tenant-wall case #7859 protects stays
   * silent here too.
   */
  const warnUnprovisionedAnchors = (where: string, raw: unknown, objectName?: string): void => {
    if (!objectName) return;
    const anchors = unprovisionedIndex.get(objectName);
    if (!anchors) return;
    const source = celSourceOf(raw);
    if (!source) return;
    for (const [field, operand] of collectBoundRecordReads(source)) {
      if (!anchors.has(field)) continue;
      issues.push({
        where,
        message:
          `\`${operand}\` reads '${field}', an injected system column with NO storage behind it: ` +
          `'${objectName}' is an external object (ADR-0015), so the remote database owns its schema ` +
          `and the platform registers this anchor without provisioning a column. The predicate can ` +
          `never match a real value — on SQLite it silently degrades to constant-false (HTTP 200, ` +
          `zero rows, no error). If the remote table really carries this column, declare '${field}' ` +
          `in the object's own fields (mapped through the external binding's columnMap) so the ` +
          `reference resolves to a column you vouch for; otherwise drop the reference, or opt the ` +
          `object out of the injection (\`ownership: 'none'\` for the ownership anchors, ` +
          `\`systemFields: { audit: false }\` for the audit family).`,
        source,
        severity: 'warning',
      });
    }
  };

  /**
   * The #4763 null-guard gate. Wired to exactly those surfaces whose predicates
   * CEL evaluates over a record made **total** for every declared field
   * (`materializeDeclaredFields`, #1871/#4649) — today: object validation rules
   * (`rule-validator.ts`, fail-closed since #4761), lifecycle hook `condition`s,
   * and field `requiredWhen` (#4811).
   *
   * Totality is the criterion that can DISQUALIFY a surface: on a total binding
   * `has()` is uniformly true and `!= null` is the fix, while on a SPARSE one
   * `has()` is a genuine guard and `!= null` faults with `No such key` — so
   * pointing this gate at a sparse-bound surface would reject correct metadata
   * and prescribe a fix that breaks it. It is not by itself a licence to cover:
   * since #6454 field `readonlyWhen` is total and still excluded, by clause 3 of
   * the #4953 ruling (the gate widens only once BOTH server-side seams are
   * total, and the flow trigger-record half is not wired yet).
   * `validate-null-guards.ts` carries the measured evidence table and the
   * per-surface ledger (action predicates, flow conditions, field
   * `readonlyWhen`, sharing rules and `Field.formula` are each excluded there
   * with a traced reason, and the reasons are no longer all the same one). Read
   * it before extending this call.
   */
  const checkNullGuards = (
    where: string,
    subject: string,
    raw: unknown,
    objectName: string | undefined,
    // What THIS surface's runtime does once the predicate aborts. Passed
    // explicitly rather than inferred, because the two possibilities are
    // opposite failures and the message has to name the right one (#4811).
    outcome: NullGuardOutcome = 'fail-closed',
  ): void => {
    if (!objectName) return;
    const nullableFields = nullableIndex.get(objectName);
    if (!nullableFields || nullableFields.size === 0) return;
    const source = celSourceOf(raw);
    if (!source) return;
    for (const finding of findUnguardedNullableOperands(source, { nullableFields })) {
      issues.push({
        where,
        message: nullGuardMessage(subject, objectName, finding, outcome),
        source,
        severity: 'error',
      });
    }
  };

  const check = (
    where: string,
    raw: unknown,
    objectName?: string,
    scope: 'record' | 'flattened' = 'flattened',
  ): void => {
    if (raw == null) return;
    const fields = objectName ? fieldIndex.get(objectName) : undefined;
    // Field types feed the #1928 tier-4 soundness warning; only consulted for
    // `record`-scoped sites, so it is harmless to pass for flattened ones too.
    const fieldTypes = objectName ? fieldTypeIndex.get(objectName) : undefined;
    const res = validateExpression('predicate', raw as string | { dialect?: string; source?: string },
      objectName ? { objectName, fields, fieldTypes, scope } : { scope });
    for (const e of res.errors) issues.push({ where, message: e.message, source: e.source, severity: 'error' });
    for (const w of res.warnings) issues.push({ where, message: w.message, source: w.source, severity: 'warning' });
    // [#8116] Provenance rides every object-bound predicate this helper
    // validates, whichever scope: the `record`/`previous` roots are explicit
    // in the source, so flattened flow conditions are covered without ever
    // judging a bare identifier.
    warnUnprovisionedAnchors(where, raw, objectName);
  };

  /**
   * A FIELD-level conditional rule (`visibleWhen` / `readonlyWhen` /
   * `requiredWhen`) that reaches for a namespace root the field level does not
   * bind. The field level binds THREE roots and nothing else — `record`,
   * `previous`, and `parent` on a master-detail line item — measured at three
   * independent ends: the server (`rule-validator.ts` binds
   * `{ record, previous, extra: { parent } }` for `readonlyWhen` and
   * `{ record, previous, ...parentScope }` for `requiredWhen`), the client
   * (`evalFieldPredicate` binds `record` + `previous` + a caller `scope` that
   * is only ever `{ parent }` across objectui's five field-level call sites),
   * and the authoring surface (objectui's `FIELD_RULE_ROOTS`, whose comment
   * says "nothing else").
   *
   * ## Why this is a rule of its own rather than a missing root
   *
   * Until #6290 the same rejection fell out of `@objectstack/formula`'s
   * `SCOPE_ROOTS` not listing `current_user` — a global baseline, doing a
   * per-surface job by accident. Two things were wrong with that:
   *
   *  1. The rest of the package said the opposite. `introspectScope` hands
   *     `current_user` to authors as a legal root and `checkRoleCatalog`'s four
   *     position-membership regexes all lead with it, because ADR-0068 D1 makes
   *     it THE canonical spelling and `buildScope` really does mount it. One
   *     package, two accounts of one root.
   *  2. The diagnostic was the generic bare-field one, so it prescribed
   *     "Write `record.current_user`" — a shape that binds on NO layer. An
   *     author who followed it wrote something strictly worse than what they
   *     started with, and the failure stayed silent.
   *
   * So the baseline now declares the root (a reference through it never faults
   * platform-wide) and the surface that genuinely cannot bind it says so here,
   * in its own words, with the prescriptions that actually exist.
   *
   * ## Why the membership test is an ALLOWLIST (#6713)
   *
   * Until #6713 this rule matched a hand-written DENYLIST — one root in #6584,
   * three after #6585 (`current_user` / `user` / `ctx`). The denylist was never
   * the truth: the three anchors above pin a three-item ALLOWLIST, and
   * everything outside it is equally unbound, faults identically, and — this is
   * the part that made the hole invisible — is equally SILENT. A root in
   * `SCOPE_ROOTS` resolves in the strict env, so the bare-reference check one
   * line up never fires on it either. #6713 measured 21 roots living in that
   * gap (`input`, `output`, `os`, `vars`, `variables`, `automation`, `context`,
   * `args`, `item`, `env`, `step`, `result`, `trigger`, `event`, `payload`,
   * `data`, `params`, `config`, `settings`, `features`, `current`), two of them
   * highly credible author typos rather than theoretical members:
   *
   *  - `os.user.id` — ADR-0068 D1's FOURTH user spelling. #6585 took three and
   *    left this one, so the same semantic error stayed silent under one of the
   *    four names the platform itself mounts the user object under.
   *  - `data.status == 'x'` — `data` is the LEGAL root of this very
   *    `visibleWhen` key on a METADATA form (`view.zod.ts`: "Root: `record` …
   *    in runtime forms, or `data` in metadata forms"). Two form kinds, one key
   *    name, different roots — and the repo's own `*.form.ts` files are full of
   *    the `data` spelling for an author to copy.
   *
   * A denylist cannot track `SCOPE_ROOTS`: every root added there is unreported
   * here until somebody remembers to copy it across (`current_user` itself
   * arrived in #6290 and needed #6584 to be noticed). The allowlist inverts the
   * maintenance burden onto the three roots that are pinned by three anchors and
   * change only when the evaluators do.
   *
   * The membership test is `SCOPE_ROOTS` minus the allowlist, taken from
   * `@objectstack/formula` rather than restated here (#6713 published it for
   * this consumer) — one list, one definition, no drift. It deliberately is NOT
   * `firstUndeclaredReference`, the declaredness oracle the sibling visibility
   * rule uses, and the difference is a measured false positive rather than a
   * preference: the strict env also declares CEL's TYPE names, so
   * `type(record.x) == string` reports `string` as a root that "resolves".
   * Judging by declaredness would reject that legitimate predicate; judging by
   * `SCOPE_ROOTS` membership does not. Everything the oracle owns and this list
   * does not — bare field references, comprehension-macro variables — keeps
   * falling to the bare-reference check, which has the right prescription for
   * it. The two partitions are disjoint and there is no gap between them.
   *
   * ## Why it is an error and not a warning
   *
   * Every fault direction available here is silent, and two of the three are
   * the opposite of what the author declared (see the per-slot table below):
   * a `visibleWhen` written to HIDE leaves the field visible to everyone, a
   * `readonlyWhen` written to unlock-under-a-condition locks the field on every
   * write, and a `requiredWhen` simply never fires. None of the three produces
   * a runtime error an author can find; the only signal that exists is this one
   * (#6146).
   *
   * Verdict scope is the field level only. Per-option `visibleWhen` is checked
   * by the loop in the field walk and deliberately NOT passed through here:
   * options resolve against the host's predicate scope, which binds
   * `current_user` (ADR-0068 / objectui#2284) — that surface is where such a
   * predicate belongs, which is why it is also the first prescription below.
   *
   * ## The user roots, and why `ctx` is judged whole-root (#6585)
   *
   * ADR-0068 D1 makes `user` and `ctx.user` ALIASES of `current_user` — one
   * `EvalUser` object under every spelling (`buildScope` in
   * `formula/stdlib.ts` hangs the same reference on `current_user` / `user` /
   * `ctx.user` / `os.user`). Matching only the canonical spelling meant the
   * identical semantic error got a diagnostic under `current_user` and total
   * silence under the aliases — which spelling the author picked decided
   * whether they got the diagnostic, the exact fork AI authors cannot
   * self-check. All four roots now share one verdict and one prescription;
   * the message names the spelling found, nothing else varies. (`os` joined the
   * set in #6713 — it is the fourth name `buildScope` mounts the same object
   * under, and the allowlist would have rejected it anyway; what the user tier
   * decides is only WHICH prescription it gets, and the user one is right for
   * `os.user`. `os.org` / `os.env` land in the same tier because the option
   * surface named by the first prescription binds the whole `os` namespace, not
   * only its `user` member.)
   *
   * `ctx` is judged as a WHOLE root, not only in `ctx.user` form, because at
   * this surface that is simply what is true: `buildScope` creates the `ctx`
   * root ONLY when the evaluation carries a user (`scope.ctx = { user }`
   * inside `if (ctx.user !== undefined)`), and no field-level site passes one
   * — the server binds `record`+`previous`(+`parent`) (`rule-validator.ts`
   * `readonlyWhenBindings` / the `requiredWhen` block) and the client's
   * `evalFieldPredicate` binds `record`+`previous`+caller `scope` (only ever
   * `{ parent }`). So `ctx.locale` faults exactly like `ctx.user.id` here.
   * `ctx` IS ActionEngine's predicate root elsewhere — the platform's real
   * `ctx.user` predicates all sit on action `visible` (`sys-user.object.ts`,
   * `sys-invitation.object.ts`), a surface this helper never reads — and
   * measured usage of field-level `*When` with ANY user root is zero across
   * examples/, packages/ and objectui (#6585's sweep).
   *
   * The rejected alternative was matching `ctx` only in its `ctx.user` form.
   * `collectCelRootIdentifiers` reports ROOTS and drops member names by
   * design, so that reading needs a source-level spelling match — and a
   * spelling match is precisely the defect this rule exists to remove: it
   * would re-open the same fork one level down (`ctx["user"].id` silent,
   * `ctx.user.id` rejected), while leaving a real fail-open fault (`ctx.locale`)
   * unreported for the sake of a narrower rule NAME.
   *
   * ## The message tiers on TWO orthogonal axes
   *
   * The causal half tiers by SLOT (#6716); the prescription half tiers by ROOT
   * (#6713). They are independent — `data` on a `readonlyWhen` needs the
   * metadata-form prescription AND the locked-field consequence — so one
   * skeleton carries both rather than a message per combination.
   *
   * ### Axis 1 — the consequence, by SLOT (#6716, all three cells measured)
   *
   * Until #6713/#6716 all three slots shared ONE sentence: "the predicate
   * faults and falls back to VISIBLE, leaving the field the test was meant to
   * hide showing for everyone". That is precise for exactly one of them. The
   * measurement, at both ends of each slot:
   *
   *  - **`visibleWhen` — client-only, fail-OPEN, sentence was correct.** The
   *    server never evaluates a FIELD-level `visibleWhen` at all:
   *    `rule-validator.ts`'s `ConditionalFieldDef` has no such member, and
   *    `hasFieldRules` gates on `requiredWhen || readonlyWhen ||
   *    fieldHasOptionVisibility` — the `visibleWhen` it does evaluate is the
   *    per-OPTION one. So the only verdict is the renderer's, and
   *    `resolveFieldRuleState` passes `fallback: true` for visibility. Field
   *    visible to everyone, exactly as the old sentence said.
   *  - **`readonlyWhen` — the two ends fault in OPPOSITE directions, and the
   *    server wins.** Server: `isReadonlyWhenLocked` matches the fault with
   *    `unknownVariableOf` and returns `true` — "the declared lock is not
   *    waived because it could not be evaluated" (#4889's carve-out, whose
   *    trigger is precisely the unbound-ROOT case, not the undeclared-key one)
   *    — and `stripReadonlyWhenFields` then DELETES the field from the incoming
   *    payload and lets the rest of the write through. Client:
   *    `resolveFieldRuleState` passes `fallback: false`, so the form renders the
   *    field editable. The standing "server enforces, client is courtesy" rule
   *    — cited in this repo as ADR-0057 D10, an attribution rather than a
   *    resolvable anchor (#9628) — resolves the disagreement: the author edits
   *    the field, the save reports
   *    success, and the value silently never lands. The old sentence told this
   *    author the field would be VISIBLE TO EVERYONE — the opposite failure, and
   *    the opposite troubleshooting direction.
   *  - **`requiredWhen` — fail-OPEN at both ends, and never about visibility.**
   *    Server: the `requiredWhen` block logs `unknownVariableOf`'s name and
   *    `continue`s — #4977 deliberately did not copy #4889's carve-out, so the
   *    required-check is skipped for that write. Client: `fallback: false`, so
   *    the form does not mark the field required either. Both ends agree and
   *    both do nothing: the requirement is never enforced anywhere, and a record
   *    saves with the field empty. "Falls back to VISIBLE" was not merely
   *    imprecise here, it named the wrong property of the field.
   *
   * `conditionalRequired` also reaches this helper (the field walk still passes
   * it). It is a `retiredKey` in `FieldSchema` — the strict schema rejects it by
   * name — so the branch is inert on the parsed compile path, and it gets a
   * slot-agnostic clause rather than a fabricated fourth measurement.
   *
   * ### Axis 2 — the prescription, by ROOT (#6713)
   *
   * The pre-#6713 prescriptions are user-oriented (move to the option level,
   * declare permission-set FLS) because the pre-#6713 denylist held only user
   * roots. Handed to an author who wrote `data.type == 'select'`, "move it to
   * the option's `visibleWhen`" answers a question nobody asked. Three tiers:
   *
   *  - **user roots** (`current_user` / `user` / `ctx` / `os`) keep the existing
   *    two user-specific prescriptions plus the `record` rewrite;
   *  - **`data`** gets the metadata-form-vs-runtime-form explanation, because
   *    that is what the mistake IS — the same key name, the other form kind's
   *    root;
   *  - **everything else** gets the general rewrite, phrased without claiming
   *    which other surface the author copied it from.
   */
  /**
   * The roots a field-level `*When` predicate binds. Everything else in
   * `SCOPE_ROOTS` is rejected — see the allowlist section above.
   */
  const FIELD_RULE_BOUND_ROOTS = ['record', 'previous', 'parent'] as const;
  /**
   * ADR-0068 D1's four user spellings, in the order the message's tie-break
   * prefers them (canonical first — the #6585 ordering, with `os` appended so
   * the pre-existing three keep their exact precedence).
   */
  const FIELD_RULE_USER_ROOTS = ['current_user', 'user', 'ctx', 'os'] as const;
  /**
   * The slot-agnostic clause — provably true for any slot, specific to none.
   * Used where the honest answer is "not measured for this slot", never as a
   * softening of a cell that WAS measured.
   */
  const FIELD_RULE_SLOT_CONSEQUENCE_GENERIC =
    'the predicate faults, and a faulting rule never produces the verdict you declared — each ' +
    'slot resolves the fault to its own fallback, and none of those fallbacks is yours';
  /** Axis 1 — see "the consequence, by SLOT" above. Every cell is measured. */
  const FIELD_RULE_SLOT_CONSEQUENCE: Record<string, string> = {
    visibleWhen:
      'the predicate faults and the renderer falls back to VISIBLE ' +
      '(`resolveFieldRuleState` evaluates visibility with `fallback: true`, and no server-side ' +
      'gate evaluates a field-level `visibleWhen` at all), leaving the field the test was meant ' +
      'to hide showing for everyone (#6146)',
    readonlyWhen:
      'the predicate faults — and the two ends fault in OPPOSITE directions. The server treats ' +
      'the field as LOCKED (`isReadonlyWhenLocked` will not waive a declared lock it could not ' +
      'evaluate, #4889) and drops your value from the payload, while the form still renders the ' +
      'field editable (`fallback: false`). The server is the one that decides: ' +
      'the field looks writable, the save reports success, and the value silently never lands',
    requiredWhen:
      'the predicate faults and the requirement is never enforced anywhere — the server logs it ' +
      'and SKIPS the check (fail-open, #4977 deliberately did not take #4889\'s carve-out) and ' +
      'the form does not mark the field required either, so a record saves with the field empty',
    // Listed rather than left to the `??` below, so the map covers every slot
    // the field walk passes and the default stays unreachable. `FieldSchema`
    // declares this key only as a `retiredKey`, which rejects it by name, so
    // there is no fourth runtime to measure — the honest clause is the generic
    // one, not a fabricated fourth cell (#6716).
    conditionalRequired: FIELD_RULE_SLOT_CONSEQUENCE_GENERIC,
  };
  const checkFieldRuleRoot = (where: string, slot: string, raw: unknown): void => {
    const source = celSourceOf(raw);
    if (!source) return;
    const roots = collectCelRootIdentifiers(source);
    if (!roots.ok) return;
    // Filtered through SCOPE_ROOTS, in SCOPE_ROOTS order — so a bare field
    // reference (owned by the bare-reference check one line up) and a CEL type
    // name (`type(record.x) == string`) can never land here.
    const kept = SCOPE_ROOTS.filter(
      (r) => !(FIELD_RULE_BOUND_ROOTS as readonly string[]).includes(r) && roots.roots.includes(r),
    );
    if (kept.length === 0) return;
    // One issue per slot even when a predicate reaches for two rejected roots.
    // User roots win the tie-break (canonical spelling first) so #6585's
    // message stays stable; anything else falls back to SCOPE_ROOTS order,
    // which is stable too — never AST walk order.
    const root = FIELD_RULE_USER_ROOTS.find((r) => kept.includes(r)) ?? kept[0]!;
    const prescription = (FIELD_RULE_USER_ROOTS as readonly string[]).includes(root)
      ? `To gate the CHOICES of a select by user, move the predicate to the option's own ` +
        `\`visibleWhen\` (\`options: [{ …, visibleWhen: … }]\`) — per-option is the one \`*When\` ` +
        `surface that binds \`current_user\` and its ADR-0068 aliases. To hide the FIELD by role, ` +
        `declare field-level security on a permission set ` +
        `(\`fields: { '<object>.<field>': { readable: false } }\`), which the server enforces. ` +
        `To gate on record state, rewrite the predicate against \`record\`.`
      : root === 'data'
        // The `*.form` spelling is deliberately not `*.form.ts`: this is a
        // STRING literal, and #5017's receiver scan strips comments but not
        // strings, so `form.ts` inside the message registers `form` as a read
        // receiver of this rule. Measured — it went red on the first run.
        ? `\`data\` is the root of a METADATA form (a \`*.form\` module — the metadata row ` +
          `being edited); ` +
          `this is an OBJECT field, whose runtime form binds the row as \`record\` — one key name, ` +
          `two form kinds, two roots. Rewrite \`data.<key>\` as \`record.<field>\`.`
        : `\`${root}\` is declared platform-wide and bound at OTHER evaluation sites (flow, ` +
          `automation, screen and action predicates), never at the field level. Rewrite the ` +
          `predicate against \`record\` (plus \`previous\`, and \`parent\` on a master-detail line ` +
          `item), or move the decision to a surface that binds \`${root}\`.`;
    issues.push({
      where,
      message:
        `\`${slot}\` reads \`${root}\`, but a field-level conditional rule binds only ` +
        `\`record\` (plus \`previous\`, and \`parent\` on a master-detail line item) — ` +
        `\`${root}\` is unbound here, so ` +
        `${FIELD_RULE_SLOT_CONSEQUENCE[slot] ?? FIELD_RULE_SLOT_CONSEQUENCE_GENERIC}. ` +
        prescription,
      source,
      severity: 'error',
    });
  };

  /**
   * A declared bare-CEL slot (#4027). No object schema is passed: these slots
   * bind the *screen's own* collected values, not the trigger record's fields, so
   * a field-existence pass would report every field name as unknown.
   */
  const checkDeclaredPredicate = (where: string, raw: unknown): void => {
    if (raw == null) return;
    const res = validateExpression('predicate', raw as string | { dialect?: string; source?: string });
    for (const e of res.errors) issues.push({ where, message: e.message, source: e.source, severity: 'error' });
    for (const w of res.warnings) issues.push({ where, message: w.message, source: w.source, severity: 'warning' });
  };

  // ── Flows ──────────────────────────────────────────────────────────
  for (const flow of asArray(stack.flows)) {
    const flowName = typeof flow.name === 'string' ? flow.name : '(unnamed flow)';
    const nodes = Array.isArray(flow.nodes) ? (flow.nodes as AnyRec[]) : [];
    // The record-change target object — `record.*` refs resolve against it.
    const startNode = nodes.find(n => n.type === 'start');
    const startCfg = (startNode?.config ?? {}) as AnyRec;
    const objectName = typeof startCfg.objectName === 'string' ? startCfg.objectName : undefined;

    // #4347 — every graph in the flow, not just `flow.nodes`/`flow.edges`. An
    // ADR-0031 container keeps a whole sub-graph in its `config`, so the
    // top-level walk validated PART of the flow while reporting on all of it: a
    // predicate written in the wrong dialect inside a `loop` body passed
    // `objectstack validate` and shipped. This is the author-time half of the
    // same traversal the engine's registration pass now does; `scope` names the
    // region so the located message still points at one edge.
    for (const graph of collectFlowGraphs(flow as { nodes?: FlowNodeParsed[] })) {
      const at = graph.scope ? `flow '${flowName}' · ${graph.scope}` : `flow '${flowName}'`;
      for (const node of graph.nodes as unknown as AnyRec[]) {
        const cfg = (node.config ?? {}) as AnyRec;
        check(`${at} · node '${node.id}' (${node.type}) condition`, cfg.condition, objectName);

        // Descriptor-declared expression slots (#4027). Before this, the traversal
        // hardcoded `condition` and assumed every other node string was a `{var}`
        // template — so `screen.fields[].visibleWhen`, declared bare CEL since
        // #3304, was validated by nobody and #3528 shipped a template-dialect
        // predicate through compile, validate and run time in silence.
        // Only `predicate` slots are checkable: `flow-template` slots take the
        // single-brace `{var}` dialect `interpolate()` implements, which no
        // validator covers (the `template` role enforces ADR-0032 §3's
        // double-brace text template and would reject every correct
        // `loop.collection`). The ledger records them regardless, so the
        // reconciliation ratchet still sees the marker.
        const nodeType = typeof node.type === 'string' ? node.type : '';
        for (const found of resolveFlowNodeExpressions(nodeType, cfg)) {
          if (found.entry.role !== 'predicate') continue;
          checkDeclaredPredicate(
            `${at} · node '${node.id}' (${nodeType}) ${found.entry.label} at config.${found.path}`,
            found.value,
          );
        }
        // #1870 — a `script` node must name a callable, and since #4343 that is
        // the whole of what the node does: `config.function`. A node without one
        // is a silent no-op that otherwise passes build. (Function *existence*
        // isn't checkable here — functions are code, not serialized into the
        // artifact — so this is a structural check; the runtime verifies the
        // named function is actually registered.)
        if (node.type === 'script') {
          // `function` is canonical; a pre-parse source may still carry the
          // `functionName` alias during the protocol-17 window, until the
          // 'flow-node-script-config-aliases' conversion (#3796) canonicalizes it.
          const fn =
            (typeof cfg.function === 'string' ? cfg.function.trim() : '') ||
            (typeof cfg.functionName === 'string' ? cfg.functionName.trim() : '');
          // A source that predates #4343 may still carry a retired dispatch key.
          // Naming it beats the generic "no callable": these ARE what the author
          // wrote, and each has a different replacement. The schema tombstones
          // carry the full prescription; this is the one-line version at lint.
          const action = typeof cfg.actionType === 'string' ? cfg.actionType.trim() : '';
          const retired = ['actionType', 'template', 'recipients', 'variables', 'script']
            .filter((k) => cfg[k] != null);
          if (retired.length > 0) {
            issues.push({
              where: `${at} · node '${node.id}' (script) callable`,
              message:
                `script node carries \`${retired.map((k) => `config.${k}`).join('`, `')}\` — retired in ` +
                `@objectstack/spec 17 (#4343). The built-in 'email'/'slack' actions were logger-backed ` +
                `stubs that delivered nothing, and inline \`config.script\` was never executed. ` +
                (action && action !== 'invoke_function' && !['email', 'slack'].includes(action)
                  ? `\`actionType: '${action}'\` named a registered function — move it to \`function: '${action}'\`. `
                  : `Use a \`notify\` node for mail, a \`connector_action\` (Slack connector) or \`http\` node ` +
                    `for Slack, and a registered function for logic. `) +
                // #6856 route D (maintainer-ruled), reworded under #9529: the house
                // sentence names the TOOL's behaviour, never the retired key's fate —
                // "rewrite it" read two ways over a branch that DELETES the key
                // (template/recipients/variables/script), and the tool never rewrote a
                // source file at all. Plain-quoted (not a template literal)
                // so this site is a member of `retired-key-migrate-sentence.test.ts`'s
                // widened scan (#7030) on the same textual shape as the spec corpus — no
                // interpolation lives in this clause, so nothing is lost switching quote style.
                'Run `os migrate meta --from 16` to list the mechanical edits for existing '
                  + 'sources; apply them by hand.',
              source: JSON.stringify({ id: node.id, type: node.type, config: cfg }),
            });
          } else if (!fn) {
            issues.push({
              where: `${at} · node '${node.id}' (script) callable`,
              message:
                `script node declares no \`function\` — it would do nothing at runtime. ` +
                `Name a registered function (\`function: 'my_fn'\`, registered via ` +
                `\`defineStack({ functions })\`).`,
              source: JSON.stringify({ id: node.id, type: node.type, config: cfg }),
            });
          }
        }
      }
      for (const edge of graph.edges as unknown as AnyRec[]) {
        check(`${at} · edge '${edge.id}' (${edge.source}→${edge.target}) condition`, edge.condition, objectName);
      }
      // No `checkNullGuards` on node/edge conditions — and NOT for the reason
      // #4811 first recorded (#4811 re-measured it). The stated blocker was the
      // flattened scope: a bare identifier like `budget > 100000` might be a flow
      // variable rather than a field. That is true of a bare-identifier checker,
      // but this gate never resolves a bare identifier — it matches only
      // `record.<f>` / `previous.<f>`, and the engine binds both roots
      // unconditionally, so it is immune to that ambiguity.
      //
      // The real blocker is totality. `record-change-trigger.ts` seeds the flow's
      // record as `{ ...(inputData ?? {}), ...after }` (spelled `inputDoc` until
      // #5671 dropped that alias read) with no `materializeDeclaredFields`,
      // so a declared column the write never mentioned is an ABSENT key, not a
      // null one — and there `record.x != null` faults (`No such key`) exactly
      // like the comparison it was meant to guard. The gate's prescription is
      // unsound on this surface until the trigger's record is made total the way
      // #4649 made the validation-rule and hook bindings total.
      //
      // (For the record, the flattened-scope ambiguity is separately real and
      // would need its own criterion: flow inputs shadow record fields —
      // `if (!variables.has(k))` in `AutomationEngine.execute` — and a node's
      // `outputVariable` can overwrite either, so a sound bare-identifier pass
      // must subtract flow inputs, every `outputVariable`, screen-collected
      // variable names and node ids.)
    }
  }

  // ── Object validation-rule + formula predicates ────────────────────
  for (const obj of objects) {
    const objectName = typeof obj.name === 'string' ? obj.name : undefined;
    // `validations` is the key `ObjectSchema` declares; `validationRules` is a
    // rejected alias of it (#5017) — see the `## Scope` table above.
    const validations = obj.validations;
    for (const rule of asArray(validations)) {
      const where = `object '${objectName}' · validation '${(rule.name as string) ?? '?'}'`;
      // The declared predicate key is `condition` (see `rulePredicates`).
      // Validation predicates are `record`-scoped — no field flattening — so
      // bare refs are flagged (#1928).
      check(where, rule.condition, objectName, 'record');
      // `conditional` rules carry a nested `when` predicate (record-scoped).
      check(`${where} when`, (rule as AnyRec).when, objectName, 'record');
      // #4763 — null-guard gate over every predicate the rule carries, nested
      // `then`/`otherwise` branches included.
      for (const p of rulePredicates(rule, '')) {
        checkNullGuards(`object '${objectName}' · ${p.label}`, p.label, p.raw, objectName);
      }
    }
    // Field-level formulas (computed fields) reference the same object.
    const fields = obj.fields;
    // Paired with the field's NAME. `fields` has two authored shapes and the
    // name lives in a different place in each: it is `f.name` in the array
    // shape and the KEY in the name-keyed map shape. Walking `Object.values`
    // dropped that key, so every diagnostic on a map-shaped object — the shape
    // `Field.text({…})` authoring produces, i.e. the common one — was located
    // at `field '?'` (#4811). Harmless-looking while the name only appeared in
    // `where`; not harmless once a message has to tell the author which field
    // to edit. Array entries keep their previous fallback so a nameless one is
    // still validated rather than silently skipped.
    const fieldList: Array<[string, AnyRec]> = Array.isArray(fields)
      ? (fields as AnyRec[])
          .filter((f) => !!f && typeof f === 'object')
          .map((f) => [typeof f.name === 'string' ? f.name : '?', f] as [string, AnyRec])
      : (fields && typeof fields === 'object'
          ? Object.entries(fields as AnyRec)
              .filter(([, def]) => !!def && typeof def === 'object')
              .map(([n, def]) => [n, def as AnyRec] as [string, AnyRec])
          : []);

    // (ADR-0062 D7's `field.columnName`-on-external-objects rejection was removed
    // with `field.columnName` itself in #2377: the field no longer exists, so there
    // is no dual-source ambiguity to guard — external column mapping is `external.columnMap`.)

    // [#4889] How many masters this object has, for the `parent`-scope gate
    // below. Computed once per object, not per field.
    const masters = masterDetailCount(obj);

    for (const [fname, f] of fieldList) {
      // Field-level conditional rules are server-enforced (rule-validator) and
      // record-scoped — a bare ref silently fails the rule (required/readonly
      // not enforced = data-integrity hole). #1928 class, same as actions.
      for (const key of ['requiredWhen', 'readonlyWhen', 'conditionalRequired', 'visibleWhen'] as const) {
        check(`object '${objectName}' · field '${fname}' ${key}`, (f as AnyRec)[key], objectName, 'record');
        checkFieldRuleRoot(`object '${objectName}' · field '${fname}' ${key}`, key, (f as AnyRec)[key]);
      }
      // [#6290] Per-OPTION `visibleWhen` — a `select`/`multiselect`/`radio`
      // option's own predicate (`SelectOptionSchema.visibleWhen`,
      // `field.zod.ts:143`). It had no traversal here at all, so the whole
      // option surface reached compile, validate and run time unvalidated:
      // a bare field ref (`country == 'cn'`) or a reference to a field that
      // does not exist produced no build error, and the option then simply
      // never offered itself.
      //
      // Deliberately checked on the SAME `record` scope as the field-level
      // slots, and that is the whole of the difference between the two faces
      // after #6290: `current_user` is a declared root platform-wide (ADR-0068
      // D1), so it passes here — options resolve through
      // `resolveCascadingOptions` against the host's predicate scope, which
      // binds it (ADR-0068 / objectui#2284), and the showcase's
      // `'admin' in current_user.positions` is the pinned legal usage — while
      // `checkFieldRuleRoot` above rejects it one level up, where nothing
      // binds it. Same helper, two verdicts, because the two surfaces have two
      // evaluators; neither verdict is a side effect of a shared root list.
      for (const [oi, opt] of asArray(f.options).entries()) {
        const label = typeof opt.value === 'string' ? `'${opt.value}'` : `#${oi}`;
        check(
          `object '${objectName}' · field '${fname}' option ${label} visibleWhen`,
          opt.visibleWhen,
          objectName,
          'record',
        );
      }
      // [#4889] A `parent`-scoped `readonlyWhen` is a SERVER-enforced lock:
      // the write path resolves the object's master-detail header and binds it
      // as `parent`. That binding exists only when the object declares exactly
      // ONE `master_detail` relationship. With none — or with two, where the
      // metadata does not say which one "the parent" is — the predicate can
      // never evaluate, and the runtime then holds the field LOCKED forever (it
      // will not wave a declared lock through just because it could not be
      // checked). The metadata already contains everything needed to see that
      // at build time, so it is decided here rather than discovered as an
      // unwritable field in production — PD #12, declared rather than guessed.
      //
      // [#4977] Extended to `requiredWhen`, which the server enforces from the
      // same declaration site through the same evaluator and which gained its
      // own `parent` binding in the same issue. The two slots ask ONE question —
      // "is `parent` a fact this object's metadata states?" — so they share one
      // gate rather than growing a second copy of `masterDetailCount` +
      // `readsParentRoot`.
      //
      // What they do NOT share is the CONSEQUENCE, and the message has to name
      // the right one or it prescribes the wrong fix (the same reason #4811's
      // null-guard gate passes its outcome in explicitly instead of inferring
      // it). The two runtimes fail in OPPOSITE directions on an unbindable
      // `parent`: `readonlyWhen` fails CLOSED (#4889 — an unbound scope root
      // resolves to LOCKED, so the field becomes unwritable forever), while
      // `requiredWhen` stays fail-OPEN (#4977's ruling deliberately did not copy
      // the carve-out), so the requirement silently enforces NOTHING. This gate
      // is why fail-open is affordable there: the declaration that would rot
      // unnoticed at runtime cannot ship in the first place.
      //
      // `conditionalRequired` (retired alias) and `visibleWhen` (no
      // server-enforced `parent` binding of its own) keep their verdicts
      // untouched.
      // Destructured in the loop head on purpose: both predicate slots stay
      // LITERAL member reads (`f.readonlyWhen` / `f.requiredWhen`) rather than a
      // computed `f[key]`, so the #5017 meta-test's source scan still sees every
      // key this rule reads and can still check it against `FieldSchema`. An
      // indexed read here would have disarmed that scan silently.
      for (const [slot, raw, consequence] of [
        ['readonlyWhen', f.readonlyWhen, `the field would be locked on every write`],
        ['requiredWhen', f.requiredWhen, `the requirement would never be enforced — the predicate faults, the server logs and skips it, and the field stays optional in the database`],
      ] as const) {
        const source = celSourceOf(raw);
        if (masters === 1 || !source || !readsParentRoot(source)) continue;
        issues.push({
          where: `object '${objectName}' · field '${fname}' ${slot}`,
          message:
            `\`${slot}\` reads \`parent\`, but object '${objectName}' declares ` +
            `${masters === 0 ? 'no' : `${masters}`} \`master_detail\` relationship${masters === 1 ? '' : 's'} — ` +
            `so the server has no header record to bind as \`parent\` and ${consequence}. ` +
            (masters === 0
              ? `Declare the owning relationship as \`Field.masterDetail('<master>')\`, or rewrite the predicate against \`record\`.`
              : `\`parent\` needs exactly one master; name the header explicitly through \`record.<fk>\` state instead, or model the extra relationship as a \`lookup\`.`),
          source,
          severity: 'error',
        });
      }
      // #4811 — `requiredWhen` is the one field-level slot that meets the
      // null-guard gate's totality criterion: `evaluateValidationRules`
      // evaluates it against the SAME `materializeDeclaredFields`-merged
      // record the object's validation rules see. It is also the surface
      // where an unguarded predicate hurts most quietly — a faulting
      // `requiredWhen` is fail-OPEN (`rule-validator.ts` logs
      // "failed to evaluate — skipped"), so the field is simply never
      // required and the write sails through. Validation rules at least
      // reject fail-closed since #4761.
      //
      // `readonlyWhen` is still NOT included even though it sits on the same
      // field — but no longer because its binding is sparse. Since #6454
      // `readonlyWhenBindings` runs both roots through
      // `materializeDeclaredFields`, so `!= null` IS the right prescription
      // there now; what holds the wiring back is clause 3 of the #4953 ruling
      // (both server-side seams first — the flow trigger-record half is
      // outstanding). When it is wired it needs `'fail-open'`, like
      // `requiredWhen` above and unlike the validation-rule surface. Same for
      // `conditionalRequired` / `visibleWhen`, which have no record-scoped
      // total binding of their own. See the surface ledger in
      // `validate-null-guards.ts`.
      checkNullGuards(
        `object '${objectName}' · field '${fname}' requiredWhen`,
        `field '${fname}' requiredWhen`,
        f.requiredWhen,
        objectName,
        'fail-open',
      );
      if (f.expression) {
        // `expression` is the key `FieldSchema` declares for a computed field —
        // what `Field.formula({ expression: … })` writes. This read was spelled
        // `formula` until #5026, one of the names `field.zod.ts:333` REJECTS by
        // aliasing it back to `expression`, so the whole pass had never run
        // against a stack that parses. Converging it ACTIVATED a check rather
        // than deleting a dead branch — the real-metadata sweep that had to
        // accompany that is in #5026's PR body.
        //
        // formulas are `value` role (any return type), still CEL. They are
        // `record`-scoped — `record.<field>`, never bare — so flag bare refs (#1928).
        //
        // No `checkNullGuards` here, and unlike the action / flow surfaces this
        // is NOT a totality verdict (#4811). A formula is `value`-role and
        // natively nullable, and `guard ? value : null` is the blessed shape
        // (#3306 rewrites it through `dyn(...)`). Whether unguarded arithmetic
        // such as `record.budget - record.spent` should be *forbidden* here is a
        // question about what authors are allowed to write — a product decision
        // for the maintainer, not a wiring gap for a lint PR to close on its own.
        // The convention already leans guarded (`showcase_project.budget_remaining`
        // writes `(record.budget == null ? 0 : record.budget) - …`), so the cost of
        // deciding later is low. Raise it as its own issue rather than widening
        // this call. Ledger: `validate-null-guards.ts`.
        const res = validateExpression('value', f.expression as string | { dialect?: string; source?: string },
          objectName ? { objectName, fields: fieldIndex.get(objectName), fieldTypes: fieldTypeIndex.get(objectName), scope: 'record' } : { scope: 'record' });
        // Names the KEY the author edits, not the field type. Saying "formula"
        // here is how the wrong spelling propagates: the next author reads the
        // diagnostic and writes `formula:`, which the schema then rejects.
        const fieldWhere = `object '${objectName}' · field '${fname}' expression`;
        for (const e of res.errors) issues.push({ where: fieldWhere, message: e.message, source: e.source, severity: 'error' });
        for (const w of res.warnings) issues.push({ where: fieldWhere, message: w.message, source: w.source, severity: 'warning' });
        // [#8116] Formulas read the same record binding the predicates do, so
        // a `record.<anchor>` read inside one degrades identically.
        warnUnprovisionedAnchors(fieldWhere, f.expression, objectName);
      }
    }
  }

  // ── Action `visible` / `disabled` predicates ───────────────────────
  // Record-scoped, same as validation rules: a record-header / row action's
  // `visible` is evaluated by ActionEngine against `{ record, recordId,
  // objectName, user, … }` with fail-closed semantics, so a BARE field ref
  // (`done` instead of `record.done`) throws and the action is silently hidden
  // on every record (the trap behind the #2183 "Mark Done never hides" hunt).
  // Flagging it here turns that into a build error with a corrective message.
  // `disabled` may be a boolean (skip) or a predicate (check).
  const seenActions = new Set<string>();
  const checkAction = (where: string, action: AnyRec, objectName?: string): void => {
    // `objectName` is the declared key on an action; `object` is the rejected
    // alias the strict error map maps back to it ("Did you mean `object` →
    // `objectName`?"), so an action spelling it does not parse (#5017).
    const obj = objectName
      ?? (typeof action.objectName === 'string' ? action.objectName : undefined);
    const name = typeof action.name === 'string' ? action.name : '?';
    const key = `${obj ?? ''}:${name}`;
    if (seenActions.has(key)) return; // de-dup (actions are merged onto objects AND kept top-level)
    seenActions.add(key);
    check(`${where} · action '${name}' visible`, action.visible, obj, 'record');
    if (typeof action.disabled !== 'boolean') {
      check(`${where} · action '${name}' disabled`, action.disabled, obj, 'record');
    }
    // No `checkNullGuards` here, and the reason is measured rather than assumed
    // (#4811). These predicates DO reach real CEL — a bare authored string is
    // normalized to a `{dialect:'cel'}` envelope by `ExpressionInputSchema` and
    // `objectui`'s renderers preserve it — and a fault IS fail-closed, so the
    // `has(a) && has(b) && a < b` trap genuinely bites here too: the action
    // silently disappears on every record. What blocks the gate is the record
    // BINDING: it is whatever the client fetched (a detail read, or a list row
    // holding only the view's projected columns), and no materialization step
    // exists anywhere on that path. On such a sparse binding `!= null` — the fix
    // this gate prescribes — faults with `No such key`, so gating here would
    // reject working metadata and hand the author a correction that breaks it.
    // Covering this surface means first making the binding total, which is a
    // platform contract change, not a lint change. Ledger: `validate-null-guards.ts`.
    //
    // Nor is the INVERSE rule the answer. "Flag `!= null` on a sparse binding"
    // was evaluated and declined (#8881): on a sparse binding the abort is at
    // key resolution, so `record.a == 'pending'` faults exactly as `!= null`
    // does — `!= null` is one spelling of nine, not the fault. Measured yield
    // over authored metadata in both repos is 2 of 34 record-scoped action
    // predicates, and whether any given one faults depends on the VIEW's
    // `$select` projection (and, through `&&` short-circuiting, on row data),
    // neither of which this pass can see. Full reasoning in the ledger.
  };
  for (const action of asArray(stack.actions)) {
    checkAction('stack', action);
  }
  for (const obj of objects) {
    const objectName = typeof obj.name === 'string' ? obj.name : undefined;
    for (const action of asArray(obj.actions)) {
      checkAction(`object '${objectName}'`, action, objectName);
    }
  }

  // ── Sharing-rule predicates (security-critical, record-scoped) ─────
  // A criteria sharing rule's `condition` decides which rows a principal sees.
  // It is evaluated against the record, so a bare ref silently changes access.
  // Named `sharingRule` rather than `rule` so the declared-key guard in the
  // test can tell this receiver apart from the VALIDATION rule one — the two
  // are governed by different schemas, and a scan that merged them would let a
  // key declared by either schema pass on both (#5017).
  for (const sharingRule of asArray(stack.sharingRules)) {
    const ruleObj = typeof sharingRule.object === 'string' ? sharingRule.object : undefined;
    const where = `sharingRule '${(sharingRule.name as string) ?? '?'}'${ruleObj ? ` (${ruleObj})` : ''} condition`;
    // `condition` is the authored key `SharingRuleSchema` declares. `criteria`
    // is the RUNTIME spelling of the compiled predicate (`criteria_json`) and
    // `sharing.zod.ts` maps it back to `condition` in its rejection message;
    // `predicate` is refused with no rename at all. #4984 removed exactly this
    // pair one file over; this was the same read left behind (#5017).
    check(where, sharingRule.condition, ruleObj, 'record');
  }

  // ── Hook `condition` predicates (record-scoped gate) ───────────────
  // A lifecycle hook's `condition` skips the handler when false; it is
  // evaluated against the record, so a bare ref silently makes the hook
  // run on every record (or never) instead of the intended subset.
  for (const hook of asArray(stack.hooks)) {
    const hookName = (hook.name as string) ?? '?';
    if (typeof hook.object === 'string') {
      check(`hook '${hookName}' (${hook.object}) condition`, hook.condition, hook.object, 'record');
      // #4763 — the third instance the issue found lived on exactly this path.
      checkNullGuards(
        `hook '${hookName}' (${hook.object}) condition`,
        `hook '${hookName}' condition`,
        hook.condition,
        hook.object,
      );
      continue;
    }

    // A hook may target MANY objects (`object: ['a','b']`). Previously any
    // non-string target dropped to `undefined`, so the condition got NO
    // field-awareness at all — a hook filtering on a field that exists on none
    // of its targets passed clean (issue #3583). The hook body runs against
    // each target in turn, so a ref missing from ANY of them silently
    // misbehaves there; validate per target and de-duplicate the
    // object-independent diagnostics (syntax/shape) that every pass repeats.
    const targets = Array.isArray(hook.object)
      ? (hook.object as unknown[]).filter((o): o is string => typeof o === 'string' && o !== '*')
      : [];
    if (targets.length === 0) {
      // `'*'` (or an unusable shape) — no single field set to judge against;
      // syntax/shape is still validated.
      check(`hook '${hookName}' condition`, hook.condition, undefined, 'record');
      continue;
    }

    const before = issues.length;
    const seen = new Set<string>();
    const kept: ExprIssue[] = [];
    for (const target of targets) {
      const mark = issues.length;
      check(`hook '${hookName}' (${target}) condition`, hook.condition, target, 'record');
      checkNullGuards(
        `hook '${hookName}' (${target}) condition`,
        `hook '${hookName}' condition`,
        hook.condition,
        target,
      );
      for (let i = mark; i < issues.length; i++) {
        const issue = issues[i];
        const key = `${issue.message}\u0000${issue.source ?? ''}`;
        // Keep the first occurrence of each distinct diagnostic. A field-unknown
        // finding differs per target (it names the object), so each survives;
        // a syntax error is identical across targets and collapses to one.
        if (!seen.has(key)) {
          seen.add(key);
          kept.push(issue);
        }
      }
    }
    issues.length = before;
    issues.push(...kept);
  }

  return issues;
}
