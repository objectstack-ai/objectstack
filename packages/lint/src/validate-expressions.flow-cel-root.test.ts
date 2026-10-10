// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22565 — the build door refuses a flow CEL root the flow does not bind.
 *
 * Measured on the flow scope the engine builds (`AutomationEngine.celScope`
 * over `seedRunVariables`' map): `user.id == "u1"`, `ctx.user.id == "u1"`,
 * `os.user.id == "u1"` and `foo.bar == 1` each fail the run with
 * `Unknown variable: <root>`, while `validateStackExpressions` answered 0 issues
 * for every one of them. The three user spellings are the ones formulas, RLS and
 * the client bind; flow CEL binds the run's user as `current_user` only.
 *
 * The judge lives in `flow-cel-root-scope.ts`; these pins drive it through
 * `validateStackExpressions`, the pass `objectstack validate` runs. The runtime
 * publish gate runs the same pass and this one judgment stands down there (the
 * S block below).
 *
 * #22677: `record` is no longer bound on every run — it is the record the run
 * was handed (#22642), bound where an entrance hands the flow one or the flow
 * binds the name (the last block below).
 */

import { describe, expect, it } from 'vitest';

import { flowCelEntrances, flowCelRootScope, perWriteSnapshotEntrance, unboundFlowCelRoots } from './flow-cel-root-scope.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { validateStackExpressions } from './validate-expressions.js';

type AnyRec = Record<string, unknown>;

const OBJECTS = [{ name: 'acct', fields: { status: { type: 'text' }, amount: { type: 'number' } } }];

/** start → (edge carrying `edgeCondition`) → done, plus any `middle` nodes, on an optional trigger object. */
function flowStack(opts: {
  edgeCondition?: unknown;
  startCondition?: unknown;
  variables?: AnyRec[];
  middle?: AnyRec[];
  objectName?: string;
  /** The start node's `config.triggerType` — a `record-*` token is the record trigger that hands the run a row. */
  triggerType?: string;
  objects?: AnyRec[];
}): AnyRec {
  return {
    objects: opts.objects ?? OBJECTS,
    flows: [{
      name: 'f',
      label: 'F',
      type: 'autolaunched',
      ...(opts.variables ? { variables: opts.variables } : {}),
      nodes: [
        {
          id: 'start',
          type: 'start',
          config: {
            ...(opts.objectName ? { objectName: opts.objectName } : {}),
            ...(opts.triggerType ? { triggerType: opts.triggerType } : {}),
            ...(opts.startCondition !== undefined ? { condition: opts.startCondition } : {}),
          },
        },
        ...(opts.middle ?? []),
        { id: 'done', type: 'end', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'done', ...(opts.edgeCondition !== undefined ? { condition: opts.edgeCondition } : {}) },
      ],
    }],
  };
}

const errorsOf = (stack: AnyRec) => validateStackExpressions(stack).filter((i) => (i.severity ?? 'error') === 'error');
/**
 * The judge's own findings — every refusal it writes says the root "is not bound
 * in" a flow scope. Controls and stand-downs read these, so a node-config refusal
 * about an unrelated key can neither mask nor fake a verdict here.
 */
const rootFindings = (stack: AnyRec) => errorsOf(stack).filter((i) => / is not bound in (a flow expression|this flow's expression scope)/.test(i.message));
const CURRENT_USER_REMEDY = 'a flow binds the run\'s user as `current_user` only';

describe('the triage pins (#22565)', () => {
  it('an edge condition `user.id == "u1"` is refused with the `current_user` remedy', () => {
    const found = errorsOf(flowStack({ edgeCondition: 'user.id == "u1"' }));
    expect(found).toHaveLength(1);
    expect(found[0]!.where).toBe("flow 'f' · edge 'e1' (start→done) condition");
    expect(found[0]!.source).toBe('user.id == "u1"');
    expect(found[0]!.message).toMatch(/^`user` is not bound in a flow expression, so the run fails with `Unknown variable: user`/);
    expect(found[0]!.message).toContain(CURRENT_USER_REMEDY);
    expect(found[0]!.message).toContain('(`user.id` → `current_user.id`)');
  });

  it('control: the same condition on a flow that declares a variable `user` passes', () => {
    expect(validateStackExpressions(flowStack({
      edgeCondition: 'user.id == "u1"',
      variables: [{ name: 'user', type: 'object' }],
    }))).toEqual([]);
  });

  it('control: the remedy itself — `current_user.id == "u1"` — passes', () => {
    expect(validateStackExpressions(flowStack({ edgeCondition: 'current_user.id == "u1"' }))).toEqual([]);
  });
});

describe('every run-user spelling formulas, RLS and the client accept', () => {
  it.each([
    ['ctx.user.id == "u1"', 'ctx.user', 'ctx'],
    ['os.user.id == "u1"', 'os.user', 'os'],
    ['has(user.id)', 'user', 'user'],
    ['user.?id.orValue("") == "u1"', 'user', 'user'],
    ['"admin" in user.positions', 'user', 'user'],
  ])('`%s` is refused naming `current_user`', (source, spelling, root) => {
    const found = errorsOf(flowStack({ edgeCondition: source }));
    expect(found).toHaveLength(1);
    expect(found[0]!.message.startsWith(`\`${spelling}\` is not bound in a flow expression, so the run fails with \`Unknown variable: ${root}\``)).toBe(true);
    expect(found[0]!.message).toContain(CURRENT_USER_REMEDY);
    expect(found[0]!.message).toContain(`(\`${spelling}.id\` → \`current_user.id\`)`);
  });

  it('`ctx` / `os` read for something other than the user get the general refusal, naming the root', () => {
    const found = errorsOf(flowStack({ edgeCondition: 'os.env == "prod"' }));
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toMatch(/^`os` is not bound in this flow's expression scope/);
    expect(found[0]!.message).not.toContain('current_user` in its place');
  });
});

describe('every flow CEL site the door visits', () => {
  const USER = 'user.id == "u1"';
  const env = (source: string) => ({ dialect: 'cel', source });

  it.each([
    ['the start node\'s trigger gate', flowStack({ startCondition: USER }), "flow 'f' · node 'start' (start) condition"],
    ['an edge', flowStack({ edgeCondition: USER }), "flow 'f' · edge 'e1' (start→done) condition"],
    ['another node\'s `config.condition`', flowStack({ middle: [{ id: 'gate', type: 'decision', config: { condition: USER } }] }),
      "flow 'f' · node 'gate' (decision) condition"],
    ['a decision branch', flowStack({ middle: [{ id: 'pick', type: 'decision', config: { conditions: [{ label: 'y', expression: USER }] } }] }),
      "flow 'f' · node 'pick' (decision) decision branch expression at config.conditions[0].expression"],
    ['a screen field `visibleWhen`', flowStack({ middle: [{ id: 'ask', type: 'screen', config: { fields: [{ name: 'note', type: 'text', visibleWhen: USER }] } }] }),
      "flow 'f' · node 'ask' (screen) screen field visibleWhen at config.fields[0].visibleWhen"],
    ['an assignment value envelope', flowStack({ middle: [{ id: 'set', type: 'assignment', config: { assignments: { who: env('user.id') } } }] }),
      "flow 'f' · node 'set' (assignment) assignment value at config.assignments.who"],
    ['a create_record field envelope', flowStack({ middle: [{ id: 'mk', type: 'create_record', config: { objectName: 'acct', fields: { status: env('user.id') } } }] }),
      "flow 'f' · node 'mk' (create_record) create_record field value at config.fields.status"],
    ['an update_record field envelope', flowStack({ middle: [{ id: 'up', type: 'update_record', config: { objectName: 'acct', filter: { id: '{record.id}' }, fields: { status: env('user.id') } } }] }),
      "flow 'f' · node 'up' (update_record) update_record field value at config.fields.status"],
  ])('%s', (_site, stack, where) => {
    const found = rootFindings(stack);
    expect(found.map((i) => i.where)).toEqual([where]);
    expect(found[0]!.message).toContain(CURRENT_USER_REMEDY);
  });

  it('an expression inside an ADR-0031 region body is judged against the same flow-wide set', () => {
    const found = rootFindings(flowStack({
      middle: [{
        id: 'sweep', type: 'loop',
        config: { collection: '{rows}', iteratorVariable: 'row', body: { nodes: [{ id: 'inner', type: 'decision', config: { conditions: [{ label: 'y', expression: 'user.id == row.owner' }] } }], edges: [] } },
      }],
      variables: [{ name: 'rows', type: 'list' }],
    }));
    expect(found).toHaveLength(1);
    expect(found[0]!.where).toContain("loop 'sweep' body");
    expect(found[0]!.message).toContain(CURRENT_USER_REMEDY);
  });

  it('a value slot\'s plain string is a literal, so its text is not read for roots', () => {
    expect(rootFindings(flowStack({ middle: [{ id: 'set', type: 'assignment', config: { assignments: { who: 'user.id' } } }] }))).toEqual([]);
  });
});

describe('controls — one per binding kind the run has', () => {
  it.each<[string, Parameters<typeof flowStack>[0]]>([
    ['a declared variable', { edgeCondition: 'quota > 1', variables: [{ name: 'quota', type: 'number' }] }],
    ['an `outputVariable`', { edgeCondition: 'acc.status == "x"', middle: [{ id: 'read', type: 'get_record', config: { objectName: 'acct', filter: { id: '{record.id}' }, outputVariable: 'acc' } }] }],
    ['a node id (its outputs land under it)', { edgeCondition: 'read.record != null', middle: [{ id: 'read', type: 'get_record', config: { objectName: 'acct', filter: { id: '{record.id}' } } }] }],
    ['an `assignment` target', { edgeCondition: 'flag == true', middle: [{ id: 'set', type: 'assignment', config: { assignments: { flag: true } } }] }],
    ['a `loop` iterator and index', { edgeCondition: 'row != null && i >= 0', variables: [{ name: 'rows', type: 'list' }], middle: [{ id: 'sweep', type: 'loop', config: { collection: '{rows}', iteratorVariable: 'row', indexVariable: 'i', body: { nodes: [], edges: [] } } }] }],
    ['a `loop` with no iterator binds the default `item`', { edgeCondition: 'item != null', variables: [{ name: 'rows', type: 'list' }], middle: [{ id: 'sweep', type: 'loop', config: { collection: '{rows}', body: { nodes: [], edges: [] } } }] }],
    ['a `try_catch` `errorVariable`', { edgeCondition: 'caught != null', middle: [{ id: 'guard', type: 'try_catch', config: { errorVariable: 'caught', try: { nodes: [], edges: [] }, catch: { nodes: [], edges: [] } } }] }],
    ['a screen field (a resume binds it under its name)', { edgeCondition: 'approve == true', middle: [{ id: 'ask', type: 'screen', config: { fields: [{ name: 'approve', type: 'boolean' }] } }] }],
    ['a trigger field, read bare', { edgeCondition: 'status == "open" && amount > 5', objectName: 'acct' }],
    ['a field of another object the stack declares (an action, a subflow parent or a map item can hand its record in)', { edgeCondition: 'region == "eu"', objectName: 'acct', objects: [...OBJECTS, { name: 'branch', fields: { region: { type: 'text' } } }] }],
    ['a registry-injected column', { edgeCondition: 'owner_id != null', objectName: 'acct' }],
    ['the engine roots', { edgeCondition: 'previous == null && vars.x == null && current_user != null' }],
    ['`record`, on a flow a record trigger hands one (#22677)', { edgeCondition: 'record != null && record.status == "open"', objectName: 'acct', triggerType: 'record-after-update' }],
    ['a `$` variable through `vars` (a `$` name has no CEL spelling)', { edgeCondition: 'vars["$record"] != null' }],
    ['a comprehension macro variable', { edgeCondition: '[1, 2].exists(user, user > 1) && [1].map(x, x > 0, x + 1).size() == 1' }],
    ['a `cel.bind` variable', { edgeCondition: 'cel.bind(user, 2, user > 1)' }],
    ['a CEL type name', { edgeCondition: 'type(vars) == map && int("1") == 1' }],
  ])('%s', (_kind, opts) => {
    expect(rootFindings(flowStack(opts))).toEqual([]);
  });

  it('a binding declared by a node AFTER the reading edge still counts — one variable map serves the whole run', () => {
    expect(rootFindings(flowStack({
      edgeCondition: 'later == 1',
      middle: [{ id: 'tail', type: 'assignment', config: { assignments: { later: 1 } } }],
    }))).toEqual([]);
  });

  it('a `cel.bind` variable is bound in its body only — the initializer reads the flow\'s scope', () => {
    const found = rootFindings(flowStack({ edgeCondition: 'cel.bind(v, v, v > 1)' }));
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toMatch(/^`v` is not bound in this flow's expression scope/);
  });
});

describe('the door stands down where the run can bind a name it cannot see', () => {
  it.each<[string, AnyRec]>([
    ['a `script` (its function gets the live variable map)', { id: 'fn', type: 'script', config: { function: 'enrich' } }],
    ['a `connector_action` (its handler gets the live variable map)', { id: 'push', type: 'connector_action', config: { connectorId: 'slack', actionId: 'post' } }],
    ['a `wait` (a resume folds the caller\'s bag)', { id: 'hold', type: 'wait', config: { eventType: 'signal', signalName: 'go' } }],
    ['a `subflow` (a resume folds the caller\'s bag)', { id: 'child', type: 'subflow', config: { flowName: 'other' } }],
    ['a `map` (a resume folds the caller\'s bag)', { id: 'each', type: 'map', config: { collection: '{rows}', flowName: 'other' } }],
    ['a plugin node type', { id: 'ai', type: 'ai_classify', config: {} }],
    ['a screen with no fields', { id: 'ok', type: 'screen', config: { waitForInput: true } }],
    ['an object-form screen', { id: 'form', type: 'screen', config: { kind: 'object-form', objectName: 'acct', idVariable: 'saved' } }],
  ])('%s', (_why, node) => {
    expect(rootFindings(flowStack({ edgeCondition: 'user.id == "u1" && foo == 1', middle: [node] }))).toEqual([]);
  });

  it('a trigger object the stack does not declare', () => {
    expect(rootFindings(flowStack({ edgeCondition: 'user.id == "u1"', objectName: 'sys_user' }))).toEqual([]);
  });

  it('RED CONTROL — the same condition on the same flow with no opening node is refused, twice', () => {
    expect(rootFindings(flowStack({ edgeCondition: 'user.id == "u1" && foo == 1' })).map((i) => i.message.slice(0, 6)))
      .toEqual(['`user`', '`foo` ']);
  });

  it('the scope says why', () => {
    const scope = flowCelRootScope({ nodes: [] }, [{ nodes: [{ id: 'fn', type: 'script', config: {} }] }], undefined, new Map());
    expect(scope.provable).toBe(false);
    expect(scope.openedBy).toContain("node 'fn' (script)");
    expect(unboundFlowCelRoots('user.id == "u1"', scope)).toEqual([]);
  });
});

describe('the wider family — any root nothing binds (rides the same judge)', () => {
  it('`foo.bar == 1` is refused naming the root and what could have bound it', () => {
    const found = errorsOf(flowStack({ edgeCondition: 'foo.bar == 1' }));
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toBe(
      '`foo` is not bound in this flow\'s expression scope, so the run fails with `Unknown variable: foo`: no variable, '
      + '`outputVariable`, iterator, index or error variable, `assignment` target, node id or screen field of this flow is '
      + 'named `foo`, no object in the stack declares a field `foo`, and the engine binds only `previous`, `vars` and '
      + '`current_user` on every run, and `record` when an entrance hands the run one. Declare `foo` as a flow variable '
      + 'or bind it with a node, or correct the name.',
    );
  });

  it('each unbound root is its own finding; a bound one beside it is not', () => {
    const found = errorsOf(flowStack({ edgeCondition: 'alpha == 1 && status == "x" && beta == 2', objectName: 'acct' }));
    expect(found.map((i) => i.message.slice(0, 7))).toEqual(['`alpha`', '`beta` ']);
  });

  it('a near-miss of a trigger field is ONE finding: the refusal carries the did-you-mean, the advisory is withdrawn', () => {
    const issues = validateStackExpressions(flowStack({ edgeCondition: 'stauts == "open"', objectName: 'acct' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('error');
    expect(issues[0]!.message).toContain('did you mean `status`?');
  });

  it('a source that does not parse is the syntax check\'s alone — one broken expression, one finding', () => {
    const issues = validateStackExpressions(flowStack({ edgeCondition: 'user.id ==' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).not.toContain('is not bound');
  });
});

/**
 * A′ (triage `6094431558`): every entrance the stack declares is read, and a flow
 * an entrance hands a record of an undeclared (or unknowable) object is not
 * judged. One pin per entrance: the undeclared case stands down, and the same
 * flow fed by a declared object is still judged.
 */
describe('the entrances the stack declares (A′)', () => {
  const USER = 'user.id == "u1"';
  /** A second flow `g` that names `f` from a node of the given type. */
  const parentFlow = (opts: { type?: string; start?: AnyRec; node: AnyRec }): AnyRec => ({
    name: 'g',
    label: 'G',
    type: opts.type ?? 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', config: opts.start ?? {} },
      opts.node,
      { id: 'done', type: 'end', config: {} },
    ],
    edges: [{ id: 'g1', source: 'start', target: opts.node.id }, { id: 'g2', source: opts.node.id, target: 'done' }],
  });
  const withFlows = (stack: AnyRec, ...flows: AnyRec[]): AnyRec => ({ ...stack, flows: [...(stack.flows as AnyRec[]), ...flows] });
  const userRefusals = (stack: AnyRec) => rootFindings(stack).filter((i) => i.where.startsWith("flow 'f'"));

  it('a record trigger: an undeclared start config.objectName stands down; a declared one is judged', () => {
    expect(userRefusals(flowStack({ edgeCondition: USER, objectName: 'sys_user' }))).toEqual([]);
    expect(userRefusals(flowStack({ edgeCondition: USER, objectName: 'acct' }))).toHaveLength(1);
  });

  it('a time-relative sweep: an undeclared config.timeRelative.object stands down; a declared one is judged', () => {
    const sweep = (object: string): AnyRec => {
      const stack = flowStack({ edgeCondition: USER });
      const flow = (stack.flows as AnyRec[])[0]!;
      (flow.nodes as AnyRec[])[0] = { id: 'start', type: 'start', config: { timeRelative: { object, dateField: 'due', withinDays: 7 } } };
      return stack;
    };
    expect(userRefusals(sweep('sys_task'))).toEqual([]);
    expect(userRefusals(sweep('acct'))).toHaveLength(1);
  });

  it('the inbound hook: a flow whose trigger kind is api stands down; the same flow as autolaunched is judged', () => {
    const asApi = flowStack({ edgeCondition: USER });
    (asApi.flows as AnyRec[])[0]!.type = 'api';
    expect(userRefusals(asApi)).toEqual([]);
    const viaTriggerType = flowStack({ edgeCondition: USER });
    (((viaTriggerType.flows as AnyRec[])[0]!.nodes as AnyRec[])[0] as AnyRec).config = { triggerType: 'api' };
    expect(userRefusals(viaTriggerType)).toEqual([]);
    expect(userRefusals(flowStack({ edgeCondition: USER }))).toHaveLength(1);
  });

  it('an action: one launching the flow on an undeclared object stands down; on a declared object it is judged', () => {
    const launched = (objectName: string): AnyRec => ({
      ...flowStack({ edgeCondition: USER }),
      actions: [{ name: 'go', label: 'Go', type: 'flow', target: 'f', objectName }],
    });
    expect(userRefusals(launched('sys_user'))).toEqual([]);
    expect(userRefusals(launched('acct'))).toHaveLength(1);
    // An object's own actions[] carry the owning object.
    const nested = flowStack({
      edgeCondition: USER,
      objects: [{ ...OBJECTS[0], actions: [{ name: 'go', label: 'Go', type: 'flow', target: 'f' }] }],
    });
    expect(userRefusals(nested)).toHaveLength(1);
    // A non-flow action naming the flow's name is no entrance.
    expect(userRefusals({ ...flowStack({ edgeCondition: USER }), actions: [{ name: 'go', label: 'Go', type: 'url', target: 'f', objectName: 'sys_user' }] })).toHaveLength(1);
  });

  it('an object-less action binds only the row id it is given', () => {
    const bare = flowStack({ edgeCondition: 'id == "r1"', objects: [] });
    expect(rootFindings(bare).map((i) => i.message.slice(0, 4))).toEqual(['`id`']);
    expect(rootFindings({ ...bare, actions: [{ name: 'go', label: 'Go', type: 'flow', target: 'f' }] })).toEqual([]);
  });

  it('a map node: an undeclared or absent itemObject stands down the flow it feeds; a declared one is judged', () => {
    const fedBy = (itemObject?: string): AnyRec => withFlows(
      flowStack({ edgeCondition: USER }),
      parentFlow({ node: { id: 'each', type: 'map', config: { collection: '{rows}', flowName: 'f', ...(itemObject ? { itemObject } : {}) } } }),
    );
    expect(userRefusals(fedBy('sys_task'))).toEqual([]);
    expect(userRefusals(fedBy(undefined))).toEqual([]);
    expect(userRefusals(fedBy('acct'))).toHaveLength(1);
  });

  it('a parent that is itself open: its subflow child stands down, to a fixpoint; a judged parent leaves the child judged', () => {
    const subflowOf = (parent: AnyRec, child = 'f'): AnyRec => ({ ...parent, nodes: (parent.nodes as AnyRec[]).map((n) => (n.type === 'subflow' ? { ...n, config: { flowName: child } } : n)) });
    const call = { id: 'call', type: 'subflow', config: {} };
    const openParent = subflowOf(parentFlow({ type: 'api', node: call }));
    expect(userRefusals(withFlows(flowStack({ edgeCondition: USER }), openParent))).toEqual([]);
    // Two levels: g (the inbound hook) → h → f.
    const middle = { ...subflowOf(parentFlow({ node: call })), name: 'h', label: 'H' };
    expect(userRefusals(withFlows(flowStack({ edgeCondition: USER }), subflowOf(openParent, 'h'), middle))).toEqual([]);
    // A parent fed by a declared trigger object is judged, and so is its child.
    const judgedParent = subflowOf(parentFlow({ start: { objectName: 'acct' }, node: call }));
    expect(userRefusals(withFlows(flowStack({ edgeCondition: USER }), judgedParent))).toHaveLength(1);
  });

  it('the reader names the entrance', () => {
    const entrances = flowCelEntrances(
      {
        flows: [{ name: 'f', type: 'autolaunched', nodes: [{ id: 'start', type: 'start' }] }],
        actions: [{ name: 'go', type: 'flow', target: 'f', objectName: 'sys_user' }],
      },
      new Map([['acct', ['status']]]),
    );
    expect(entrances.get('f')?.openedBy).toContain("action 'go' launches it on 'sys_user'");
  });
});

/**
 * S (triage `6094850599`): at the runtime publish gate the per-write snapshot
 * holds the written flow alone, so no entrance is visible and this one judgment
 * stands down there. Every other expression verdict at that door is unchanged.
 * #22636 widens the snapshot; when it lands, this stand-down goes.
 */
describe('the runtime publish gate (S)', () => {
  const written = {
    name: 'f',
    label: 'F',
    type: 'autolaunched',
    nodes: [{ id: 'start', type: 'start', config: {} }, { id: 'done', type: 'end', config: {} }],
    edges: [
      { id: 'e1', source: 'start', target: 'done', condition: 'user.id == "u1"' },
      { id: 'e2', source: 'start', target: 'done', condition: '{record.status} == "open"' },
    ],
  };

  it('a flow write is not refused for an unbound root, while another expression verdict still refuses there', () => {
    const result = runRuntimeAuthoringRules({ type: 'flow', item: written, context: { objects: OBJECTS } });
    const expressionErrors = result.errors.filter((f) => f.rule === 'expression-invalid');
    expect(expressionErrors.some((f) => / is not bound in /.test(f.message))).toBe(false);
    expect(expressionErrors.some((f) => f.message.includes('template brace') && f.where.includes("edge 'e2'"))).toBe(true);
  });

  it('control: the build door refuses the same root on the same flow', () => {
    const found = rootFindings({ objects: OBJECTS, flows: [written] });
    expect(found.map((i) => i.where)).toEqual(["flow 'f' · edge 'e1' (start→done) condition"]);
  });

  it('the stand-down names the per-write snapshot', () => {
    const scope = flowCelRootScope({ nodes: [] }, [], undefined, new Map(), perWriteSnapshotEntrance());
    expect(scope.provable).toBe(false);
    expect(scope.openedBy).toContain('per-write snapshot');
  });
});

/**
 * #22677 — `record` is the record the run was handed (#22642): `seedRunVariables`
 * binds `context.record` and `celScope` binds no `record` of its own. So the
 * build door binds it only where an entrance the stack declares hands the flow a
 * record, or the flow binds a variable named `record`; otherwise `record.X` is
 * refused. The runtime publish gate's stand-down (S) covers it until #22636.
 */
describe('`record` — bound only where an entrance hands the flow a record (#22677)', () => {
  const READ = 'record.status == "open"';
  const RECORD_TRIGGER = { objectName: 'acct', triggerType: 'record-after-update' };
  const RECORD_HEAD = /^`record` is not bound in this flow's expression scope, so the run fails with `Unknown variable: record`/;
  /** `f`'s refusals of `record` — another flow's findings and other roots are not this pin's. */
  const recordRefusals = (stack: AnyRec) =>
    rootFindings(stack).filter((i) => i.where.startsWith("flow 'f'") && RECORD_HEAD.test(i.message));
  /** A second flow `g` whose `node` names `f`; `start` is its start config, `variables` its declarations. */
  const parent = (opts: { name?: string; start?: AnyRec; type?: string; variables?: AnyRec[]; node: AnyRec }): AnyRec => ({
    name: opts.name ?? 'g',
    label: 'G',
    type: opts.type ?? 'autolaunched',
    ...(opts.variables ? { variables: opts.variables } : {}),
    nodes: [
      { id: 'start', type: 'start', config: opts.start ?? {} },
      opts.node,
      { id: 'done', type: 'end', config: {} },
    ],
    edges: [{ id: 'p1', source: 'start', target: opts.node.id }, { id: 'p2', source: opts.node.id, target: 'done' }],
  });
  const calls = (child: string): AnyRec => ({ id: 'call', type: 'subflow', config: { flowName: child } });
  const withFlows = (stack: AnyRec, ...flows: AnyRec[]): AnyRec => ({ ...stack, flows: [...(stack.flows as AnyRec[]), ...flows] });

  it('`validate` refuses `record.X` on a flow no entrance hands a record, with the `vars` remedy', () => {
    const found = errorsOf(flowStack({ edgeCondition: READ }));
    expect(found).toHaveLength(1);
    expect(found[0]!.where).toBe("flow 'f' · edge 'e1' (start→done) condition");
    expect(found[0]!.message).toMatch(RECORD_HEAD);
    expect(found[0]!.message).toContain('(`record.status` → `status`) or through `vars` (`vars.status`)');
  });

  it('a start config.objectName alone is no entrance — with no `record-*` trigger nothing hands the run a row', () => {
    expect(recordRefusals(flowStack({ edgeCondition: READ, objectName: 'acct' }))).toHaveLength(1);
  });

  it('control: a record-triggered flow passes', () => {
    expect(recordRefusals(flowStack({ edgeCondition: READ, ...RECORD_TRIGGER }))).toEqual([]);
    expect(validateStackExpressions(flowStack({ edgeCondition: READ, ...RECORD_TRIGGER }))).toEqual([]);
  });

  it('control: a `subflow` child of a record-handing parent passes, to a fixpoint', () => {
    expect(recordRefusals(withFlows(flowStack({ edgeCondition: READ }), parent({ start: RECORD_TRIGGER, node: calls('f') })))).toEqual([]);
    // Two levels: g (record trigger) → h → f.
    expect(recordRefusals(withFlows(
      flowStack({ edgeCondition: READ }),
      parent({ start: RECORD_TRIGGER, node: calls('h') }),
      parent({ name: 'h', node: calls('f') }),
    ))).toEqual([]);
  });

  it('RED CONTROL — a `subflow` child of a parent no entrance hands a record is refused', () => {
    expect(recordRefusals(withFlows(flowStack({ edgeCondition: READ }), parent({ node: calls('f') })))).toHaveLength(1);
  });

  it('a parent\'s own `record` VARIABLE is not handed on — the child gets its context, not its variables', () => {
    const declares = parent({ variables: [{ name: 'record', type: 'object' }], node: calls('f') });
    expect(recordRefusals(withFlows(flowStack({ edgeCondition: READ }), declares))).toHaveLength(1);
  });

  it.each<[string, (stack: AnyRec) => AnyRec]>([
    ['a time-relative sweep', (stack) => {
      ((((stack.flows as AnyRec[])[0]!.nodes as AnyRec[])[0]) as AnyRec).config = { timeRelative: { object: 'acct', dateField: 'due', withinDays: 7 } };
      return stack;
    }],
    ['an action on a declared object', (stack) => ({ ...stack, actions: [{ name: 'go', label: 'Go', type: 'flow', target: 'f', objectName: 'acct' }] })],
    ['an object-less action (it hands an empty record, still a record)', (stack) => ({ ...stack, actions: [{ name: 'go', label: 'Go', type: 'flow', target: 'f' }] })],
    ['a `map` node with a declared itemObject', (stack) => withFlows(stack, parent({ node: { id: 'each', type: 'map', config: { collection: '{rows}', flowName: 'f', itemObject: 'acct' } } }))],
    ['a declared `record` variable', (stack) => ({ ...stack, flows: [{ ...(stack.flows as AnyRec[])[0]!, variables: [{ name: 'record', type: 'object' }] }] })],
  ])('control: %s', (_entrance, give) => {
    expect(recordRefusals(give(flowStack({ edgeCondition: READ })))).toEqual([]);
  });

  it('the reader binds `record` per entrance, and the inbound hook\'s too (that flow also stands down)', () => {
    const fieldIndex = new Map([['acct', ['status']]]);
    const flow = (name: string, start: AnyRec, type = 'autolaunched'): AnyRec => ({ name, type, nodes: [{ id: 'start', type: 'start', config: start }] });
    const entrances = flowCelEntrances({
      flows: [flow('trig', RECORD_TRIGGER), flow('hook', {}, 'api'), flow('bare', { objectName: 'acct' }), flow('act', {})],
      actions: [{ name: 'go', type: 'flow', target: 'act' }],
    }, fieldIndex);
    expect(entrances.get('trig')).toEqual({ bound: ['record'] });
    expect(entrances.get('hook')?.bound).toEqual(['record']);
    expect(entrances.get('act')).toEqual({ bound: ['record', 'id'] });
    expect(entrances.has('bare')).toBe(false);
  });

  it('the runtime publish gate does not refuse `record.X` on a flow write, while `validate` refuses it on the same flow', () => {
    const written = {
      name: 'f',
      label: 'F',
      type: 'autolaunched',
      nodes: [{ id: 'start', type: 'start', config: {} }, { id: 'done', type: 'end', config: {} }],
      edges: [{ id: 'e1', source: 'start', target: 'done', condition: READ }],
    };
    const result = runRuntimeAuthoringRules({ type: 'flow', item: written, context: { objects: OBJECTS } });
    expect(result.errors.filter((f) => / is not bound in /.test(f.message))).toEqual([]);
    expect(recordRefusals({ objects: OBJECTS, flows: [written] })).toHaveLength(1);
  });
});
