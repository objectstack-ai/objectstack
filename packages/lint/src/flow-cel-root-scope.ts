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
 *  - **the engine's roots**: `record` and `previous` (`seedRunVariables` binds
 *    `previous` on every run, `null` on a create; `celScope` binds `record` to
 *    the trigger record, or to the variables themselves when there is none),
 *    `vars` and `current_user` (`celScope` binds both after the spread). A
 *    `$`-named variable has no CEL spelling at all — `$runId == "x"` does not
 *    parse — so the `$` names never reach this judge: they stay the text-slot
 *    rule's (`flow-text-slot-template.ts`), and this module keeps no list of them;
 *  - **every name the flow binds**: {@link collectFlowVariableNames} — declared
 *    variables, `outputVariable` / `errorVariable` / `iteratorVariable` /
 *    `indexVariable`, `assignment` targets, node ids — plus the two bindings that
 *    reader does not collect: a `screen` field's `name` (a resume lands the
 *    collected values under their plain names) and a `loop`'s default iterator
 *    `item` when the node names none;
 *  - **record fields**: the trigger record's fields are flattened to top-level
 *    names. Every field of EVERY object the stack declares counts, with the
 *    registry-injected columns — not only the trigger object's — because the run
 *    flattens whichever record its entrance hands it: a flow action passes the
 *    action's own record to any flow it starts, a `subflow` child inherits its
 *    parent's record, and a `map` child gets each record item. A field the stack
 *    declares anywhere is therefore a root this door cannot prove unbound.
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
 *  - a trigger object the stack does not declare (a platform object, another
 *    package's): its row's keys are not in hand.
 *
 * ⚠️ The boundary that remains: a record of an object this stack does not
 * declare, handed in by a flow action, a parent `subflow` or a `map` item, can
 * carry a key the reader has never seen. Measured over the example apps and
 * hotcrm, no flow reads a bare root that is not its own binding, an engine root
 * or a field of its trigger object.
 */

import { firstUndeclaredReference, parseCelToAst, SCOPE_ROOTS } from '@objectstack/formula';
import {
  APPROVAL_NODE_TYPE,
  APPROVAL_REVISE_NODE_TYPE,
  LOOP_NODE_TYPE,
  PARALLEL_NODE_TYPE,
  TRY_CATCH_NODE_TYPE,
} from '@objectstack/spec/automation';

import { collectFlowVariableNames, type FlowGraphLike, type FlowVariableHost } from './flow-variable-scope.js';
import { nearestName, recordsOf } from './object-graph.js';

type AnyRec = Record<string, unknown>;

/**
 * The roots the flow engine binds on every run, whatever the flow declares:
 * `record` and `previous` (`seedRunVariables`, and `celScope`'s `record` arm),
 * `vars` and `current_user` (bound by `celScope` after the variables are spread).
 * Not the `$` names — those have no CEL spelling (module note).
 */
const ENGINE_BOUND_ROOTS: readonly string[] = ['record', 'previous', 'vars', 'current_user'];

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
 * The bound set of one flow, or the reason it cannot be proved.
 *
 * @param graphs every graph of the flow (`collectFlowGraphs`), so a region's
 *   nodes count — one variable map serves the whole run.
 * @param triggerObject the start node's `objectName`, when it names one.
 * @param fieldIndex object name → its field names, injected columns included.
 */
export function flowCelRootScope(
  flow: FlowCelRootHost,
  graphs: readonly FlowGraphLike[],
  triggerObject: string | undefined,
  fieldIndex: ReadonlyMap<string, readonly string[]>,
): FlowCelRootScope {
  const bound = new Set<string>(triggerObject !== undefined ? fieldIndex.get(triggerObject) ?? [] : []);
  for (const name of collectFlowVariableNames(flow, graphs)) bound.add(name);
  for (const name of ENGINE_BOUND_ROOTS) bound.add(name);
  let openedBy: string | undefined;
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

  if (triggerObject !== undefined && !fieldIndex.has(triggerObject)) {
    open(`trigger object '${triggerObject}' is not declared in this stack, so its fields are not in hand`);
  }
  for (const names of fieldIndex.values()) for (const name of names) bound.add(name);

  return openedBy === undefined ? { bound, provable: true } : { bound, provable: false, openedBy };
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
 * `current_user`; any other root is named with what the flow could have bound
 * it, and the nearest in-scope name when there is one.
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
  const near = nearestName(root, scope.bound);
  return (
    `\`${root}\` is not bound in this flow's expression scope, so the run fails with \`Unknown variable: ${root}\`: ` +
    'no variable, `outputVariable`, iterator, index or error variable, `assignment` target, node id or screen field ' +
    `of this flow is named \`${root}\`, no object in the stack declares a field \`${root}\`, and the engine binds ` +
    'only `record`, `previous`, `vars` and `current_user`. ' +
    `Declare \`${root}\` as a flow variable or bind it with a node, or correct the name` +
    (near ? ` — did you mean \`${near}\`?` : '.')
  );
}
