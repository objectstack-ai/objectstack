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
 * `condition`) and object validation-rule / formula predicates. Each error is
 * located (flow/object + node/edge/field) with a corrective message.
 */

import { validateExpression } from '@objectstack/formula';

export interface ExprIssue {
  where: string;
  message: string;
  source: string;
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

  const check = (where: string, raw: unknown, objectName?: string): void => {
    if (raw == null) return;
    const fields = objectName ? fieldIndex.get(objectName) : undefined;
    const res = validateExpression('predicate', raw as string | { dialect?: string; source?: string },
      objectName ? { objectName, fields } : undefined);
    for (const e of res.errors) issues.push({ where, message: e.message, source: e.source });
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
        const fn = typeof cfg.function === 'string' ? cfg.function.trim() : '';
        const action = typeof cfg.actionType === 'string' ? cfg.actionType.trim() : '';
        if (!fn && !action) {
          issues.push({
            where: `flow '${flowName}' · node '${node.id}' (script) callable`,
            message:
              `script node declares neither \`actionType\` nor \`function\` — it would do nothing at runtime. ` +
              `Name a built-in action (e.g. \`actionType: 'email'\`) or a registered function ` +
              `(\`function: 'my_fn'\`, registered via \`defineStack({ functions })\`).`,
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
      // Common predicate keys across rule shapes.
      check(where, rule.expression ?? rule.predicate ?? rule.condition ?? rule.formula, objectName);
    }
    // Field-level formulas (computed fields) reference the same object.
    const fields = obj.fields;
    const fieldList = Array.isArray(fields)
      ? (fields as AnyRec[])
      : (fields && typeof fields === 'object' ? Object.values(fields as AnyRec) as AnyRec[] : []);
    for (const f of fieldList) {
      if (f && typeof f === 'object' && f.formula) {
        // formulas are `value` role (any return type), still CEL.
        const res = validateExpression('value', f.formula as string | { dialect?: string; source?: string },
          objectName ? { objectName, fields: fieldIndex.get(objectName) } : undefined);
        for (const e of res.errors) {
          issues.push({ where: `object '${objectName}' · field '${(f.name as string) ?? '?'}' formula`, message: e.message, source: e.source });
        }
      }
    }
  }

  return issues;
}
