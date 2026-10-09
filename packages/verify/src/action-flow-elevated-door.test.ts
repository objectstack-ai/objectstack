// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The action door × a flow declared `runAs: 'system'`, per flow type and per
 * caller, through `actions.run` — the in-process twin of
 * `POST /api/v1/actions/:object/:action` (`handle.ts` drives the runtime's
 * `HttpDispatcher`, so it answers through the same `dispatchFlowAction` the
 * MCP `run_action` bridge reaches).
 *
 * The defect class: the trigger door refuses a non-system caller a
 * `runAs: 'system'` flow whose type is self-triggered (`autolaunched`,
 * `record_change`, `schedule`), but an action of `type: 'flow'` naming the
 * same flow asked nothing of the kind, so any signed-in member started it and
 * its elevated write landed.
 *
 * This is the wire half, on the real kernel — auth, security middleware, the
 * real automation engine — so every row is a measurement: the door's answer,
 * the elevated write that did or did not land, and the run log. It carries the
 * row the dogfood half cannot: the system principal, an in-process caller only
 * the runtime's dispatcher can stand in for. The dogfood half
 * (`packages/qa/dogfood/test/flow-door-elevated-start.dogfood.test.ts`) adds
 * the MCP `run_action` tool and the declared endpoint on a real boot.
 *
 * The fixture is neutral: one object no fresh member is granted (`fda_ledger`;
 * a member's direct create on it is refused, which the first case pins as the
 * control that makes every elevated write below meaningful), and one writer
 * flow per type, each creating a ledger row named after itself, each named by
 * one flow action.
 *
 * ⚠️ This suite resolves `@objectstack/runtime` and
 * `@objectstack/service-automation` through their BUILT `dist/`. Rebuild both
 * before trusting a run of this file — and especially an ablated one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { HttpDispatcher } from '@objectstack/runtime';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import type { Flow } from '@objectstack/spec/automation';

import { bootStack, type VerifyStack } from './harness.js';

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;

const LEDGER = 'fda_ledger';
const WATCH = 'fda_watch';

/** Granted to nobody but the platform admin: a member's direct create is refused. */
const Ledger = ObjectSchema.create({
  name: LEDGER,
  sharingModel: 'public_read_write',
  label: 'Ledger',
  pluralLabel: 'Ledgers',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

/** The object the flow actions hang on, and the one the record-change writer watches. Nothing writes it. */
const Watch = ObjectSchema.create({
  name: WATCH,
  sharingModel: 'public_read_write',
  label: 'Watch',
  pluralLabel: 'Watches',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

/** start → create_record(fda_ledger, { name: <flow name> }) → end. */
function writer(
  name: string,
  type: Flow['type'],
  runAs: 'system' | 'user',
  startConfig?: Record<string, unknown>,
): Flow {
  return {
    name,
    label: name,
    type,
    status: 'active',
    runAs,
    nodes: [
      { id: 'start', type: 'start', label: 'Start', ...(startConfig ? { config: startConfig } : {}) },
      { id: 'write', type: 'create_record', label: 'Write', config: { objectName: LEDGER, fields: { name } } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'write' },
      { id: 'e2', source: 'write', target: 'end' },
    ],
  } as Flow;
}

const AUTO_SYS = 'fda_auto_sys';
const CHANGE_SYS = 'fda_change_sys';
const SCHED_SYS = 'fda_sched_sys';
const SCREEN_SYS = 'fda_screen_sys';
const API_SYS = 'fda_api_sys';
const AUTO_USER = 'fda_auto_user';
const PARENT_SCREEN = 'fda_parent_screen';

const FLOWS: Flow[] = [
  writer(AUTO_SYS, 'autolaunched', 'system'),
  // A watched object nobody writes and a cadence nobody reaches during a run:
  // each of these two runs only when a door starts it.
  writer(CHANGE_SYS, 'record_change', 'system', { objectName: WATCH, triggerType: 'record-after-update' }),
  writer(SCHED_SYS, 'schedule', 'system', { schedule: { cron: '0 3 1 1 *' } }),
  writer(SCREEN_SYS, 'screen', 'system'),
  // ADR-0041: an `api` flow registers only with its per-flow secret.
  writer(API_SYS, 'api', 'system', { secret: 'fda-fixture-secret' }),
  writer(AUTO_USER, 'autolaunched', 'user'),
  // The route an author takes to let members start elevated logic: a declared
  // entry (`screen`) that is not elevated itself, whose `subflow` node calls
  // the elevated self-triggered child. The child writes its own name.
  {
    name: PARENT_SCREEN,
    label: PARENT_SCREEN,
    type: 'screen',
    status: 'active',
    runAs: 'user',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'sub', type: 'subflow', label: 'Elevated child', config: { flowName: AUTO_SYS } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'sub' },
      { id: 'e2', source: 'sub', target: 'end' },
    ],
  } as Flow,
];

const TARGETS = [AUTO_SYS, CHANGE_SYS, SCHED_SYS, SCREEN_SYS, API_SYS, AUTO_USER, PARENT_SCREEN] as const;
type Target = (typeof TARGETS)[number];
const actionOf = (flow: Target) => `run_${flow}`;

const fixtureStack = defineStack({
  manifest: {
    id: 'com.objectstack.verify.action-flow-elevated-door',
    namespace: 'fda',
    version: '0.0.0',
    type: 'app',
    name: 'Action Flow Elevated Door Fixture',
    description: 'One ungranted object, one elevated writer flow per flow type, and a flow action naming each.',
  },
  // ADR-0097: the record-change start node needs both capabilities.
  requires: ['automation', 'triggers'],
  objects: [Ledger, Watch],
  flows: FLOWS,
  actions: TARGETS.map((flow) => ({
    name: actionOf(flow),
    label: `Run ${flow}`,
    objectName: WATCH,
    type: 'flow',
    target: flow,
  })),
} as never);

let stack: VerifyStack;
let admin: string;
let member: string;

beforeAll(async () => {
  stack = await bootStack(fixtureStack as never, { automation: true });
  admin = await stack.signIn();
  // The first user is the seeded dev admin, so this sign-up is a plain member:
  // no permission set of the app's, only the platform's fallback baseline.
  member = await stack.signUp('fda-member@verify.test');
}, BOOT_TIMEOUT);

afterAll(async () => {
  await stack?.stop().catch(() => undefined);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const codeOf = (e: unknown): string | undefined => (e as any)?.code;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const statusOf = (e: unknown): number | undefined => (e as any)?.statusCode ?? (e as any)?.status;

/** Ledger rows a writer flow named `flow` has created so far. */
async function ledgerRows(flow: string): Promise<number> {
  return (await stack.rows(LEDGER, { name: flow })).length;
}

/** Run-log entries the engine holds for `flow`. */
async function runCount(flow: string): Promise<number> {
  const automation = stack.kernel.getService('automation') as { listRuns(name: string): Promise<unknown[]> };
  return (await automation.listRuns(flow)).length;
}

type Caller = 'member' | 'admin' | 'system';

interface Outcome {
  /** The door's HTTP answer. */
  answer: number;
  /** The ADR-0112 `error.code` on a refusal. */
  code?: string;
  /** Ledger rows the request caused (the writer's side effect). */
  rows: number;
  /** Run-log entries the request caused for the flow it named. */
  runs: number;
}

/**
 * Start `flow` through its action as `caller` and measure what happened.
 *
 * `member` and `admin` go through `actions.run` with a bearer token, exactly
 * as a console or SDK reaches the door. The system principal has no token: it
 * is the in-process caller a job or an internal dispatch is, so its row drives
 * the SAME route (`handleActions` → `dispatchFlowAction`) with the system
 * execution context.
 */
async function startAs(caller: Caller, flow: Target, rowsOf: string = flow): Promise<Outcome> {
  const rowsBefore = await ledgerRows(rowsOf);
  const runsBefore = await runCount(flow);
  let answer: number;
  let code: string | undefined;
  if (caller === 'system') {
    const dispatcher = new HttpDispatcher(stack.kernel);
    const res = await dispatcher.handleActions(`/${WATCH}/${actionOf(flow)}`, 'POST', { params: {} }, {
      request: {},
      executionContext: { isSystem: true },
    } as never);
    answer = res.response?.status ?? 0;
    code = res.response?.body?.error?.code;
  } else {
    try {
      await stack.actions.run(WATCH, actionOf(flow), { as: caller === 'admin' ? admin : member });
      answer = 200;
    } catch (e) {
      answer = statusOf(e) ?? 0;
      code = codeOf(e);
    }
  }
  return {
    answer,
    ...(code !== undefined ? { code } : {}),
    rows: (await ledgerRows(rowsOf)) - rowsBefore,
    runs: (await runCount(flow)) - runsBefore,
  };
}

describe('control: the member cannot write the ledger directly', () => {
  it('a direct create is refused PERMISSION_DENIED / 403', async () => {
    let err: unknown;
    try {
      await stack.hooks.run(LEDGER, 'insert', { name: 'direct' }, { as: member });
    } catch (e) {
      err = e;
    }
    expect(codeOf(err)).toBe('PERMISSION_DENIED');
    expect(statusOf(err)).toBe(403);
    expect(await ledgerRows('direct')).toBe(0);
  });

  it('the member is not the system principal', async () => {
    const ec = await stack.contextFor(member);
    expect(ec.isSystem).not.toBe(true);
  });
});

const RAN = { answer: 200, rows: 1, runs: 1 } as const;

/**
 * Caller × flow → what the action door answers and what the request caused,
 * MEASURED BEFORE the door asked anything of the caller (this branch's first
 * commit carries these readings as the assertions).
 */
const TABLE: Array<{ caller: Caller; flow: Target; rowsOf?: string; outcome: Outcome }> = [
  { caller: 'member', flow: AUTO_SYS, outcome: RAN },
  { caller: 'member', flow: CHANGE_SYS, outcome: RAN },
  { caller: 'member', flow: SCHED_SYS, outcome: RAN },
  { caller: 'admin', flow: AUTO_SYS, outcome: RAN },
  { caller: 'admin', flow: CHANGE_SYS, outcome: RAN },
  { caller: 'admin', flow: SCHED_SYS, outcome: RAN },
  { caller: 'system', flow: AUTO_SYS, outcome: RAN },
  { caller: 'system', flow: CHANGE_SYS, outcome: RAN },
  { caller: 'system', flow: SCHED_SYS, outcome: RAN },
  { caller: 'member', flow: SCREEN_SYS, outcome: RAN },
  { caller: 'member', flow: API_SYS, outcome: RAN },
  { caller: 'member', flow: AUTO_USER, outcome: { answer: 400, code: 'FLOW_FAILED', rows: 0, runs: 1 } },
  { caller: 'member', flow: PARENT_SCREEN, rowsOf: AUTO_SYS, outcome: RAN },
];

describe('the action door × runAs: system, per type and caller', () => {
  for (const row of TABLE) {
    it(`${row.caller} starts ${row.flow} through its action → ${row.outcome.answer}`, async () => {
      expect(await startAs(row.caller, row.flow, row.rowsOf)).toEqual(row.outcome);
    });
  }
});
