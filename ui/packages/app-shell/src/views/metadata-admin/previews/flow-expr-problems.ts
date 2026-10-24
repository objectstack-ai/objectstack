// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * flow-expr-problems — pure, client-side detection of EXPRESSION issues across a
 * whole flow draft, for surfacing in the Problems panel + canvas badges (#1934).
 *
 * Two kinds, mirroring the inline inspector checks but aggregated per node/edge:
 *   • ADR-0032 brace / shape ERRORS on every CEL field (decision conditions +
 *     branch expressions, screen `visibleWhen`, a body-less loop's collection,
 *     edge guards…).
 *     Deterministic, scope-free → zero false positives.
 *   • Scope-aware "unknown reference" WARNINGS — a bare root not in scope at the
 *     node. The START node is skipped: its entry condition legitimately uses the
 *     trigger record's fields *bare* (`status`), which can't be told apart from a
 *     typo without the object schema (an async fetch this pure pass avoids); the
 *     inline inspector check, which does fetch, still covers it.
 *
 * Only `expression` surfaces are scanned. No flow string reads a single-brace
 * `{var}` token since spec 18 (objectstack#19939 deleted the dialect), so there
 * is no template surface to skip (objectui#12390). Two kinds of `expression`
 * descriptor field are read differently:
 *
 *   • A body-less `loop`'s `collection` is a bare name: its executor reads the
 *     list variable by name. It is scanned like every CEL field, so a stored
 *     `{leadList}` is the brace error with `leadList` as the fix, and an
 *     unbound name is the unknown-reference warning.
 *   • A position the spec's ledger names a `value` slot at this node (a `map`'s
 *     `collection`, a `loop`'s once it has a `body`; `resolveFlowNodeValueSlots`)
 *     holds a literal or a CEL value envelope and is judged by the spec's
 *     value-slot judges, which the inline control reads. It is not scanned
 *     here: the brace check's fix, a bare name, is what that slot refuses.
 *
 * ## A screen field's `visibleWhen` is not a flow-scope slot (objectui#10743)
 *
 * The `screen` node's `fields[].visibleWhen` column binds the screen's OWN
 * declared fields plus `record`, never the flow scope: the renderer evaluates
 * it over the values being collected (spec `ScreenFieldSpec.visibleWhen`). So
 * that column is judged by `screenVisibleWhenScopeError` (`./screen-spec.ts`),
 * the same rule the Debug run's screen step applies — a sibling-field predicate
 * (`discount > 0`) is clean, and a run variable (`needsApproval == true`) is
 * the unknown reference, however rich the flow scope is. Reported at
 * `warning`, this panel's level for a reference nothing binds: the runtime
 * accepts such a flow today (the `registerFlow` refusal is objectstack#20178)
 * and the runner falls back on it. Every other `expression` slot keeps the
 * flow scope.
 */

import { resolveFlowNodeValueSlots } from '@objectstack/spec/automation';
import { fieldsForNodeType, getFieldValue, localizeFlowFields } from '../inspectors/flow-node-config.js';
import { resolveEdgeScope, resolveFlowScope } from '../inspectors/flow-scope.js';
import { scopeRoots, findUnknownRefs, describeUnknownRefs } from '../inspectors/flow-ref-check.js';
import { validateExpressionClient } from '../inspectors/expression-validate.js';
import { screenVisibleWhenScopeError, type ScreenPreviewNode } from './screen-spec.js';
import type { DiagnosticLevel } from './simulator/flow-sim-types.js';

export interface ExprProblem {
  target: { kind: 'node'; nodeId: string } | { kind: 'edge'; source: string; target: string };
  level: DiagnosticLevel;
  message: string;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

/**
 * Brace error (error) else unknown-ref (warning, when `roots` given) for one CEL
 * value — both in the designer `locale`, the words the inline cell shows for
 * the same value (objectui#10804).
 */
function checkCel(value: unknown, roots: Set<string> | null, locale?: string): { level: DiagnosticLevel; message: string } | null {
  const issue = validateExpressionClient('predicate', value, locale);
  if (issue) return { level: 'error', message: issue.message };
  if (roots && roots.size > 0) {
    const unknown = findUnknownRefs(value, 'predicate', roots);
    if (unknown.length > 0) return { level: 'warning', message: describeUnknownRefs(unknown, locale) };
  }
  return null;
}

/**
 * Brace error (error) else an undeclared screen-field root (warning) for one
 * screen field's `visibleWhen` — the declared screen scope, shared with the
 * Debug run's screen step (objectui#10743), never the flow scope. Both read the
 * designer `locale`, as the inline cell does (objectui#10804).
 */
function checkScreenVisibleWhen(
  value: unknown,
  node: ScreenPreviewNode,
  locale?: string,
): { level: DiagnosticLevel; message: string } | null {
  const issue = validateExpressionClient('predicate', value, locale);
  if (issue) return { level: 'error', message: issue.message };
  const scope = screenVisibleWhenScopeError(value, node, locale);
  return scope ? { level: 'warning', message: scope } : null;
}

/**
 * Whether the descriptor field at `path` is one `value`-role slot of the spec's
 * ledger on this node — asked of the node as it stands with a probe at the key,
 * so the ledger's `onlyWithKey` (a `loop` reads `collection` as a value only
 * with a `body`) is the spec's answer (objectui#12390).
 */
function isValueSlot(type: string, config: Record<string, unknown>, path: readonly string[]): boolean {
  if (path.length !== 2 || path[0] !== 'config') return false;
  const key = path[1];
  return resolveFlowNodeValueSlots(type, { ...config, [key]: 'probe' }).some((found) => found.path === key);
}

/**
 * The `screen` node's `fields[].visibleWhen` column — the one `objectList`
 * expression cell that is not a flow-scope slot. Exported so the inline
 * inspector cell (`FlowObjectListField`) names the same column (objectui#10772).
 */
export function isScreenVisibleWhenColumn(type: string, fieldId: string, colKey: string): boolean {
  return type === 'screen' && fieldId === 'fields' && colKey === 'visibleWhen';
}

/**
 * Scan a flow draft for expression problems, resolved onto node / edge targets.
 * Pure: no network — the trigger object's fields are not expanded (root-only
 * scope), which is why the start node is excluded from the ref check.
 *
 * `connectors` is the runtime connector registry the caller already read
 * (`GET /api/v1/automation/connectors`, unwrapped to the connector array), so a
 * committed `connector_action` node's declared output keys are in scope
 * downstream, as the inspectors judge them (objectui#11085). Omitted, such a
 * node writes nothing this scan can see.
 *
 * An edge guard is judged against the EDGE's scope ({@link resolveEdgeScope}):
 * the scope at its source plus the source's own outputs, the ones the engine
 * has written by the time it evaluates the guard (objectui#11085).
 */
export function flowExpressionProblems(draft: Record<string, unknown>, locale?: string, connectors?: unknown): ExprProblem[] {
  const nodes = asArray(draft.nodes).map(asRecord);
  const edges = asArray(draft.edges).map(asRecord);
  const startId = str(nodes.find((n) => str(n.type) === 'start')?.id);
  const out: ExprProblem[] = [];

  for (const node of nodes) {
    const nodeId = str(node.id);
    const type = str(node.type);
    if (!nodeId || !type) continue;
    // Root-only scope at this node; skip the ref check on the start node (its
    // bare trigger-record fields are indistinguishable from typos here).
    const roots = nodeId === startId ? null : scopeRoots(resolveFlowScope(draft, nodeId, undefined, connectors).refs);

    // Localized as the inspector localizes them, so a row with no label of its
    // own is prefixed by the column label the author sees (objectui#10804).
    for (const field of localizeFlowFields(type, fieldsForNodeType(type), locale)) {
      if (field.kind === 'expression') {
        if (isValueSlot(type, asRecord(node.config), field.path)) continue;
        const hit = checkCel(getFieldValue(node, field), roots, locale);
        if (hit) out.push({ target: { kind: 'node', nodeId }, level: hit.level, message: hit.message });
      } else if (field.kind === 'objectList' && field.columns) {
        const exprCols = field.columns.filter((c) => c.kind === 'expression');
        if (exprCols.length === 0) continue;
        const screenNode: ScreenPreviewNode = { id: nodeId, config: asRecord(node.config) };
        for (const row of asArray(getFieldValue(node, field))) {
          const r = asRecord(row);
          const rowLabel = str(r.label);
          for (const col of exprCols) {
            const hit = isScreenVisibleWhenColumn(type, field.id, col.key)
              ? checkScreenVisibleWhen(r[col.key], screenNode, locale)
              : checkCel(r[col.key], roots, locale);
            if (hit) {
              const prefix = rowLabel || col.label;
              out.push({ target: { kind: 'node', nodeId }, level: hit.level, message: prefix ? `${prefix}: ${hit.message}` : hit.message });
            }
          }
        }
      }
    }
  }

  for (const edge of edges) {
    const source = str(edge.source);
    const target = str(edge.target);
    if (!source || !target || edge.isDefault === true) continue;
    const roots = source === startId ? null : scopeRoots(resolveEdgeScope(draft, edge, undefined, connectors).refs);
    const hit = checkCel(edge.condition, roots, locale);
    if (hit) out.push({ target: { kind: 'edge', source, target }, level: hit.level, message: hit.message });
  }

  return out;
}
