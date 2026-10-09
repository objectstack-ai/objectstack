// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The trigger door × a flow declared `runAs: 'system'`, per flow type and per
 * caller, through `flows.run` — the in-process twin of
 * `POST /api/v1/automation/:name/trigger` (`handle.ts` drives the runtime's
 * `HttpDispatcher`, so it answers through the same `respondToFlowTrigger`).
 *
 * The maintainer's ruling (letter B) on the defect class "a self-triggered flow
 * declared to run as system could be started by any signed-in member through
 * the trigger door": a caller that is not the system principal may not start a
 * `runAs: 'system'` flow whose type is `autolaunched`, `record_change` or
 * `schedule`. `screen` and `api` flows, a parent flow's `subflow` call and the
 * system principal are unchanged.
 *
 * This is the wire half, on the real kernel — auth, security middleware, the
 * real automation engine — so every row is a measurement, not a scripted
 * service: the door's answer, the elevated write that did or did not land, and
 * the run log. The door-side pins, one per arm with a scripted service, are
 * `packages/runtime/src/domains/automation-trigger-elevated-door.test.ts`.
 *
 * The table was MEASURED FIRST, before the door check existed (the branch's
 * first commit carries it as the assertion); each row's `before` comment is
 * that reading, so the change the check makes is visible row by row.
 *
 * The fixture is neutral: one object no fresh member is granted (`etd_ledger`;
 * a member's direct create on it is refused, which the first case pins as the
 * control that makes every elevated write below meaningful), and one writer
 * flow per type, each creating a ledger row named after itself. A row
 * appearing is the side effect of the elevated run; the run log is the other
 * witness.
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
import { isVerifyRefusal } from './handle.js';

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;

const LEDGER = 'etd_ledger';
const WATCH = 'etd_watch';

/** Granted to nobody but the platform admin: a member's direct create is refused. */
const Ledger = ObjectSchema.create({
  name: LEDGER,
  sharingModel: 'public_read_write',
  label: 'Ledger',
  pluralLabel: 'Ledgers',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

/** The object the record-change writer watches. Nothing in this file writes it. */
const Watch = ObjectSchema.create({
  name: WATCH,
  sharingModel: 'public_read_write',
  label: 'Watch',
  pluralLabel: 'Watches',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

/** start → create_record(etd_ledger, { name: <flow name> }) → end. */
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

const AUTO_SYS = 'etd_auto_sys';
const CHANGE_SYS = 'etd_change_sys';
const SCHED_SYS = 'etd_sched_sys';
const SCREEN_SYS = 'etd_screen_sys';
const API_SYS = 'etd_api_sys';
const AUTO_USER = 'etd_auto_user';
const PARENT_USER = 'etd_parent_user';

const FLOWS: Flow[] = [
  writer(AUTO_SYS, 'autolaunched', 'system'),
  // A cadence nobody reaches during a test run, and a watched object nobody writes:
  // each of these two runs only when the door starts it.
  writer(CHANGE_SYS, 'record_change', 'system', { objectName: WATCH, triggerType: 'record-after-update' }),
  writer(SCHED_SYS, 'schedule', 'system', { schedule: { cron: '0 3 1 1 *' } }),
  writer(SCREEN_SYS, 'screen', 'system'),
  // ADR-0041: an `api` flow registers only with its per-flow secret.
  writer(API_SYS, 'api', 'system', { secret: 'etd-fixture-secret' }),
  writer(AUTO_USER, 'autolaunched', 'user'),
  // The platform's own pattern for an elevated write: a non-elevated parent
  // whose `subflow` node calls the elevated child. The child writes its own name.
  {
    name: PARENT_USER,
    label: PARENT_USER,
    type: 'autolaunched',
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

const fixtureStack = defineStack({
  manifest: {
    id: 'com.objectstack.verify.elevated-trigger-door',
    namespace: 'etd',
    version: '0.0.0',
    type: 'app',
    name: 'Elevated Trigger Door Fixture',
    description: 'One ungranted object and one elevated writer flow per flow type.',
  },
  // ADR-0097: the record-change start node needs both capabilities.
  requires: ['automation', 'triggers'],
  objects: [Ledger, Watch],
  flows: FLOWS,
} as never);

let stack: VerifyStack;
let admin: string;
let member: string;

beforeAll(async () => {
  stack = await bootStack(fixtureStack as never, { automation: true });
  admin = await stack.signIn();
  // The first user is the seeded dev admin, so this sign-up is a plain member:
  // no permission set of the app's, only the platform's fallback baseline.
  member = await stack.signUp('etd-member@verify.test');
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
 * Start `flow` through the door as `caller` and measure what happened.
 *
 * `member` and `admin` go through `flows.run` with a bearer token, exactly as a
 * console or SDK reaches the door. The system principal has no token: it is
 * the in-process caller a job or an internal dispatch is, so its row drives
 * the SAME route (`handleAutomation` → `respondToFlowTrigger`) with the
 * system execution context.
 */
async function startAs(caller: Caller, flow: string, rowsOf: string = flow): Promise<Outcome> {
  const rowsBefore = await ledgerRows(rowsOf);
  const runsBefore = await runCount(flow);
  let answer: number;
  let code: string | undefined;
  if (caller === 'system') {
    const dispatcher = new HttpDispatcher(stack.kernel);
    const res = await dispatcher.handleAutomation(`/${flow}/trigger`, 'POST', { params: {} }, {
      request: {},
      executionContext: { isSystem: true },
    } as never);
    answer = res.response?.status ?? 0;
    code = res.response?.body?.error?.code;
  } else {
    try {
      await stack.flows.run(flow, {}, { as: caller === 'admin' ? admin : member });
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

const REFUSED = { answer: 403, code: 'PERMISSION_DENIED', rows: 0, runs: 0 } as const;
const RAN = { answer: 200, rows: 1, runs: 1 } as const;

/**
 * Caller × flow → what the door answers and what the request caused. `before`
 * is the reading taken on this branch before the door check existed.
 */
const TABLE: Array<{ caller: Caller; flow: string; rowsOf?: string; outcome: Outcome; before: string }> = [
  // REFUSED — a signed-in member, the three self-triggered types.
  { caller: 'member', flow: AUTO_SYS, outcome: REFUSED, before: '200, elevated row written' },
  { caller: 'member', flow: CHANGE_SYS, outcome: REFUSED, before: '200, elevated row written' },
  { caller: 'member', flow: SCHED_SYS, outcome: REFUSED, before: '200, elevated row written' },
  // REFUSED — the platform admin is a signed-in user too, not the system principal.
  { caller: 'admin', flow: AUTO_SYS, outcome: REFUSED, before: '200, row written' },
  { caller: 'admin', flow: CHANGE_SYS, outcome: REFUSED, before: '200, row written' },
  { caller: 'admin', flow: SCHED_SYS, outcome: REFUSED, before: '200, row written' },
  // UNCHANGED — the system principal starts each refused type.
  { caller: 'system', flow: AUTO_SYS, outcome: RAN, before: '200, row written' },
  { caller: 'system', flow: CHANGE_SYS, outcome: RAN, before: '200, row written' },
  { caller: 'system', flow: SCHED_SYS, outcome: RAN, before: '200, row written' },
  // UNCHANGED — `screen` and `api`: doors the author designed.
  { caller: 'member', flow: SCREEN_SYS, outcome: RAN, before: '200, elevated row written' },
  { caller: 'member', flow: API_SYS, outcome: RAN, before: '200, elevated row written' },
  // UNCHANGED — a non-elevated flow: the member's own identity is refused the write.
  {
    caller: 'member',
    flow: AUTO_USER,
    outcome: { answer: 400, code: 'FLOW_FAILED', rows: 0, runs: 1 },
    before: '400 FLOW_FAILED, nothing written',
  },
  // UNCHANGED — the platform's pattern for an elevated write: the member starts
  // the non-elevated parent, whose `subflow` node runs the elevated child that
  // the door now refuses to start directly. The child writes its own name.
  { caller: 'member', flow: PARENT_USER, rowsOf: AUTO_SYS, outcome: RAN, before: '200, elevated child row written' },
];

describe('the trigger door × runAs: system, per type and caller', () => {
  for (const row of TABLE) {
    const verdict = row.outcome.answer === 403 ? 'refused 403 PERMISSION_DENIED, nothing ran' : `answers ${row.outcome.answer}`;
    it(`${row.caller} starts ${row.flow}: ${verdict} (before: ${row.before})`, async () => {
      expect(await startAs(row.caller, row.flow, row.rowsOf)).toEqual(row.outcome);
    });
  }
});

describe('the refusal envelope at the wire', () => {
  it('carries the ADR-0112 code and status, and nothing of the flow', async () => {
    let err: unknown;
    try {
      await stack.flows.run(SCHED_SYS, {}, { as: member });
    } catch (e) {
      err = e;
    }
    expect(isVerifyRefusal(err)).toBe(true);
    expect(codeOf(err)).toBe('PERMISSION_DENIED');
    expect(statusOf(err)).toBe(403);
    const message = (err as Error).message;
    expect(message).not.toContain(SCHED_SYS);
    expect(message).not.toMatch(/schedule|runAs|'system'/);
  });
});
