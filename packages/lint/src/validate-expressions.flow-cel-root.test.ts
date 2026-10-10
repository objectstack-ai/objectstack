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
 * The judge lives in `flow-cel-root-scope.ts`; these pins drive it through the
 * door `objectstack validate` and the runtime publish gate both call.
 */

import { describe, expect, it } from 'vitest';

import { flowCelRootScope, unboundFlowCelRoots } from './flow-cel-root-scope.js';
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
    ['the engine roots', { edgeCondition: 'record != null && previous == null && vars.x == null && current_user != null' }],
    ['a `$` variable through `vars` (a `$` name has no CEL spelling)', { edgeCondition: 'vars["$record"] != null' }],
    ['a comprehension macro variable', { edgeCondition: '[1, 2].exists(user, user > 1) && [1].map(x, x > 0, x + 1).size() == 1' }],
    ['a `cel.bind` variable', { edgeCondition: 'cel.bind(user, 2, user > 1)' }],
    ['a CEL type name', { edgeCondition: 'type(record) == map && int("1") == 1' }],
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
      + 'named `foo`, no object in the stack declares a field `foo`, and the engine binds only `record`, `previous`, '
      + '`vars` and `current_user`. Declare `foo` as a flow variable or bind it with a node, or correct the name.',
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
