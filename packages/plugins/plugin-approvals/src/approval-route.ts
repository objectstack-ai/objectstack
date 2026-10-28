// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26668] A request's own route through its flow — `ApprovalRequestRow.flow_route`,
 * the contract doc in `@objectstack/spec/contracts` is the rule. Two halves:
 *
 * - {@link passedSteps}: the steps the run has already passed, read off the
 *   run's own `sys_approval_request` rows. History, never the graph.
 * - {@link stepsAhead}: the steps the graph alone decides past a pending node,
 *   when each step approves. The walk stops, and says so, at the first branch
 *   it cannot decide; it never takes the trunk's branch in its place, which is
 *   what `flow_steps` does.
 *
 * Pure functions over the flow and the rows: the service reads both and
 * attaches the result (`ApprovalService.attachFlowRoute`).
 */

import type { ApprovalRequestRow } from '@objectstack/spec/contracts';

export type FlowRoute = NonNullable<ApprovalRequestRow['flow_route']>;
type RouteStep = FlowRoute['steps'][number];

/** The parts of a flow graph the route reads. */
export interface RouteFlowGraph {
  nodes?: ReadonlyArray<{ id: string; type?: string; label?: string; regions?: unknown }>;
  edges?: ReadonlyArray<{ source: string; target: string; label?: string; type?: string; condition?: unknown; isDefault?: boolean }>;
}

/** The parts of one stored request row the route reads. */
export interface RouteRequestRow {
  id?: unknown;
  flow_node_id?: unknown;
  status?: unknown;
  created_at?: unknown;
}

/** Names a step: the reader's label, else the node's, else the id. */
export type RouteStepLabel = (nodeId: string) => string;

/**
 * Node types that run other nodes (another flow, or a region body), so an
 * approval may sit inside them where this walk cannot see it.
 */
const OPAQUE_NODE_TYPES = new Set(['subflow', 'map', 'loop']);

/**
 * The approval steps `current`'s run passed before `current`, oldest first:
 * a row of the same run, on another node, `approved`, opened before
 * `current`. A node approved in several rounds is listed once, at its latest.
 * `runRows` is the run's own request rows: the caller reads them by the run's
 * `flow_run_id`, and this function does not filter by run.
 */
export function passedSteps(
  current: { id: string; flow_node_id?: string; created_at?: string },
  runRows: ReadonlyArray<RouteRequestRow>,
  label: RouteStepLabel,
): RouteStep[] {
  const nodeId = current.flow_node_id;
  const openedAt = current.created_at;
  if (!nodeId || !openedAt) return [];
  const passed = new Map<string, string>();
  for (const r of runRows) {
    const node = typeof r.flow_node_id === 'string' ? r.flow_node_id : undefined;
    const at = typeof r.created_at === 'string' ? r.created_at : undefined;
    if (!node || node === nodeId || String(r.id) === current.id) continue;
    if (r.status !== 'approved' || !at || at >= openedAt) continue;
    const prev = passed.get(node);
    if (!prev || prev < at) passed.set(node, at);
  }
  return [...passed.entries()]
    .sort(([, a], [, b]) => a.localeCompare(b))
    .map(([id]) => ({ id, label: label(id), state: 'done' as const }));
}

/**
 * The approval steps past `fromNodeId` that the graph alone decides when each
 * step approves, and what lies past the last of them: `end` when the walk
 * reached the flow's end, `undecided` when it stopped at a branch.
 *
 * From an approval node the walk takes its `approve` out-edges (the edge a
 * decision resumes the run down); from any other node, every out-edge. Fault
 * edges are an error path and never part of the route. The walk follows ONE
 * edge with no condition and stops, `undecided`, at anything else: a
 * `decision` node, a conditioned edge, several out-edges, a node seen before,
 * a node it cannot find, or a node that runs other nodes.
 */
export function stepsAhead(
  flow: RouteFlowGraph,
  fromNodeId: string,
  label: RouteStepLabel,
): { steps: RouteStep[]; ahead: 'end' | 'undecided' } {
  const nodes = new Map((flow.nodes ?? []).map((n) => [n.id, n]));
  const edges = (flow.edges ?? []).filter((e) => e.type !== 'fault');
  const steps: RouteStep[] = [];
  const seen = new Set<string>([fromNodeId]);
  let node = nodes.get(fromNodeId);
  while (node) {
    const out = edges.filter((e) => e.source === node!.id);
    const approve = node.type === 'approval' ? out.filter((e) => e.label === 'approve') : [];
    const next = approve.length > 0 ? approve : out;
    if (next.length === 0) return { steps, ahead: 'end' };
    if (node.type === 'decision' || next.length > 1 || next[0].condition) return { steps, ahead: 'undecided' };
    const target = nodes.get(next[0].target);
    if (!target || seen.has(target.id)) return { steps, ahead: 'undecided' };
    if (OPAQUE_NODE_TYPES.has(String(target.type)) || target.regions) return { steps, ahead: 'undecided' };
    seen.add(target.id);
    if (target.type === 'approval') steps.push({ id: target.id, label: label(target.id), state: 'upcoming' });
    node = target;
  }
  return { steps, ahead: 'undecided' };
}

/**
 * The whole route of `row`: {@link passedSteps}, then `row`'s own node, then
 * — for a pending row only — {@link stepsAhead}. `undefined` when the row
 * names no node.
 */
export function flowRoute(
  row: Pick<ApprovalRequestRow, 'id' | 'flow_node_id' | 'created_at' | 'status'>,
  flow: RouteFlowGraph,
  runRows: ReadonlyArray<RouteRequestRow>,
  label: RouteStepLabel,
): FlowRoute | undefined {
  const nodeId = row.flow_node_id;
  if (!nodeId) return undefined;
  const own: RouteStep = { id: nodeId, label: label(nodeId), state: row.status === 'approved' ? 'done' : 'current' };
  const before = passedSteps(row, runRows, label);
  if (row.status !== 'pending') return { steps: [...before, own], ahead: 'decided' };
  const after = stepsAhead(flow, nodeId, label);
  return { steps: [...before, own, ...after.steps], ahead: after.ahead };
}
