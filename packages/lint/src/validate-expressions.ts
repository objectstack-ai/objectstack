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
 *
 * Alias tolerance belongs at the schema's refusal, not in a consumer (Prime
 * Directive #12) — in a consumer it also converts a loud, named rejection into
 * a silently-inert (or, above, silently-WRONG) gate.
 *
 * One read here is still undeclared and is tracked rather than fixed in place:
 * the field-formula pass below reads `f.formula`, which `FieldSchema` rejects
 * in favour of `expression`. Converging it would ACTIVATE a check that has
 * never run against a parsing stack, which is a coverage change, not dead-code
 * removal — see the note at that call site and the tracking issue.
 */

import { validateExpression, collectCelRootIdentifiers } from '@objectstack/formula';
import { collectFlowGraphs, resolveFlowNodeExpressions } from '@objectstack/spec/automation';
import type { FlowNodeParsed } from '@objectstack/spec/automation';

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

/** object name → set of its field names, for schema-aware field checks. */
function buildFieldIndex(objects: AnyRec[]): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const obj of objects) {
    const name = typeof obj.name === 'string' ? obj.name : undefined;
    if (!name) continue;
    const fields = obj.fields;
    let names: string[] = [];
    if (Array.isArray(fields)) names = fields.map(f => (f as AnyRec).name).filter((n): n is string => typeof n === 'string');
    else if (fields && typeof fields === 'object') names = Object.keys(fields as AnyRec);
    idx.set(name, names);
  }
  return idx;
}

/**
 * object name → (field name → field type), for the #1928 tier-4 type-soundness
 * check. Handles both `fields` shapes (array of `{name, type}` and name-keyed
 * map). Fields with a non-string `type` are simply omitted (treated as `dyn`).
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

/** object name → set of field names that may hold `null` (#4763). */
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

  /**
   * The #4763 null-guard gate. Wired to exactly those surfaces whose predicates
   * CEL evaluates over a record made **total** for every declared field
   * (`materializeDeclaredFields`, #1871/#4649) — today: object validation rules
   * (`rule-validator.ts`, fail-closed since #4761), lifecycle hook `condition`s,
   * and field `requiredWhen` (#4811).
   *
   * Totality is the whole criterion, not a detail: on a total binding `has()` is
   * uniformly true and `!= null` is the fix, while on a SPARSE one `has()` is a
   * genuine guard and `!= null` faults with `No such key` — so pointing this gate
   * at a sparse-bound surface would reject correct metadata and prescribe a fix
   * that breaks it. `validate-null-guards.ts` carries the measured evidence table
   * and the per-surface ledger (action predicates, flow conditions, field
   * `readonlyWhen`, sharing rules and `Field.formula` are each excluded there with
   * a traced reason). Read it before extending this call.
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
                `Run \`os migrate meta --from 16\` to rewrite it automatically.`,
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
      // record as `{ ...inputDoc, ...after }` with no `materializeDeclaredFields`,
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
      // Scoped to `readonlyWhen` on purpose: it is the one field predicate the
      // server enforces as a write-path LOCK, so it is the one whose unbindable
      // scope changes what lands in the database. `requiredWhen` /
      // `visibleWhen` keep their existing verdicts untouched.
      const roWhenSource = celSourceOf(f.readonlyWhen);
      if (masters !== 1 && roWhenSource && readsParentRoot(roWhenSource)) {
        issues.push({
          where: `object '${objectName}' · field '${fname}' readonlyWhen`,
          message:
            `\`readonlyWhen\` reads \`parent\`, but object '${objectName}' declares ` +
            `${masters === 0 ? 'no' : `${masters}`} \`master_detail\` relationship${masters === 1 ? '' : 's'} — ` +
            `so the server has no header record to bind as \`parent\` and the field would be locked on every write. ` +
            (masters === 0
              ? `Declare the owning relationship as \`Field.masterDetail('<master>')\`, or rewrite the predicate against \`record\`.`
              : `\`parent\` needs exactly one master; name the header explicitly through \`record.<fk>\` state instead, or model the extra relationship as a \`lookup\`.`),
          source: roWhenSource,
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
      // `readonlyWhen` is deliberately NOT included even though it sits on
      // the same field: it is evaluated by `stripReadonlyWhenFields`, which
      // builds `{ ...previous, ...data }` and never materializes, so its
      // binding is sparse and `!= null` would be the wrong prescription
      // there. Same for `conditionalRequired` / `visibleWhen`, which have no
      // record-scoped total binding of their own. See the surface ledger in
      // `validate-null-guards.ts`.
      checkNullGuards(
        `object '${objectName}' · field '${fname}' requiredWhen`,
        `field '${fname}' requiredWhen`,
        f.requiredWhen,
        objectName,
        'fail-open',
      );
      if (f.formula) {
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
        const res = validateExpression('value', f.formula as string | { dialect?: string; source?: string },
          objectName ? { objectName, fields: fieldIndex.get(objectName), fieldTypes: fieldTypeIndex.get(objectName), scope: 'record' } : { scope: 'record' });
        const fieldWhere = `object '${objectName}' · field '${fname}' formula`;
        for (const e of res.errors) issues.push({ where: fieldWhere, message: e.message, source: e.source, severity: 'error' });
        for (const w of res.warnings) issues.push({ where: fieldWhere, message: w.message, source: w.source, severity: 'warning' });
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
