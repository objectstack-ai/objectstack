// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/flow-reserved-node-types
 *
 * **The retired official flow-node type names, reserved inside the open node
 * namespace** (#23543 F5-http, ADR-0018).
 *
 * `FlowNodeSchema.type` is an open string: ADR-0018 removed the enum gate so a
 * plugin can register its own node types. Protocol 11 unified the three
 * divergent callout types `http_request` / `http_call` / `webhook` into the one
 * canonical `http` node, and the ADR-0087 D2 conversion
 * `flow-node-http-callout-rename` rewrote them at load until 18. At 18 that
 * conversion left the load path, so the names are reserved instead:
 *
 *  - the flow parse refuses each one as a node `type`, naming `http`
 *    ({@link reservedFlowNodeTypeRefusal}, read by `FlowNodeSchema.type` for a
 *    top-level node and by the `FlowSchema` superRefine for a node in an
 *    ADR-0031 region body);
 *  - the automation engine refuses to register a node executor under one
 *    (`AutomationEngine.registerNodeExecutor`), because no node could ever
 *    reach it: an authored node is refused here, and a stored node is
 *    rewritten to `http` before anything parses it.
 *
 * ONE table, three readers, so they cannot drift: the two refusals above and
 * the conversion itself, which still runs at every data-at-rest seam
 * (`includeRetired`) so a stored flow written with an old name keeps loading
 * as `http`.
 *
 * ⛔ Not the wait node's `waitEventConfig.eventType: 'webhook'`: that is a
 * different field with its own closed vocabulary, and it stays legal.
 */

/** Retired official node type → the canonical type that superseded it. */
export const FLOW_RESERVED_NODE_TYPES: Readonly<Record<string, 'http'>> = Object.freeze({
  http_request: 'http',
  http_call: 'http',
  webhook: 'http',
});

/**
 * The refusal an author meets for writing a reserved name as a flow node's
 * `type`, or `undefined` for any other value. No `os migrate meta` sentence, on
 * purpose: the rename belongs to protocol 11, below `MIGRATION_SUPPORT_FLOOR`,
 * so the tool lists no edit for it.
 */
export function reservedFlowNodeTypeRefusal(type: unknown): string | undefined {
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(FLOW_RESERVED_NODE_TYPES, type)) return undefined;
  const canonical = FLOW_RESERVED_NODE_TYPES[type];
  const eventTypeNote = type === 'webhook'
    ? " A wait node's `waitEventConfig.eventType: 'webhook'` is a different field and stays legal."
    : '';
  return `Flow node \`type: '${type}'\` was removed in @objectstack/spec 18 (ADR-0087 D2) — it is one of the `
    + `three callout node types ADR-0018 unified into \`${canonical}\`, the loader rewrote it to \`${canonical}\` `
    + 'until this release, and the name stays reserved inside the open node namespace so no plugin can claim it '
    + `(ADR-0018). Use \`type: '${canonical}'\`. Change the value; the conversion never touched the node's \`config\`, `
    + `so the \`${canonical}\` contract judges it as written.${eventTypeNote}`;
}
