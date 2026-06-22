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
 * Scope (v1): flow predicates (start/decision `config.condition` + edge
 * `condition`), object validation-rule / formula predicates, and UI action
 * `visible` / `disabled` predicates. Each error is located (flow/object/action
 * + node/edge/field) with a corrective message.
 */

import { validateExpression } from '@objectstack/formula';

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
 * Validate every predicate in the stack. Returns the list of issues (empty =
 * clean). Caller decides how to surface / whether to fail the build.
 */
export function validateStackExpressions(stack: AnyRec): ExprIssue[] {
  const issues: ExprIssue[] = [];
  const objects = asArray(stack.objects);
  const fieldIndex = buildFieldIndex(objects);

  const check = (
    where: string,
    raw: unknown,
    objectName?: string,
    scope: 'record' | 'flattened' = 'flattened',
  ): void => {
    if (raw == null) return;
    const fields = objectName ? fieldIndex.get(objectName) : undefined;
    const res = validateExpression('predicate', raw as string | { dialect?: string; source?: string },
      objectName ? { objectName, fields, scope } : { scope });
    for (const e of res.errors) issues.push({ where, message: e.message, source: e.source, severity: 'error' });
    for (const w of res.warnings) issues.push({ where, message: w.message, source: w.source, severity: 'warning' });
  };

  // ── Flows ──────────────────────────────────────────────────────────
  for (const flow of asArray(stack.flows)) {
    const flowName = typeof flow.name === 'string' ? flow.name : '(unnamed flow)';
    const nodes = Array.isArray(flow.nodes) ? (flow.nodes as AnyRec[]) : [];
    const edges = Array.isArray(flow.edges) ? (flow.edges as AnyRec[]) : [];
    // The record-change target object — `record.*` refs resolve against it.
    const startNode = nodes.find(n => n.type === 'start');
    const startCfg = (startNode?.config ?? {}) as AnyRec;
    const objectName = typeof startCfg.objectName === 'string' ? startCfg.objectName : undefined;

    for (const node of nodes) {
      const cfg = (node.config ?? {}) as AnyRec;
      check(`flow '${flowName}' · node '${node.id}' (${node.type}) condition`, cfg.condition, objectName);
      // #1870 — a `script` node must declare a callable target (`actionType` or
      // `function`). A node with neither is a silent no-op that otherwise passes
      // build. (Function *existence* isn't checkable here — functions are code,
      // not serialized into the artifact — so this is a structural check; the
      // runtime verifies the named function is actually registered.)
      if (node.type === 'script') {
        // `function` is canonical; `functionName` is an accepted alias.
        const fn =
          (typeof cfg.function === 'string' ? cfg.function.trim() : '') ||
          (typeof cfg.functionName === 'string' ? cfg.functionName.trim() : '');
        const action = typeof cfg.actionType === 'string' ? cfg.actionType.trim() : '';
        // Inline `config.script` (a JS body) is also a declared form — the
        // built-in runtime doesn't execute it (warned at run time), but the node
        // is not the empty no-op this check targets, so don't flag it.
        const inline = typeof cfg.script === 'string' ? cfg.script.trim() : '';
        if (!fn && !action && !inline) {
          issues.push({
            where: `flow '${flowName}' · node '${node.id}' (script) callable`,
            message:
              `script node declares neither \`actionType\` nor \`function\` — it would do nothing at runtime. ` +
              `Name a built-in action (e.g. \`actionType: 'email'\`) or a registered function ` +
              `(\`function: 'my_fn'\`, registered via \`defineStack({ functions })\`).`,
            source: JSON.stringify({ id: node.id, type: node.type, config: cfg }),
          });
        } else if (action === 'invoke_function' && !fn) {
          // `actionType: 'invoke_function'` is a marker that names no callable on
          // its own — the function name must be in `function`/`functionName`.
          issues.push({
            where: `flow '${flowName}' · node '${node.id}' (script) callable`,
            message:
              `script node uses \`actionType: 'invoke_function'\` but no \`function\` (or \`functionName\`) — ` +
              `it names no callable. Set \`function: 'my_fn'\` and register it via \`defineStack({ functions })\`.`,
            source: JSON.stringify({ id: node.id, type: node.type, config: cfg }),
          });
        }
      }
    }
    for (const edge of edges) {
      check(`flow '${flowName}' · edge '${edge.id}' (${edge.source}→${edge.target}) condition`, edge.condition, objectName);
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
    }
    // Field-level formulas (computed fields) reference the same object.
    const fields = obj.fields;
    const fieldList = Array.isArray(fields)
      ? (fields as AnyRec[])
      : (fields && typeof fields === 'object' ? Object.values(fields as AnyRec) as AnyRec[] : []);
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
          objectName ? { objectName, fields: fieldIndex.get(objectName), scope: 'record' } : { scope: 'record' });
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
    const hookObj = typeof hook.object === 'string' ? hook.object : undefined; // array targets → no single field set
    check(`hook '${(hook.name as string) ?? '?'}'${hookObj ? ` (${hookObj})` : ''} condition`, hook.condition, hookObj, 'record');
  }

  return issues;
}
