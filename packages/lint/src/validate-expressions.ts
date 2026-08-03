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
 */

import { validateExpression } from '@objectstack/formula';
import { collectFlowGraphs, resolveFlowNodeExpressions } from '@objectstack/spec/automation';
import type { FlowNodeParsed } from '@objectstack/spec/automation';

import { findUnguardedNullableOperands, nullGuardMessage } from './validate-null-guards.js';

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
  const main = rule.expression ?? rule.predicate ?? rule.condition ?? rule.formula;
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
   * The #4763 null-guard gate. Scoped to the surfaces whose predicates are
   * EVALUATED by CEL over a record made total for every declared field —
   * validation rules (`rule-validator.ts`, fail-closed since #4649/#4761) and
   * lifecycle hook `condition`s. Deliberately NOT applied to sharing-rule
   * conditions (compiled to a SQL filter, where `NULL > x` is three-valued and
   * never faults), flow conditions (flattened scope: a bare identifier may be a
   * flow variable, not a field), or `Field.formula` expressions (whose blessed
   * `guard ? value : null` shape has its own #3306 handling). Those surfaces are
   * tracked separately rather than half-covered.
   */
  const checkNullGuards = (
    where: string,
    subject: string,
    raw: unknown,
    objectName: string | undefined,
  ): void => {
    if (!objectName) return;
    const nullableFields = nullableIndex.get(objectName);
    if (!nullableFields || nullableFields.size === 0) return;
    const source = celSourceOf(raw);
    if (!source) return;
    for (const finding of findUnguardedNullableOperands(source, { nullableFields })) {
      issues.push({
        where,
        message: nullGuardMessage(subject, objectName, finding),
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
    }
  }

  // ── Object validation-rule + formula predicates ────────────────────
  for (const obj of objects) {
    const objectName = typeof obj.name === 'string' ? obj.name : undefined;
    const validations = obj.validations ?? obj.validationRules;
    for (const rule of asArray(validations)) {
      const where = `object '${objectName}' · validation '${(rule.name as string) ?? '?'}'`;
      // Common predicate keys across rule shapes. Validation predicates are
      // `record`-scoped — no field flattening — so bare refs are flagged (#1928).
      check(where, rule.expression ?? rule.predicate ?? rule.condition ?? rule.formula, objectName, 'record');
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
    const fieldList = Array.isArray(fields)
      ? (fields as AnyRec[])
      : (fields && typeof fields === 'object' ? Object.values(fields as AnyRec) as AnyRec[] : []);

    // (ADR-0062 D7's `field.columnName`-on-external-objects rejection was removed
    // with `field.columnName` itself in #2377: the field no longer exists, so there
    // is no dual-source ambiguity to guard — external column mapping is `external.columnMap`.)

    for (const f of fieldList) {
      // Field-level conditional rules are server-enforced (rule-validator) and
      // record-scoped — a bare ref silently fails the rule (required/readonly
      // not enforced = data-integrity hole). #1928 class, same as actions.
      if (f && typeof f === 'object') {
        const fname = (f.name as string) ?? '?';
        for (const key of ['requiredWhen', 'readonlyWhen', 'conditionalRequired', 'visibleWhen'] as const) {
          check(`object '${objectName}' · field '${fname}' ${key}`, (f as AnyRec)[key], objectName, 'record');
        }
      }
      if (f && typeof f === 'object' && f.formula) {
        // formulas are `value` role (any return type), still CEL. They are
        // `record`-scoped — `record.<field>`, never bare — so flag bare refs (#1928).
        const res = validateExpression('value', f.formula as string | { dialect?: string; source?: string },
          objectName ? { objectName, fields: fieldIndex.get(objectName), fieldTypes: fieldTypeIndex.get(objectName), scope: 'record' } : { scope: 'record' });
        const fieldWhere = `object '${objectName}' · field '${(f.name as string) ?? '?'}' formula`;
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
    const obj = objectName
      ?? (typeof action.objectName === 'string' ? action.objectName : undefined)
      ?? (typeof action.object === 'string' ? action.object : undefined);
    const name = typeof action.name === 'string' ? action.name : '?';
    const key = `${obj ?? ''}:${name}`;
    if (seenActions.has(key)) return; // de-dup (actions are merged onto objects AND kept top-level)
    seenActions.add(key);
    check(`${where} · action '${name}' visible`, action.visible, obj, 'record');
    if (typeof action.disabled !== 'boolean') {
      check(`${where} · action '${name}' disabled`, action.disabled, obj, 'record');
    }
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
  for (const rule of asArray(stack.sharingRules)) {
    const ruleObj = typeof rule.object === 'string' ? rule.object : undefined;
    const where = `sharingRule '${(rule.name as string) ?? '?'}'${ruleObj ? ` (${ruleObj})` : ''} condition`;
    check(where, rule.condition ?? rule.criteria ?? rule.predicate, ruleObj, 'record');
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
