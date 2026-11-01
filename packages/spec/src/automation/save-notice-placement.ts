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
 * What the parse cannot see is left to the run: a run that pauses (an
 * `approval` or a `wait`) and resumes no longer holds the write, so a
 * `save_notice` reached on the resumed leg refuses the node by name there.
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

/**
 * Every `save_notice` node of `flow` (at any region depth) standing in a flow
 * whose start is not a record trigger on a create or an update.
 */
export function saveNoticePlacementRefusals(
  flow: Parameters<typeof collectFlowGraphs>[0],
): SaveNoticePlacementRefusal[] {
  const out: SaveNoticePlacementRefusal[] = [];
  const graphs = collectFlowGraphs(flow);
  const hasNotice = graphs.some((graph) =>
    graph.nodes.some((node) => (node as { type?: unknown } | null)?.type === 'save_notice'),
  );
  if (!hasNotice) return out;
  const trigger = startTriggerType(flow as { nodes?: unknown });
  if (typeof trigger === 'string' && SAVE_NOTICE_TRIGGER.test(trigger.trim())) return out;
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
