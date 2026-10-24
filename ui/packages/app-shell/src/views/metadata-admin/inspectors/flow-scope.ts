// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * flow-scope — pure, framework-free resolution of the in-scope variable
 * references at a given flow node, for the inspector's variable data-picker
 * (#1934).
 *
 * "In scope" is GRAPH-AWARE: a reference is offered at node N only if it can
 * actually exist when N runs. Concretely:
 *
 *   - Flow variables — every entry in `draft.variables[]` (declared up-front, so
 *     always in scope).
 *   - Upstream outputs — the `outputVariable(s)` / collected screen
 *     `fields[].name` / `assignments` keys / `idVariable` / connector action
 *     output keys of every ANCESTOR node
 *     (a node from which N is reachable, found by walking edges backwards). A
 *     node's OWN outputs and any DOWNSTREAM node's outputs are deliberately
 *     excluded — they don't exist yet when N runs. This is the property the
 *     picker's "a downstream output is not offered upstream" guarantee rests on.
 *   - Edges — an out-edge's guard is evaluated AFTER its source node ran, so
 *     an edge's scope is the scope at its source PLUS that source's own
 *     outputs ({@link resolveEdgeScope}, objectui#11085). The one rule for
 *     which own outputs count is {@link edgeSourceOutputRefs}.
 *   - Loop / map iterators — the `iteratorVariable` of an enclosing loop/map
 *     ancestor, surfaced as its own group.
 *   - Trigger record — on a record-triggered flow, the trigger object's fields.
 *     Referenced BARE on the start node's own entry condition (`status`,
 *     matching the engine's trigger-evaluation context where the changed
 *     record's fields are top-level) and as `record.<field>` on every
 *     downstream node (the convention the showcase flows use). The whole
 *     `record` is in scope at BOTH (objectui#11789): the engine's run seeding
 *     binds `record` beside the flattened fields before the start-condition
 *     gate runs, so `record.status` is as valid in an entry condition as the
 *     bare `status`. The object's field list is fetched lazily by the React
 *     layer (see useFlowScope); this module only resolves the object NAME and
 *     the correct token prefix.
 *
 * The graph-walk here is the unit-tested heart of the picker; async field-list
 * expansion and rendering live in the React layer so this module stays pure.
 * The one piece of wording it produces, a reference's muted `detail`, reads the
 * designer catalogue in the `locale` the caller passes (objectui#10748), the way
 * `flow-ref-check`'s messages do; an absent locale reads the en rows.
 */

import { t, tFormat } from '../i18n.js';

/** Which group a reference belongs to (drives the picker's section headers). */
export type ScopeGroupId =
  | 'variables' | 'outputs' | 'loop' | 'trigger'
  // objectstack-ai/objectstack#3447: approval `expression` approvers see a DIFFERENT root set than flow
  // conditions (current/trigger/vars — never `record`/bare fields). Their
  // picker groups carry their own ids so they can never leak into the regular
  // condition picker.
  | 'approval_current' | 'approval_trigger' | 'approval_vars'
  // objectui#10772: a `screen` node's `fields[].visibleWhen` binds the same
  // screen's declared fields plus `record` (`screenPredicateRoots`), never the
  // flow scope — its own id for the same reason.
  | 'screen_fields';

/**
 * One pickable reference. `token` is the BARE form (no braces); the picker
 * inserts it as-is into CEL `expression` fields and wraps it as `{token}` for
 * `text` / `textarea` template fields (ADR-0032 — the brace rule is handled for
 * the author).
 */
export interface ScopeRef {
  token: string;
  /** Primary display text (the token, or the bare field name). */
  label: string;
  /** Secondary, muted text — a type, an origin node label, etc. */
  detail?: string;
  group: ScopeGroupId;
}

/** The trigger object whose fields the UI layer should fetch and expand. */
export interface TriggerScope {
  objectName: string;
  /** Per-field token prefix: '' on the start node (bare), 'record.' downstream. */
  fieldPrefix: string;
  /** Also emit `previous.<field>` refs — the triggers whose run binds a pre-image (`PREVIOUS_TRIGGER_TYPES`). */
  includePrevious: boolean;
}

export interface FlowScope {
  /**
   * References resolvable WITHOUT a network fetch: flow variables, upstream
   * outputs, loop iterators, and the whole-record `record` / `previous` tokens.
   */
  refs: ScopeRef[];
  /** Present when a record trigger is in scope — the UI expands its fields. */
  trigger?: TriggerScope;
}

/**
 * The scope walker's read shape for a node it has NOT yet validated — every
 * member `unknown` on purpose, because this runs over raw stored metadata and
 * narrows each value at its use site.
 *
 * Named `ScopeFlowNode` rather than `FlowNodeLike` because spec 17.3.0 began
 * exporting a `FlowNodeLike` of its own (objectui#7122): a local declaration
 * under a live spec export's name reads as the spec's definition to the next
 * agent. This one is a genuine dialect, not a copy — the spec's members are
 * typed (`id?: string`), these are deliberately untyped, which is the whole
 * point of a pre-validation probe. Tripwire: `page-nav-misc-spec-parity.test.ts`.
 */
interface ScopeFlowNode {
  id?: unknown;
  type?: unknown;
  label?: unknown;
  config?: unknown;
  /** A `connector_action` node's spec-structured sibling block (connector + action). */
  connectorConfig?: unknown;
}
interface FlowEdgeLike {
  source?: unknown;
  target?: unknown;
  /** `fault` marks the failure route — see {@link edgeSourceOutputRefs}. */
  type?: unknown;
}

/** Trigger types that fire on a single record (so `record` is in scope). */
const RECORD_TRIGGER_TYPES = new Set([
  'record-after-create',
  'record-after-update',
  'record-after-write', // create OR update (objectstack-ai/objectstack#3427)
  'record-before-write',
  'record-before-update',
  'record-after-delete',
]);
/**
 * Trigger types whose run binds `previous` to a record (objectui#11789). The
 * engine's run seeding binds `previous` on every run, to the pre-image the
 * record-change trigger hands it or to `null` when there is none, so the
 * question per trigger is whether a pre-image exists:
 *
 *   - update (`record-after-update`, `record-before-update`) — the prior row;
 *   - create-or-update (`record-*-write`) — the prior row on the update leg and
 *     `null` on the create leg: `previous == null` is how authors branch on
 *     which happened;
 *   - delete (`record-after-delete`) — the deleted row: the data engine binds
 *     the pre-image before the delete runs, and it is what the trigger reads
 *     for `record` too;
 *   - create (`record-after-create`) — NOT here: there is no prior row, so
 *     `previous` is always `null`, every member read of it faults, and
 *     `previous == null` is constantly true. Flagging it is the useful verdict.
 */
const PREVIOUS_TRIGGER_TYPES = new Set([
  'record-after-update',
  'record-before-update',
  'record-after-write',
  'record-before-write',
  'record-after-delete',
]);

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The connector + action a `connector_action` node has COMMITTED, read off its
 * spec-structured `connectorConfig` block (where the connector and action
 * pickers write them). Either half missing → undefined.
 */
function committedConnectorAction(node: ScopeFlowNode): { connectorId: string; actionId: string } | undefined {
  if (str(node.type) !== 'connector_action') return undefined;
  const cc = asRecord(node.connectorConfig);
  const connectorId = str(cc.connectorId);
  const actionId = str(cc.actionId);
  return connectorId && actionId ? { connectorId, actionId } : undefined;
}

/**
 * Whether any top-level node of `draft` is a `connector_action` with a committed
 * connector + action — the only nodes whose output references need the runtime
 * connector registry (objectui#11028). The inspectors gate their registry read
 * on it, so a flow with no such node never fetches for scope.
 */
export function hasCommittedConnectorAction(draft: Record<string, unknown>): boolean {
  return asArray(draft.nodes).some((n) => !!committedConnectorAction(asRecord(n) as ScopeFlowNode));
}

/**
 * Find one action's `outputSchema` in a `GET /automation/connectors` payload
 * (already unwrapped to the connector array) — the output twin of
 * `connectorActionInputSchema`, with the same tolerance: an unknown connector,
 * an unknown action, or an action that declares no object schema is undefined.
 */
export function connectorActionOutputSchema(
  connectors: unknown,
  connectorName: string | undefined,
  actionKey: string | undefined,
): Record<string, unknown> | undefined {
  if (!Array.isArray(connectors) || !connectorName || !actionKey) return undefined;
  const connector = connectors.find((c) => isPlainObject(c) && c.name === connectorName) as Record<string, unknown> | undefined;
  if (!connector || !Array.isArray(connector.actions)) return undefined;
  const action = connector.actions.find((a) => isPlainObject(a) && a.key === actionKey) as Record<string, unknown> | undefined;
  const schema = action?.outputSchema;
  return isPlainObject(schema) ? schema : undefined;
}

/**
 * The top-level output keys a connector action's `outputSchema` DECLARES — the
 * keys of its top-level `properties` object (objectui#11028).
 *
 * The engine stores each top-level key of a `connector_action` node's `output`
 * as the variable `<nodeId>.<key>`, so these are exactly the references the
 * node writes. `outputSchema` is an open record nothing validates (JSON Schema
 * by convention), so anything else — no schema, a schema with no `properties`,
 * a `properties` that is not an object — yields NO keys. ⛔ Keys are never
 * guessed: a reference the designer offers must be one the action declared.
 */
export function connectorActionOutputKeys(outputSchema: unknown): string[] {
  if (!isPlainObject(outputSchema)) return [];
  const properties = outputSchema.properties;
  if (!isPlainObject(properties)) return [];
  return Object.keys(properties).filter((key) => key.length > 0);
}

/**
 * Ancestor node ids of `nodeId` — every node from which `nodeId` is reachable
 * by following edges forward (equivalently, a reverse breadth-first walk from
 * `nodeId`). Cycle-safe (a declared `back`-edge revise loop won't spin) and
 * never includes `nodeId` itself.
 */
export function flowAncestors(nodeId: string, edges: FlowEdgeLike[]): Set<string> {
  const rev = new Map<string, string[]>();
  for (const e of edges) {
    const s = str(e.source);
    const t = str(e.target);
    if (!s || !t) continue;
    const list = rev.get(t);
    if (list) list.push(s);
    else rev.set(t, [s]);
  }
  const seen = new Set<string>();
  const stack = [...(rev.get(nodeId) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === nodeId || seen.has(cur)) continue;
    seen.add(cur);
    for (const p of rev.get(cur) ?? []) stack.push(p);
  }
  return seen;
}

/**
 * The variable names a node INTRODUCES into scope for its successors — mirroring
 * what the simulator (flow-simulator.ts) and engine actually write:
 * `outputVariable` (single), an assignment node's `assignments` keys (map /
 * array / flat shapes), a screen's collected `fields[].name`, a screen
 * object-form's `idVariable`, and a loop/map `iteratorVariable` (flagged as a
 * `loop` ref). The start node is NOT handled here — its trigger record is
 * resolved separately.
 *
 * A `connector_action` node's references live in the runtime connector
 * registry, not on the node, so the caller passes that registry
 * (`GET /api/v1/automation/connectors`, unwrapped to the connector array) as
 * `connectors`. Without it the node offers no references.
 *
 * Deliberately NOT read: the script node's legacy `outputVariables` list. The
 * engine never binds those names (it binds the singular `outputVariable` on the
 * function path — framework#4278), so suggesting them in the data picker
 * offered successors variables that never exist at run time.
 */
export function nodeOutputRefs(node: ScopeFlowNode, connectors?: unknown): ScopeRef[] {
  const type = str(node.type);
  const cfg = asRecord(node.config);
  const nodeId = str(node.id) ?? '';
  const label = str(node.label);
  const detail = label && label !== nodeId ? label : nodeId || undefined;
  const out: ScopeRef[] = [];
  const add = (token: string | undefined, group: ScopeGroupId = 'outputs') => {
    if (token && !out.some((r) => r.token === token)) {
      out.push({ token, label: token, detail, group });
    }
  };

  // Loop / map iterator — its own group.
  if (type === 'loop' || type === 'map') add(str(cfg.iteratorVariable), 'loop');

  // Single output variable (create/get/http/subflow/map/end/script).
  add(str(cfg.outputVariable));

  // Screen object-form: the saved record's id is bound to a variable.
  add(str(cfg.idVariable));

  // Assignment node — the assigned variable names. Accepts the three authoring
  // shapes the simulator/engine accept: an array of `{variable|name|key}`, a
  // flat `{ var: value }` map, or (legacy) keys directly on config.
  if (type === 'assignment') {
    const raw = cfg.assignments;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const e = asRecord(item);
        add(str(e.variable) ?? str(e.name) ?? str(e.key));
      }
    } else if (raw && typeof raw === 'object') {
      for (const k of Object.keys(raw as Record<string, unknown>)) add(k);
    }
  }

  // Screen — collected input field names become variables for downstream nodes.
  if (type === 'screen' || type === 'user_task') {
    for (const f of asArray(cfg.fields)) add(str(asRecord(f).name));
  }

  // Approval (framework#3447): the resume envelope writes `<nodeId>.decision`,
  // and each author-declared decision output (`decisionOutputs` — bare key or
  // typed `{ key, … }`) lands as `<nodeId>.<key>` — the values a later
  // approval node's `expression` approver reads as `vars.<nodeId>.<key>`.
  if (type === 'approval' && nodeId) {
    add(`${nodeId}.decision`);
    for (const entry of asArray(cfg.decisionOutputs)) {
      const key = typeof entry === 'string' ? entry : str(asRecord(entry).key);
      if (key) add(`${nodeId}.${key}`);
    }
  }

  // Connector action (objectui#11028), modelled on the approval branch: the
  // engine writes each top-level key of the handler's result as
  // `<nodeId>.<key>`, and the action's served `outputSchema` declares those
  // keys. No committed connector + action, no registry, or no declared
  // top-level `properties` → no references.
  const committed = nodeId ? committedConnectorAction(node) : undefined;
  if (committed) {
    const schema = connectorActionOutputSchema(connectors, committed.connectorId, committed.actionId);
    for (const key of connectorActionOutputKeys(schema)) add(`${nodeId}.${key}`);
  }

  return out;
}

/** De-duplicate by token, keeping the first (group-priority) occurrence. */
function dedupeByToken(refs: ScopeRef[]): ScopeRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(r.token) ? false : (seen.add(r.token), true)));
}

/**
 * Resolve the in-scope reference set at `nodeId` (graph-aware). Pure: the
 * trigger object's fields are NOT expanded here (that needs an async fetch) —
 * the returned `trigger` carries the object name and per-field token prefix for
 * the UI layer to expand. Order: flow variables, upstream outputs, loop
 * iterators, then trigger refs, de-duplicated by token.
 *
 * `connectors` is the already-fetched runtime connector registry, handed to
 * {@link nodeOutputRefs} so an upstream `connector_action` node offers the
 * output keys its action declares; omitted, such a node offers none.
 */
export function resolveFlowScope(
  draft: Record<string, unknown>,
  nodeId: string | undefined,
  locale?: string,
  connectors?: unknown,
): FlowScope {
  const nodes = asArray(draft.nodes).map(asRecord) as ScopeFlowNode[];
  const edges = asArray(draft.edges) as FlowEdgeLike[];
  const refs: ScopeRef[] = [];

  // 1. Flow variables — always in scope (declared up-front).
  for (const v of asArray(draft.variables)) {
    const rec = asRecord(v);
    const name = str(rec.name);
    if (!name) continue;
    const type = str(rec.type);
    refs.push({
      token: name,
      label: name,
      detail: type ? tFormat('engine.flowScope.detail.variableTyped', locale, { type }) : t('engine.flowScope.detail.variable', locale),
      group: 'variables',
    });
  }

  if (!nodeId) return { refs: dedupeByToken(refs) };

  // 2. Upstream outputs + loop iterators — from ANCESTOR nodes only.
  const ancestors = flowAncestors(nodeId, edges);
  const startNode = nodes.find((n) => str(n.type) === 'start');
  const startId = str(startNode?.id);
  for (const node of nodes) {
    const id = str(node.id);
    if (!id || id === nodeId || !ancestors.has(id)) continue;
    if (id === startId) continue; // the start node contributes the trigger record, below
    for (const ref of nodeOutputRefs(node, connectors)) refs.push(ref);
  }

  // 3. Trigger record — on a record-triggered flow, when the start node is in
  //    scope: either we ARE the start node (editing its own entry condition) or
  //    the start node is an ancestor (it is the ancestor of everything reachable).
  if (startNode) {
    const cfg = asRecord(startNode.config);
    const triggerType = str(cfg.triggerType);
    const objectName = str(cfg.objectName);
    const isRecordTrigger = !!triggerType && RECORD_TRIGGER_TYPES.has(triggerType);
    const startInScope = startId === nodeId || (!!startId && ancestors.has(startId));
    if (isRecordTrigger && objectName && startInScope) {
      const onStart = startId === nodeId;
      const includePrevious = PREVIOUS_TRIGGER_TYPES.has(triggerType);
      // The whole record is a named ref at EVERY node, the start node included
      // (objectui#11789): the engine binds `record` beside the flattened fields
      // before it evaluates the entry condition. What differs on the start node
      // is only the per-field prefix below — bare there, `record.` downstream.
      refs.push({ token: 'record', label: 'record', detail: tFormat('engine.flowScope.detail.triggerRecord', locale, { object: objectName }), group: 'trigger' });
      if (includePrevious) {
        refs.push({ token: 'previous', label: 'previous', detail: t('engine.flowScope.detail.previousRecord', locale), group: 'trigger' });
      }
      return { refs: dedupeByToken(refs), trigger: { objectName, fieldPrefix: onStart ? '' : 'record.', includePrevious } };
    }
  }

  return { refs: dedupeByToken(refs) };
}

/**
 * The source node's OWN outputs that are in scope on one of its out-edges —
 * the single rule both the edge inspector and the Problems panel's edge scan
 * read (objectui#11085).
 *
 * The engine writes a node's outputs (its executor's `outputVariable` and the
 * `<nodeId>.<key>` write-back of its result) BEFORE `traverseNext` evaluates
 * its out-edge guards, so a guard can read what its own source just wrote.
 * Two out-edges get none:
 *   - a `fault` edge — the engine walks it only when the node FAILED, when no
 *     output was written back, and never evaluates its condition
 *     (`traverseNext` filters fault edges out);
 *   - an edge leaving the start node, which contributes the trigger record
 *     rather than outputs (as in {@link resolveFlowScope}).
 */
export function edgeSourceOutputRefs(
  draft: Record<string, unknown>,
  edge: FlowEdgeLike,
  connectors?: unknown,
): ScopeRef[] {
  const sourceId = str(edge.source);
  if (!sourceId || str(edge.type) === 'fault') return [];
  const source = asArray(draft.nodes).map(asRecord).find((n) => str(n.id) === sourceId) as ScopeFlowNode | undefined;
  if (!source || str(source.type) === 'start') return [];
  return nodeOutputRefs(source, connectors);
}

/**
 * Resolve the in-scope reference set on an EDGE's guard: everything in scope
 * at its source node ({@link resolveFlowScope}) plus the source's own outputs
 * ({@link edgeSourceOutputRefs}), de-duplicated by token. `trigger` is the
 * source node's.
 */
export function resolveEdgeScope(
  draft: Record<string, unknown>,
  edge: FlowEdgeLike,
  locale?: string,
  connectors?: unknown,
): FlowScope {
  const atSource = resolveFlowScope(draft, str(edge.source), locale, connectors);
  const refs = dedupeByToken([...atSource.refs, ...edgeSourceOutputRefs(draft, edge, connectors)]);
  return atSource.trigger ? { refs, trigger: atSource.trigger } : { refs };
}

/**
 * Expand a trigger object's fields into per-field refs — `record.<field>`
 * downstream, bare `<field>` on the start node — given an already-fetched field
 * list. Split out from {@link resolveFlowScope} so it is unit-testable without a
 * metadata client.
 */
export function triggerFieldRefs(
  trigger: TriggerScope,
  fields: ReadonlyArray<{ name: string; label?: string; type?: string }>,
  locale?: string,
): ScopeRef[] {
  const out: ScopeRef[] = [];
  for (const f of fields) {
    if (!f?.name) continue;
    const token = `${trigger.fieldPrefix}${f.name}`;
    const detail = f.label && f.label !== f.name ? f.label : f.type;
    out.push({ token, label: token, detail, group: 'trigger' });
    if (trigger.includePrevious) {
      out.push({
        token: `previous.${f.name}`,
        label: `previous.${f.name}`,
        detail: detail ? tFormat('engine.flowScope.detail.priorOf', locale, { detail }) : t('engine.flowScope.detail.priorValue', locale),
        group: 'trigger',
      });
    }
  }
  return out;
}
