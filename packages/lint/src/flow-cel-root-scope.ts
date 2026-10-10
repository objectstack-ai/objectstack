// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module flow-cel-root-scope
 *
 * **The build door's judge of the ROOTS a flow CEL expression reads.** A flow
 * expression whose root identifier the run does not bind fails that run with
 * `Unknown variable: X` — measured on the flow scope the engine builds
 * (`AutomationEngine.celScope` over `seedRunVariables`' map): `user.id == "u1"`,
 * `ctx.user.id == "u1"`, `os.user.id == "u1"` and `foo.bar == 1` each fault, while
 * `objectstack validate` answered nothing for any of them. The three user
 * spellings are the trap: formulas, row-level security and the client bind the
 * run's user under them (`buildScope` in `@objectstack/formula`), and flow CEL
 * binds it as `current_user` only, so an author who writes the alias by habit
 * ships a flow that faults. This module refuses such a root at build, naming
 * `current_user` for the user spellings and the in-scope names for any other.
 *
 * ## One judge, every flow CEL site
 *
 * The caller (`validateStackExpressions`) hands it each flow CEL source it
 * already visits: a node's `config.condition` (the start node's is the trigger
 * gate), an edge's `condition`, a `decision` branch's `expression`, a `screen`
 * field's `visibleWhen`, and the CEL value envelopes of an `assignment` and of a
 * `create_record` / `update_record` `fields` map. All of them evaluate in the
 * one scope `celScope` builds, so one bound set per flow judges them all.
 *
 * ## The bound set — the flow's own static bindings
 *
 *  - **the engine's roots**: `previous` (`seedRunVariables` binds it on every
 *    run, `null` when the run was handed none), `vars` and `current_user`
 *    (`celScope` binds both after the spread). A `$`-named variable has no CEL
 *    spelling at all — `$runId == "x"` does not parse — so the `$` names never
 *    reach this judge: they stay the text-slot rule's
 *    (`flow-text-slot-template.ts`), and this module keeps no list of them;
 *  - **`record` — the record the run was handed (#22677)**. `celScope` binds
 *    no `record` of its own (#22642): `seedRunVariables` binds `context.record`
 *    as `record` when the run's entrance hands it one, and nothing else does
 *    but a flow's own `record` variable (the next bullet). So `record` is bound
 *    here only when {@link flowCelEntrances} reads an entrance that hands this
 *    flow a record (the rule for records below), or the flow binds the name
 *    itself. An autolaunched flow with no visible entrance gets none, and its
 *    `record.X` is refused: the run faults `Unknown variable: record`;
 *  - **every name the flow binds**: {@link collectFlowVariableNames} — declared
 *    variables, `outputVariable` / `errorVariable` / `iteratorVariable` /
 *    `indexVariable`, `assignment` targets, node ids — plus the two bindings that
 *    reader does not collect: a `screen` field's `name` (a resume lands the
 *    collected values under their plain names) and a `loop`'s default iterator
 *    `item` when the node names none;
 *  - **record fields**: the trigger record's fields are flattened to top-level
 *    names. Every field of EVERY object the stack declares counts, with the
 *    registry-injected columns — not only the trigger object's — because the run
 *    flattens whichever record its entrance hands it (the entrances below). A
 *    field the stack declares anywhere is therefore a root this door cannot
 *    prove unbound. An object-less action that launches the flow hands an empty
 *    record carrying at most the row `id` it was given, so `id` is bound there.
 *
 * ## When the door cannot prove a root unbound, it stands down
 *
 * A false refusal of a working flow is worse than the trap, so the whole flow is
 * left unjudged when its run can bind a name the reader cannot see:
 *
 *  - a node whose type is not one of {@link CLOSED_BINDER_NODE_TYPES}. The node
 *    type namespace is open (ADR-0018), and the executors that hand out the LIVE
 *    variable map are open by measurement: `script` (a registered function gets
 *    `FlowFunctionContext.variables`) and `connector_action`
 *    (`ConnectorActionContext.variables`) may write any name; `wait`, `subflow`
 *    and `map` declare `resumeAuthority: 'any'`, and a resume folds the caller's
 *    `variables` bag in under its plain names (`applyResumeSignal`);
 *  - a `screen` with no input contract — an `object-form` screen, or one that
 *    declares no fields — because `refuseInvalidScreenInput` checks a resume bag
 *    only against a declared field list, so a contract-less screen folds any bag;
 *  - an ENTRANCE that hands the flow a record whose keys are not in hand
 *    ({@link flowCelEntrances}, the rule below).
 *
 * ## The rule for records: every entrance the stack declares is read
 *
 * The run flattens whichever record its entrance hands it (`seedRunVariables`
 * reads `context.record` and nothing else), so the record half of the bound set
 * holds only while every entrance that can hand this flow a record names an
 * object the stack declares. {@link flowCelEntrances} reads each entrance from
 * the stack's own declarations and opens the flow when one does not:
 *
 *  - **a record trigger** — the start node's `config.objectName` (the trigger
 *    object a record-change run's row belongs to) names an undeclared object;
 *  - **a time-relative sweep** — the start node's `config.timeRelative.object`
 *    (`TimeRelativeTriggerSchema`; its own key, independent of `objectName`, and
 *    the object whose rows the sweep hands each run) is undeclared;
 *  - **the inbound hook** — the flow's trigger kind is `api`
 *    (`resolveFlowTriggerKind`: `type: 'api'` or `config.triggerType: 'api'`), so
 *    the hook hands the request body in as the record (`trigger-api`), keys and
 *    all;
 *  - **an action** — an `ActionSchema` entry with `type: 'flow'` and
 *    `target: <this flow>` in `actions[]` (its `objectName`) or in
 *    `objects[].actions[]` (its `objectName`, else the owning object) names an
 *    undeclared object: `dispatchFlowAction` hands the action's own record to
 *    whatever flow it targets;
 *  - **a `map` node** — `MapConfigSchema`'s `flowName` names this flow and its
 *    `itemObject` is undeclared or absent: each id-bearing item becomes the
 *    child's record, and with no `itemObject` the items' object is not in hand;
 *  - **a parent that is itself open** — a `subflow` node (`SubflowConfigSchema`'s
 *    `flowName`) or a `map` node names this flow inside a flow that is open: the
 *    child spreads its parent's context, record included. Read to a fixpoint.
 *
 * The API run door hands no record (measured): both REST trigger routes and the
 * declarative endpoint build their context with `buildAutomationContext`, which
 * carries `params` and `recordId` but no `record`, and the engine never loads a
 * record from `object` + `recordId`. A schedule run hands none either.
 *
 * ## Two questions per entrance: does it open the flow, does it hand a record
 *
 * "Opens" (above) asks whether an entrance can hand a record whose keys are not
 * in hand. "Hands a record" asks whether it hands one at all, and answers whether
 * `record` is bound (#22677). A flow can be handed a record and still judged —
 * its object is declared, so `record` is bound and its fields resolve. The
 * entrances that hand a record, measured on the engine:
 *
 *  - **a record trigger** — trigger kind `record_change`
 *    (`resolveFlowTriggerKind`: start `config.triggerType` is a `record-*`
 *    string), the row; a start `config.objectName` alone hands none, because with
 *    no `record-*` trigger nothing binds the flow to a write (`deriveTriggerBinding`);
 *  - **a time-relative sweep** — trigger kind `time_relative`, each swept row;
 *  - **the inbound hook** — trigger kind `api`, the request body;
 *  - **an action** — every `type: 'flow'` action that targets it, whatever its
 *    object: `dispatchFlowAction` hands the row it loaded, or an empty record
 *    carrying at most the `id` it was given, and an empty record is a record;
 *  - **a `map` node** with a `config.itemObject` — each id-bearing item becomes
 *    the child's record;
 *  - **a parent that is itself handed one** — a `subflow` or `map` node in a flow
 *    an entrance hands a record: the child spreads its parent's context, and so
 *    its `context.record`. A parent's own `record` VARIABLE is not handed on —
 *    the child gets the parent's context, not its variables. Read to a fixpoint.
 *
 * ## The runtime publish gate stands down (#22636 is the carrier)
 *
 * The same pass runs at the runtime publish gate on a flow write, and there the
 * per-write snapshot carries the written flow alone beside `objects` /
 * `permissions` / `books` / `datasets` (`buildRuntimeWriteSnapshotSet`): no
 * action and no other flow, so no entrance is visible and a parent's `subflow` or
 * `map` node could hand this flow any record. A false 422 on the only door a
 * Studio tenant has is worse than the gap, so this one judgment stands down there
 * ({@link perWriteSnapshotEntrance}); every other expression verdict at that door
 * is unchanged, and `objectstack validate` judges under the rule above. #22636
 * widens that snapshot to carry flows and actions; when it lands, this
 * stand-down goes.
 */

import { firstUndeclaredReference, parseCelToAst, SCOPE_ROOTS } from '@objectstack/formula';
import {
  APPROVAL_NODE_TYPE,
  APPROVAL_REVISE_NODE_TYPE,
  collectFlowGraphs,
  LOOP_NODE_TYPE,
  PARALLEL_NODE_TYPE,
  resolveFlowTriggerKind,
  TRY_CATCH_NODE_TYPE,
} from '@objectstack/spec/automation';
import type { FlowEdgeParsed, FlowNodeParsed } from '@objectstack/spec/automation';

import { collectFlowVariableNames, type FlowGraphLike, type FlowVariableHost } from './flow-variable-scope.js';
import { nearestName, recordsOf } from './object-graph.js';

type AnyRec = Record<string, unknown>;

/**
 * The roots the flow engine binds on every run, whatever the flow declares:
 * `previous` (`seedRunVariables`, `null` when the run was handed none), `vars`
 * and `current_user` (bound by `celScope` after the variables are spread).
 * Not `record`: it is the record the run was handed, bound only where an
 * entrance hands one or the flow binds the name (module note, #22677). Not the
 * `$` names — those have no CEL spelling (module note).
 */
const ENGINE_BOUND_ROOTS: readonly string[] = ['previous', 'vars', 'current_user'];

/**
 * The node types whose variable writes this reader models completely — every
 * name each one can bind is a key of its own `config` that
 * {@link collectFlowVariableNames} or {@link flowCelRootScope} reads, or its node
 * id. Measured from the executors:
 *
 * | type | binds |
 * |---|---|
 * | `start`, `end`, `decision`, `http`, `notify`, `delete_record` | nothing but its node id's outputs |
 * | `assignment` | its targets |
 * | `create_record`, `update_record`, `get_record` | `outputVariable` |
 * | `loop` | `iteratorVariable` (default `item`), `indexVariable` |
 * | `parallel` | nothing; its branches are graphs of their own |
 * | `try_catch` | `errorVariable` (default `$error`) |
 * | `screen` with an input contract | its fields' names, `outputVariable` |
 * | `approval`, `approval_revise` | nothing; their service resumes with outputs only (`resumeAuthority: 'service'`) |
 *
 * Every other type — a plugin's, and `script`, `connector_action`, `wait`,
 * `subflow`, `map` (module note) — makes the bound set unprovable.
 */
const CLOSED_BINDER_NODE_TYPES: ReadonlySet<string> = new Set([
  'start',
  'end',
  'decision',
  'assignment',
  'create_record',
  'update_record',
  'delete_record',
  'get_record',
  'http',
  'notify',
  'screen',
  LOOP_NODE_TYPE,
  PARALLEL_NODE_TYPE,
  TRY_CATCH_NODE_TYPE,
  APPROVAL_NODE_TYPE,
  APPROVAL_REVISE_NODE_TYPE,
]);

/** The run-user spellings formulas, RLS and the client accept and flow CEL does not bind. */
const RUN_USER_ALIAS_ROOTS: ReadonlySet<string> = new Set(['user', 'ctx', 'os']);

/** What the door knows about one flow's CEL scope. */
export interface FlowCelRootScope {
  /**
   * Every root the run can bind, in the order a did-you-mean prefers them: the
   * trigger object's fields first (a flattened condition's commonest typo), then
   * the flow's own bindings, the engine's roots, and the other objects' fields.
   * Meaningful only when {@link provable}.
   */
  readonly bound: ReadonlySet<string>;
  /**
   * `false` ⇒ the run can bind a name the reader cannot see, and no root of this
   * flow is judged. {@link openedBy} says why.
   */
  readonly provable: boolean;
  /** The first reason the bound set is not provable, for tests and diagnostics. */
  readonly openedBy?: string;
}

/** The flow-level slice the scope reads. */
export interface FlowCelRootHost extends FlowVariableHost {
  readonly nodes?: unknown;
}

/** One root a flow CEL source reads that the flow does not bind. */
export interface UnboundFlowCelRoot {
  /** The root identifier (`user`). */
  readonly root: string;
  /** The member names read directly off it (`user.id` → `id`), in source order. */
  readonly members: readonly string[];
}

/**
 * What the flow's entrances contribute to its scope ({@link flowCelEntrances}):
 * the reason one of them hands it a record whose keys are not in hand, and any
 * name an entrance binds that no object field covers.
 */
export interface FlowCelEntrance {
  /** Set ⇒ the flow is not judged; names the entrance. */
  readonly openedBy?: string;
  /**
   * Names an entrance binds beyond the objects' fields: `record` when an
   * entrance hands the flow a record, and an object-less action's `id`.
   */
  readonly bound?: readonly string[];
}

/**
 * The bound set of one flow, or the reason it cannot be proved.
 *
 * @param graphs every graph of the flow (`collectFlowGraphs`), so a region's
 *   nodes count — one variable map serves the whole run.
 * @param triggerObject the start node's `objectName`, when it names one — its
 *   fields lead the did-you-mean order.
 * @param fieldIndex object name → its field names, injected columns included.
 * @param entrance what the flow's entrances contribute: from
 *   {@link flowCelEntrances} at the build door, {@link perWriteSnapshotEntrance}
 *   at the runtime publish gate. Its reason takes precedence over a node's.
 */
export function flowCelRootScope(
  flow: FlowCelRootHost,
  graphs: readonly FlowGraphLike[],
  triggerObject: string | undefined,
  fieldIndex: ReadonlyMap<string, readonly string[]>,
  entrance: FlowCelEntrance = {},
): FlowCelRootScope {
  const bound = new Set<string>(triggerObject !== undefined ? fieldIndex.get(triggerObject) ?? [] : []);
  for (const name of collectFlowVariableNames(flow, graphs)) bound.add(name);
  for (const name of ENGINE_BOUND_ROOTS) bound.add(name);
  for (const name of entrance.bound ?? []) bound.add(name);
  let openedBy: string | undefined = entrance.openedBy;
  const open = (reason: string): void => { openedBy ??= reason; };

  for (const graph of graphs) {
    for (const node of recordsOf(graph.nodes)) {
      const type = typeof node.type === 'string' ? node.type : '';
      const id = typeof node.id === 'string' ? node.id : '?';
      if (!CLOSED_BINDER_NODE_TYPES.has(type)) {
        open(`node '${id}' (${type || 'no type'}) can bind names the reader cannot see`);
        continue;
      }
      const config = (node.config && typeof node.config === 'object' && !Array.isArray(node.config)
        ? node.config
        : {}) as AnyRec;
      if (type === LOOP_NODE_TYPE && !(typeof config.iteratorVariable === 'string' && config.iteratorVariable)) {
        // `LoopConfigSchema` defaults the iterator to `item`; a config read before
        // that parse carries no key, and the run still binds the default.
        bound.add('item');
      }
      if (type === 'screen') {
        const fields = Array.isArray(config.fields) ? recordsOf(config.fields) : [];
        if (config.kind === 'object-form' || fields.length === 0) {
          open(`screen '${id}' declares no input contract, so a resume can bind any name`);
          continue;
        }
        for (const field of fields) {
          if (typeof field.name === 'string' && field.name) bound.add(field.name);
        }
      }
    }
  }

  for (const names of fieldIndex.values()) for (const name of names) bound.add(name);

  return openedBy === undefined ? { bound, provable: true } : { bound, provable: false, openedBy };
}

/** The stack slice {@link flowCelEntrances} reads. */
export interface FlowCelEntranceHost {
  readonly flows?: unknown;
  readonly actions?: unknown;
  readonly objects?: unknown;
}

function configOf(node: AnyRec): AnyRec {
  return node.config && typeof node.config === 'object' && !Array.isArray(node.config) ? (node.config as AnyRec) : {};
}

function nameOf(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * Every flow of the stack whose entrances open it, or bind a name beyond the
 * objects' fields — read from the stack's own declarations (the module's rule
 * for records). A flow an entrance hands a record gets `record` in
 * {@link FlowCelEntrance.bound}. A flow absent from the map is judged as its own
 * text reads, with no `record` unless it binds one itself.
 *
 * Built once per stack, because an entrance lives OUTSIDE the flow it feeds (an
 * action, another flow's `subflow` / `map` node) and a parent's openness, and
 * the record it was handed, pass to its children: the parent edges are read to
 * a fixpoint. A child named by a node but not declared in this stack is another
 * package's flow and is not judged here.
 *
 * @param fieldIndex object name → field names; an object is "declared" when it
 *   is a key here, the same universe the bound set reads.
 */
export function flowCelEntrances(
  stack: FlowCelEntranceHost,
  fieldIndex: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, FlowCelEntrance> {
  const flows = recordsOf(stack.flows);
  const flowNames = new Set(flows.map((flow) => nameOf(flow.name)).filter((name): name is string => !!name));
  const openedBy = new Map<string, string>();
  const bound = new Map<string, string[]>();
  // The flows an entrance hands a record — any object's — so `record` is bound.
  const handed = new Set<string>();
  const open = (flow: string, reason: string): void => {
    if (flowNames.has(flow) && !openedBy.has(flow)) openedBy.set(flow, reason);
  };
  const hand = (flow: string): void => {
    if (flowNames.has(flow)) handed.add(flow);
  };
  const undeclared = (object: string): boolean => !fieldIndex.has(object);

  // The flow's own trigger: a record trigger, a time-relative sweep, the inbound hook.
  for (const flow of flows) {
    const name = nameOf(flow.name);
    if (!name) continue;
    const kind = resolveFlowTriggerKind(flow);
    if (kind === 'record_change' || kind === 'time_relative' || kind === 'api') hand(name);
    const start = recordsOf(flow.nodes).find((node) => node.type === 'start');
    const config = start ? configOf(start) : {};
    const triggerObject = nameOf(config.objectName);
    if (triggerObject && undeclared(triggerObject)) {
      open(name, `its trigger object '${triggerObject}' (start config.objectName) is not declared in this stack, so the record's keys are not in hand`);
    }
    const sweep = config.timeRelative && typeof config.timeRelative === 'object' ? (config.timeRelative as AnyRec) : undefined;
    const sweepObject = sweep ? nameOf(sweep.object) : undefined;
    if (sweepObject && undeclared(sweepObject)) {
      open(name, `its time-relative sweep's object '${sweepObject}' (start config.timeRelative.object) is not declared in this stack, so the record's keys are not in hand`);
    }
    if (kind === 'api') {
      open(name, 'its trigger kind is api, so the inbound hook hands the request body in as the record, whatever its keys');
    }
  }

  // Actions that launch a flow: `actions[]`, and each object's own `actions[]`.
  const launches: Array<{ action: AnyRec; object: string | undefined }> = [];
  for (const action of recordsOf(stack.actions)) launches.push({ action, object: nameOf(action.objectName) });
  for (const object of recordsOf(stack.objects)) {
    for (const action of recordsOf(object.actions)) {
      launches.push({ action, object: nameOf(action.objectName) ?? nameOf(object.name) });
    }
  }
  for (const { action, object } of launches) {
    const target = action.type === 'flow' ? nameOf(action.target) : undefined;
    if (!target || !flowNames.has(target)) continue;
    hand(target);
    if (object === undefined) {
      // Object-less: the action hands an empty record, carrying at most the row id it was given.
      bound.set(target, [...(bound.get(target) ?? []), 'id']);
    } else if (undeclared(object)) {
      open(target, `action '${nameOf(action.name) ?? '?'}' launches it on '${object}' (the action's objectName), which this stack does not declare`);
    }
  }

  // Parent edges: a `subflow` or `map` node naming a flow of this stack.
  const edges: Array<{ parent: string; child: string; kind: 'subflow' | 'map'; node: string }> = [];
  for (const flow of flows) {
    const parent = nameOf(flow.name);
    if (!parent) continue;
    const graphs = collectFlowGraphs({
      ...flow,
      nodes: recordsOf(flow.nodes) as unknown as FlowNodeParsed[],
      edges: recordsOf(flow.edges) as unknown as FlowEdgeParsed[],
    });
    for (const graph of graphs) {
      for (const node of recordsOf(graph.nodes)) {
        if (node.type !== 'subflow' && node.type !== 'map') continue;
        const config = configOf(node);
        const child = nameOf(config.flowName);
        if (!child || !flowNames.has(child)) continue;
        const nodeId = nameOf(node.id) ?? '?';
        edges.push({ parent, child, kind: node.type, node: nodeId });
        if (node.type === 'map') {
          const itemObject = nameOf(config.itemObject);
          if (itemObject) hand(child);
          if (!itemObject) {
            open(child, `map node '${nodeId}' in flow '${parent}' feeds it items and declares no config.itemObject, so the items' object is not in hand`);
          } else if (undeclared(itemObject)) {
            open(child, `map node '${nodeId}' in flow '${parent}' feeds it items of '${itemObject}' (config.itemObject), which this stack does not declare`);
          }
        }
      }
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const edge of edges) {
      if (handed.has(edge.parent) && !handed.has(edge.child)) {
        handed.add(edge.child);
        changed = true;
      }
      if (!openedBy.has(edge.parent) || openedBy.has(edge.child)) continue;
      open(edge.child, `${edge.kind} node '${edge.node}' in flow '${edge.parent}' hands it that flow's record, and '${edge.parent}' is itself open`);
      changed = true;
    }
  }

  const out = new Map<string, FlowCelEntrance>();
  for (const name of flowNames) {
    const reason = openedBy.get(name);
    const names = [...(handed.has(name) ? ['record'] : []), ...(bound.get(name) ?? [])];
    if (reason === undefined && names.length === 0) continue;
    out.set(name, { ...(reason !== undefined ? { openedBy: reason } : {}), ...(names.length > 0 ? { bound: names } : {}) });
  }
  return out;
}

/**
 * The runtime publish gate's entrance: none visible. Its per-write snapshot
 * carries the written flow alone (module note), so this one judgment stands down
 * there until #22636 widens the snapshot.
 */
export function perWriteSnapshotEntrance(): FlowCelEntrance {
  return {
    openedBy:
      'the runtime publish gate judges a flow write against a per-write snapshot that carries no action and no '
      + 'other flow, so no entrance that can hand this flow a record is visible',
  };
}

/** cel-js's comprehension macros: the receiver calls that bind their first argument in the rest. */
const COMPREHENSION_MACROS: ReadonlySet<string> = new Set(['all', 'exists', 'exists_one', 'map', 'filter']);

interface CelNode {
  readonly op: string;
  readonly args: unknown;
}

function isCelNode(value: unknown): value is CelNode {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as AnyRec).op === 'string';
}

function boundIdentifier(value: unknown): string | undefined {
  return isCelNode(value) && value.op === 'id' && typeof value.args === 'string' ? value.args : undefined;
}

/**
 * The FREE root identifiers of a parsed CEL source, with the members read off
 * each. A name a comprehension macro (`all`, `exists`, `exists_one`, `map`,
 * `filter`) or `cel.bind` binds is free only outside the part it is bound in —
 * the same scoping cel-js applies (`lib/macros.js`).
 */
function freeRoots(ast: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const note = (name: string, member: string | undefined): void => {
    const members = out.get(name) ?? [];
    if (member !== undefined && !members.includes(member)) members.push(member);
    out.set(name, members);
  };
  const walk = (node: unknown, scoped: ReadonlySet<string>, member?: string): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, scoped);
      return;
    }
    if (!isCelNode(node)) return;
    const args = node.args;
    if (node.op === 'id') {
      if (typeof args === 'string' && !scoped.has(args)) note(args, member);
      return;
    }
    if ((node.op === '.' || node.op === '.?') && Array.isArray(args)) {
      walk(args[0], scoped, typeof args[1] === 'string' ? args[1] : undefined);
      return;
    }
    if (node.op === 'rcall' && Array.isArray(args)) {
      const [name, receiver, list] = args as [unknown, unknown, unknown];
      const variable = Array.isArray(list) ? boundIdentifier(list[0]) : undefined;
      if (typeof name === 'string' && COMPREHENSION_MACROS.has(name) && Array.isArray(list) && list.length >= 2 && variable) {
        walk(receiver, scoped);
        walk(list.slice(1), new Set([...scoped, variable]));
        return;
      }
      if (name === 'bind' && boundIdentifier(receiver) === 'cel' && Array.isArray(list) && list.length === 3 && variable) {
        walk(list[1], scoped);
        walk(list[2], new Set([...scoped, variable]));
        return;
      }
      walk(receiver, scoped);
      walk(list, scoped);
      return;
    }
    if (node.op === 'value') return;
    walk(args, scoped);
  };
  walk(ast, new Set());
  return out;
}

/**
 * Whether `name`, read as a bare identifier, is a VARIABLE the run must bind —
 * as opposed to a name CEL declares itself (a type such as `int`, the `cel`
 * namespace). Answered by the strict checker, which knows every such name; a
 * platform scope root (`user`, `ctx`, `os`, `data`, …) is declared there as a
 * convenience for other surfaces, and is a variable here.
 */
function isVariableReference(name: string): boolean {
  if ((SCOPE_ROOTS as readonly string[]).includes(name)) return true;
  return firstUndeclaredReference(name) === name;
}

/**
 * The roots `source` reads that `scope` does not bind, in source order — empty
 * when the scope is not provable, or when the source does not parse (the syntax
 * check owns that verdict: one broken expression, one finding).
 */
export function unboundFlowCelRoots(source: string, scope: FlowCelRootScope): UnboundFlowCelRoot[] {
  if (!scope.provable) return [];
  const ast = parseCelToAst(source);
  if (!ast) return [];
  const out: UnboundFlowCelRoot[] = [];
  for (const [root, members] of freeRoots(ast)) {
    if (scope.bound.has(root) || !isVariableReference(root)) continue;
    out.push({ root, members });
  }
  return out;
}

/**
 * The refusal for one unbound root.
 *
 * A run-user spelling (`user`, `ctx.user`, `os.user`) is told to write
 * `current_user`; `record` with no entrance that hands the flow one is told to
 * read the variable by its name or through `vars` (the remedy #22642 names), or
 * to give the flow its entrance; any other root is named with what the flow
 * could have bound it, and the nearest in-scope name when there is one.
 */
export function unboundFlowCelRootMessage(unbound: UnboundFlowCelRoot, scope: FlowCelRootScope): string {
  const { root, members } = unbound;
  const userSpelling = root === 'user' ? 'user' : RUN_USER_ALIAS_ROOTS.has(root) && members.includes('user') ? `${root}.user` : undefined;
  if (userSpelling !== undefined) {
    return (
      `\`${userSpelling}\` is not bound in a flow expression, so the run fails with \`Unknown variable: ${root}\`: ` +
      'a flow binds the run\'s user as `current_user` only — the `user`, `ctx.user` and `os.user` spellings that ' +
      'formulas, row-level security and the client accept are not bound here. ' +
      `Write \`current_user\` in its place (\`${userSpelling}.id\` → \`current_user.id\`); for a flow that can run ` +
      'without a user, guard it: `current_user != null ? current_user.id : null`.'
    );
  }
  if (root === 'record') {
    const member = members[0] ?? 'assignee';
    return (
      '`record` is not bound in this flow\'s expression scope, so the run fails with `Unknown variable: record`: ' +
      'a flow\'s `record` is the record its run was handed, and no entrance in this stack hands this flow one — no ' +
      'record trigger (start `config.triggerType: \'record-…\'`), time-relative sweep, inbound hook, `type: \'flow\'` ' +
      'action, `map` node with a `config.itemObject`, or `subflow` / `map` parent that is handed a record — and the ' +
      'flow binds no variable named `record`. ' +
      `Read a variable by its name (\`record.${member}\` → \`${member}\`) or through \`vars\` (\`vars.${member}\`), ` +
      'or give the flow the entrance that hands it its record.'
    );
  }
  const near = nearestName(root, scope.bound);
  return (
    `\`${root}\` is not bound in this flow's expression scope, so the run fails with \`Unknown variable: ${root}\`: ` +
    'no variable, `outputVariable`, iterator, index or error variable, `assignment` target, node id or screen field ' +
    `of this flow is named \`${root}\`, no object in the stack declares a field \`${root}\`, and the engine binds ` +
    'only `previous`, `vars` and `current_user` on every run, and `record` when an entrance hands the run one. ' +
    `Declare \`${root}\` as a flow variable or bind it with a node, or correct the name` +
    (near ? ` — did you mean \`${near}\`?` : '.')
  );
}
