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
 *    steps that viewer draws at its default altitude (ruling 7076440876).
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
