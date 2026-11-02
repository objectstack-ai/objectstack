// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where a `save_notice` node may stand (#28251) — refused at the flow parse,
 * so `objectstack validate`, the metadata save and `registerFlow` all refuse
 * it before any run.
 *
 * A `save_notice` node hands its message to the write that fired the run
 * (`SaveNoticeConfigSchema`), and only the record-change trigger dispatches a
 * run INSIDE a write: its hook handler awaits the run before the write
 * answers. The answer that carries a notice is the single-record create and
 * update one (`CreateDataResponseSchema.notice` / `UpdateDataResponseSchema.notice`),
 * so the trigger must be a create or an update:
 * `record-(before|after)-(create|insert|update|write)`, the grammar
 * `trigger-record-change` binds.
 *
 * Anywhere else no write waits on the run (a schedule, an `api` hook, a
 * screen flow, an autolaunched or subflow call, a delete trigger), so a notice
 * would reach nobody. That is refused here, at each such node, rather than
 * dropped at run time: a node an author placed and the run silently ignored is
 * exactly the declared-but-not-enforced shape the platform refuses.
 *
 * [#28806] A run that suspends (an `approval`, a `wait`, a `screen`, an
 * `approval_revise`) resumes after the write has answered, so a `save_notice`
 * reached on the resumed leg can only refuse by name at run time, and after an
 * approval the decision then strands its run (`RESUME_FAILED`). The parse sees
 * that leg in the graph: a `save_notice` reachable along the flow's edges from
 * a node that always suspends (`FLOW_PAUSE_CAPABLE_NODE_TYPES`, handed in by
 * the caller) is refused here, naming that node. "Reachable" is ANY path from
 * the start through such a node, loops included, not "every path": a static
 * graph cannot rule the suspended path out, so a node with a clean path beside
 * it is still a trap on the other one. A pausing node stands on the top-level
 * graph only (a region body refuses one), so a `save_notice` inside a region
 * is judged by its top-level container.
 *
 * What the parse still cannot see is left to the run: a `subflow` or a `map`
 * pauses only when the child flow it names does (a different record), and a
 * plugin-registered pausing type is not in the list. A `save_notice` reached
 * after one of those refuses the node by name there.
 */

import { collectFlowGraphs } from './control-flow.zod';

/** The record-change trigger tokens whose dispatch answers a create or update. */
const SAVE_NOTICE_TRIGGER = /^record-(before|after)-(create|insert|update|write)$/;

/** One refusal, anchored on the offending node's `type`. */
export interface SaveNoticePlacementRefusal {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
}

/** The flow's top-level start node's `config.triggerType`, as written. */
function startTriggerType(flow: { nodes?: unknown }): unknown {
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  const start = nodes.find(
    (node) => node !== null && typeof node === 'object' && (node as { type?: unknown }).type === 'start',
  ) as { config?: { triggerType?: unknown } } | undefined;
  return start?.config?.triggerType;
}

/** A top-level node's `id` and `type`, when both are strings. */
function idAndType(node: unknown): { id: string; type: string } | undefined {
  if (node === null || typeof node !== 'object') return undefined;
  const { id, type } = node as { id?: unknown; type?: unknown };
  return typeof id === 'string' && typeof type === 'string' ? { id, type } : undefined;
}

/**
 * [#28806] For each top-level node a path start → … → suspending node → … →
 * that node reaches, the suspending nodes on such a path, in node order.
 *
 * Reads the raw top-level `nodes` / `edges`: this runs inside the
 * `FlowSchema` parse, so a malformed member (no string `id`, an edge with no
 * string `source` / `target`) is skipped, never read through.
 */
function suspendedReach(
  flow: { nodes?: unknown; edges?: unknown },
  pauseCapableTypes: readonly string[],
): Map<string, Array<{ id: string; type: string }>> {
  const nodes = (Array.isArray(flow.nodes) ? flow.nodes : []).map(idAndType).filter((n) => n !== undefined);
  const next = new Map<string, string[]>();
  for (const edge of Array.isArray(flow.edges) ? flow.edges : []) {
    if (edge === null || typeof edge !== 'object') continue;
    const { source, target } = edge as { source?: unknown; target?: unknown };
    if (typeof source !== 'string' || typeof target !== 'string') continue;
    const list = next.get(source);
    if (list) list.push(target);
    else next.set(source, [target]);
  }
  const walk = (from: readonly string[]): Set<string> => {
    const seen = new Set<string>();
    const queue = [...from];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...(next.get(id) ?? []));
    }
    return seen;
  };
  const reach = new Map<string, Array<{ id: string; type: string }>>();
  const start = nodes.find((n) => n.type === 'start');
  if (!start) return reach;
  const fromStart = walk([start.id]);
  for (const pause of nodes) {
    if (!pauseCapableTypes.includes(pause.type) || !fromStart.has(pause.id)) continue;
    // From its successors, not itself: the node is "after" the pause only on a
    // path that leaves it, which is also how a loop back to it counts.
    for (const id of walk(next.get(pause.id) ?? [])) {
      const list = reach.get(id);
      if (list) list.push(pause);
      else reach.set(id, [pause]);
    }
  }
  return reach;
}

/**
 * Every `save_notice` node of `flow` (at any region depth) standing in a flow
 * whose start is not a record trigger on a create or an update, or (#28806)
 * reachable from a node whose type is in `pauseCapableTypes`.
 */
export function saveNoticePlacementRefusals(
  flow: Parameters<typeof collectFlowGraphs>[0],
  pauseCapableTypes: readonly string[],
): SaveNoticePlacementRefusal[] {
  const out: SaveNoticePlacementRefusal[] = [];
  const graphs = collectFlowGraphs(flow);
  const hasNotice = graphs.some((graph) =>
    graph.nodes.some((node) => (node as { type?: unknown } | null)?.type === 'save_notice'),
  );
  if (!hasNotice) return out;
  const trigger = startTriggerType(flow as { nodes?: unknown });
  if (typeof trigger === 'string' && SAVE_NOTICE_TRIGGER.test(trigger.trim())) {
    return suspendedLegRefusals(flow as { nodes?: unknown; edges?: unknown }, graphs, pauseCapableTypes);
  }
  // [#28786] The ARRAY form (`['record-after-create', 'record-after-update']`)
  // is refused with the same verdict, but named as what it is: multi-event
  // unions are unsupported and never bind (#3457), so "no record trigger"
  // would misname the shape and leave the author guessing what to change.
  const situation = Array.isArray(trigger)
    ? `This flow's start writes \`triggerType\` as an array (\`[${trigger.map((t) => `'${String(t)}'`).join(', ')}]\`). `
      + 'That form is not supported and never binds, so no write waits on the run and the notice would reach '
      + "nobody. Give the start node ONE trigger type: `'record-after-write'` fires on both a create and an "
      + 'update.'
    : `This flow's start has ${typeof trigger === 'string' ? `\`triggerType: '${trigger}'\`` : 'no record trigger'}, `
      + 'so no write waits on the run and the notice would reach nobody. Start the flow from the record write, '
      + 'or tell the person another way (a `notify` node).';
  for (const graph of graphs) {
    graph.nodes.forEach((node, index) => {
      if ((node as { type?: unknown } | null)?.type !== 'save_notice') return;
      out.push({
        path: [...graph.path, 'nodes', index, 'type'],
        message:
          'A `save_notice` node tells the person who made the write that fired this run what the save set in '
          + 'motion, so it runs only in a flow started by that write: a start node whose `config.triggerType` is '
          + "a create or update record trigger (`'record-after-update'`, `'record-before-create'`, "
          + `\`'record-after-write'\`, …). ${situation}`,
      });
    });
  }
  return out;
}

/**
 * [#28806] The `save_notice` nodes of a record-triggered flow that a
 * suspending node reaches, each refused naming the first such node.
 */
function suspendedLegRefusals(
  flow: { nodes?: unknown; edges?: unknown },
  graphs: ReturnType<typeof collectFlowGraphs>,
  pauseCapableTypes: readonly string[],
): SaveNoticePlacementRefusal[] {
  const out: SaveNoticePlacementRefusal[] = [];
  const reach = suspendedReach(flow, pauseCapableTypes);
  if (reach.size === 0) return out;
  const topLevel = Array.isArray(flow.nodes) ? flow.nodes : [];
  for (const graph of graphs) {
    // A region body's node is judged by its top-level container, the node
    // `path` = ['nodes', <index>, 'config', …] starts at.
    const container = graph.path.length === 0
      ? undefined
      : idAndType(topLevel[graph.path[1] as number]);
    graph.nodes.forEach((node, index) => {
      if ((node as { type?: unknown } | null)?.type !== 'save_notice') return;
      const self = graph.path.length === 0 ? idAndType(node) : container;
      const pauses = self ? reach.get(self.id) : undefined;
      if (!pauses || pauses.length === 0) return;
      const { id, type } = pauses[0];
      out.push({
        path: [...graph.path, 'nodes', index, 'type'],
        message:
          'A `save_notice` node tells the person who made the write that fired this run what the save set in '
          + 'motion, so it runs only while the run is still inside that write. '
          + `This one is reached after \`${type}\` node '${id}' suspends the run. A suspended run resumes after the write `
          + 'has already answered, so on that path the node is refused by name at run time, and after an approval the '
          + `decision cannot finish its run. Move the \`save_notice\` ahead of '${id}', or tell the person after it with a `
          + '`notify` node.',
      });
    });
  }
  return out;
}
