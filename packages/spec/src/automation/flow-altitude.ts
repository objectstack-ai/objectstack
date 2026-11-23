// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/flow-altitude
 *
 * **The flow-node types a business-altitude drawing folds away** (ADR-0051
 * §3.4, the `detail: business` projection of a `type: flow` metadata embed).
 *
 * A drawing at business altitude shows a reader the process, not the
 * plumbing: the infrastructure steps below are counted and hidden, every other
 * node is drawn by its label. `detail: technical` draws them all.
 *
 * ONE table, two readers, so they cannot drift:
 *
 *  - the docs viewer's `FlowView` (`element:metadata_viewer`), which decides
 *    which steps a manual's reader sees;
 *  - the i18n walk (`packages/lint`, `i18n/missing-flow`), which demands a
 *    translated label, `flows.<flow>.nodes.<node_id>.label`, for exactly the
 *    steps that viewer names at its default altitude (ruling 7076440876):
 *    every step it draws, and a folded step only where a drawn decision's
 *    branch list names it as the step the branch leads to.
 *
 * The branch list is the second rule the two readers share, so it lives here
 * too: {@link flowDecisionEdgeBranch} says which out-edges of a decision the
 * viewer lists (`decisionBranches`, `ui/packages/components`) and therefore
 * which folded steps the walk asks a label for (`decisionBranchTechnicalTargets`).
 *
 * Display only: nothing here changes how a flow runs.
 */

/** The node types `detail: business` hides. Every other node type is a business step. */
export const FLOW_TECHNICAL_NODE_TYPES = Object.freeze([
  'script',
  'http',
  'connector_action',
  'assignment',
  'get_record',
  'create_record',
  'update_record',
  'delete_record',
  'boundary_event',
] as const);

const TECHNICAL = new Set<string>(FLOW_TECHNICAL_NODE_TYPES);

/** True when a node of `type` is folded away at business altitude. */
export function isFlowTechnicalNodeType(type: unknown): boolean {
  return typeof type === 'string' && TECHNICAL.has(type);
}

/**
 * The label a decision's fall-through branch carries: an out-edge labelled so
 * is taken when no condition matches. The same word as the automation
 * engine's `DEFAULT_BRANCH_LABEL` (`@objectstack/service-automation`).
 */
export const FLOW_DECISION_DEFAULT_BRANCH_LABEL = 'default';

/**
 * How a drawing reads one out-edge of a `decision` node:
 *
 *  - `default` — the fall-through branch (`isDefault`, or, on a decision that
 *    declares `config.conditions`, the {@link FLOW_DECISION_DEFAULT_BRANCH_LABEL} label);
 *  - `edge` — a decision with no `config.conditions` is a gateway whose
 *    out-edges carry their own `condition`, so every out-edge is a branch;
 *  - `condition` — the declared condition whose `label` the edge's `label` names.
 */
export type FlowDecisionEdgeBranch =
  | { kind: 'default' }
  | { kind: 'edge' }
  | { kind: 'condition'; condition: Readonly<Record<string, unknown>> };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Which branch of a decision the out-edge `edge` is, given the decision's
 * `config.conditions` as authored; `undefined` for an edge no branch can ever
 * take (a labelled edge of a `conditions` decision whose label neither a
 * condition nor the default claims), which a drawing leaves out.
 *
 * The one rule both readers apply: the docs viewer's branch list
 * (`decisionBranches`) and the i18n walk's folded branch targets
 * (`decisionBranchTechnicalTargets`, `packages/lint`).
 */
export function flowDecisionEdgeBranch(edge: unknown, conditions: unknown): FlowDecisionEdgeBranch | undefined {
  if (!isPlainRecord(edge)) return undefined;
  const declared = Array.isArray(conditions) ? conditions.filter(isPlainRecord) : [];
  if (edge.isDefault === true || (declared.length > 0 && edge.label === FLOW_DECISION_DEFAULT_BRANCH_LABEL)) {
    return { kind: 'default' };
  }
  if (declared.length === 0) return { kind: 'edge' };
  const label = edge.label;
  if (typeof label !== 'string') return undefined;
  const condition = declared.find((c) => c.label === label);
  return condition ? { kind: 'condition', condition } : undefined;
}
