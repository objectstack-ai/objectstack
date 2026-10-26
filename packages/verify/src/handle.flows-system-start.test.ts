// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23255 — `flows.run(name, params, { system: true })`: an app starts its own
 * self-triggered flow declared `runAs: 'system'` the way that flow's trigger
 * starts it, while the trigger door keeps refusing every caller.
 *
 * The trigger door (`POST /automation/:name/trigger`, which `flows.run` drives
 * for a `{ as }` caller) refuses a self-triggered elevated flow to anyone who
 * is not the system principal, the platform admin included, with
 * `PERMISSION_DENIED` / `403` (the runtime's `flow-start-admission.ts`). That
 * is right, and it stays. What a test lacked was the other start: the one the
 * schedule trigger's tick makes, the booted `automation` service's own
 * `execute`, with no caller in the context. The system arm is that call.
 *
 * Every claim is read off what only the real engine produces: the elevated
 * ledger row the writer flow creates (an object a member may not write), and
 * the run log. Each start is measured against its negative control, the SAME
 * call `as` a member and `as` the platform admin, which the door refuses
 * before anything runs.
 *
 * ⚠️ This suite resolves `@objectstack/runtime` and
 * `@objectstack/service-automation` through their BUILT `dist/`. Rebuild both
 * before trusting a run of this file.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import type { Flow } from '@objectstack/spec/automation';

import { bootStack, type VerifyStack } from './harness.js';
import { isVerifyRefusal, type FlowRun } from './handle.js';

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;

const LEDGER = 'fss_ledger';
const WATCH = 'fss_watch';

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

/** start → create_record(fss_ledger, { name }) → end. */
function writer(
  name: string,
  type: Flow['type'],
  startConfig?: Record<string, unknown>,
  fields: Record<string, unknown> = { name },
): Flow {
  return {
    name,
    label: name,
    type,
    status: 'active',
    runAs: 'system',
    nodes: [
      { id: 'start', type: 'start', label: 'Start', ...(startConfig ? { config: startConfig } : {}) },
      { id: 'write', type: 'create_record', label: 'Write', config: { objectName: LEDGER, fields } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'write' },
      { id: 'e2', source: 'write', target: 'end' },
    ],
  } as Flow;
}

// A cadence nobody reaches during a test run, and a watched object nobody
// writes: each flow below runs only when this file starts it.
const SCHEDULE = { schedule: { cron: '0 3 1 1 *' } };
const SCHED = 'fss_sched_sys';
const AUTO = 'fss_auto_sys';
const CHANGE = 'fss_change_sys';
/** A scheduled writer whose write the ledger refuses (its required `name` is never set). */
const SCHED_FAILS = 'fss_sched_fails';
/** A scheduled writer that takes its row's name from a seed (`params.tag`). */
const SCHED_SEEDED = 'fss_sched_seeded';
/** start → screen (pauses) → create_record(name from the screen) → end, declared elevated. */
const SCREEN = 'fss_screen_sys';

const FLOWS: Flow[] = [
  writer(SCHED, 'schedule', SCHEDULE),
  writer(AUTO, 'autolaunched'),
  writer(CHANGE, 'record_change', { objectName: WATCH, triggerType: 'record-after-update' }),
  writer(SCHED_FAILS, 'schedule', SCHEDULE, {}),
  {
    ...writer(SCHED_SEEDED, 'schedule', SCHEDULE, { name: { dialect: 'cel', source: 'tag' } }),
    variables: [{ name: 'tag', type: 'text', isInput: true }],
  } as Flow,
  {
    name: SCREEN,
    label: SCREEN,
    type: 'screen',
    status: 'active',
    runAs: 'system',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      {
        id: 'ask',
        type: 'screen',
        label: 'Name',
        config: { title: 'Name the row', fields: [{ name: 'row_name', label: 'Row name', type: 'text', required: true }] },
      },
      {
        id: 'write',
        type: 'create_record',
        label: 'Write',
        config: { objectName: LEDGER, fields: { name: { dialect: 'cel', source: 'row_name' } } },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'ask' },
      { id: 'e2', source: 'ask', target: 'write' },
      { id: 'e3', source: 'write', target: 'end' },
    ],
  } as Flow,
];

const fixtureStack = defineStack({
  manifest: {
    id: 'com.objectstack.verify.flows-system-start',
    namespace: 'fss',
    version: '0.0.0',
    type: 'app',
    name: 'Flows System Start Fixture',
    description: 'One ungranted object and elevated writer flows started as the system principal.',
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
  // The first user is the seeded dev admin, so this sign-up is a plain member.
  member = await stack.signUp('fss-member@verify.test');
}, BOOT_TIMEOUT);

afterAll(async () => {
  await stack?.stop().catch(() => undefined);
});

const codeOf = (e: unknown): string | undefined => (e as any)?.code;
const statusOf = (e: unknown): number | undefined => (e as any)?.statusCode ?? (e as any)?.status;

/** Ledger rows named `name` so far. */
async function ledgerRows(name: string): Promise<number> {
  return (await stack.rows(LEDGER, { name })).length;
}

/** Run-log entries the engine holds for `flow`. */
async function runCount(flow: string): Promise<number> {
  const automation = stack.kernel.getService('automation') as { listRuns(name: string): Promise<unknown[]> };
  return (await automation.listRuns(flow)).length;
}

/** Run `fn` and measure the ledger rows named `rowName` and the runs of `flow` it caused. */
async function measure<T>(flow: string, rowName: string, fn: () => Promise<T>) {
  const rowsBefore = await ledgerRows(rowName);
  const runsBefore = await runCount(flow);
  let value: T | undefined;
  let error: unknown;
  try {
    value = await fn();
  } catch (e) {
    error = e;
  }
  return {
    value,
    error,
    rows: (await ledgerRows(rowName)) - rowsBefore,
    runs: (await runCount(flow)) - runsBefore,
  };
}

describe('control: the member cannot write the ledger directly', () => {
  it('a direct create is refused PERMISSION_DENIED / 403', async () => {
    const { error, rows } = await measure(SCHED, 'direct', () =>
      stack.hooks.run(LEDGER, 'insert', { name: 'direct' }, { as: member }),
    );
    expect(codeOf(error)).toBe('PERMISSION_DENIED');
    expect(statusOf(error)).toBe(403);
    expect(rows).toBe(0);
  });
});

describe('a self-triggered elevated flow starts through the system arm; the same call as a person is refused', () => {
  for (const flow of [SCHED, AUTO, CHANGE]) {
    it(`${flow}: { system: true } runs it, and its elevated write lands`, async () => {
      const { value, error, rows, runs } = await measure(flow, flow, () => stack.flows.run(flow, {}, { system: true }));
      expect(error).toBeUndefined();
      expect(value?.success).toBe(true);
      expect(value?.flowName).toBe(flow);
      expect(rows).toBe(1);
      expect(runs).toBe(1);
    });

    for (const caller of ['member', 'admin'] as const) {
      it(`${flow}: the same call as the ${caller} answers 403 PERMISSION_DENIED, and nothing runs`, async () => {
        const token = caller === 'admin' ? admin : member;
        const { value, error, rows, runs } = await measure(flow, flow, () => stack.flows.run(flow, {}, { as: token }));
        expect(value).toBeUndefined();
        expect(isVerifyRefusal(error)).toBe(true);
        expect(codeOf(error)).toBe('PERMISSION_DENIED');
        expect(statusOf(error)).toBe(403);
        expect(rows).toBe(0);
        expect(runs).toBe(0);
      });
    }
  }
});

describe('what the system arm hands the engine, and what it hands back', () => {
  it('passes `params` through as the run\'s seeds', async () => {
    const tag = 'seeded-by-the-test';
    const { value, rows, runs } = await measure(SCHED_SEEDED, tag, () =>
      stack.flows.run(SCHED_SEEDED, { tag }, { system: true }),
    );
    expect(value?.success).toBe(true);
    expect(rows).toBe(1);
    expect(runs).toBe(1);
  });

  it('hands back a failed run as the engine answered it: success false, status failed, nothing written', async () => {
    const { value, error, rows, runs } = await measure(SCHED_FAILS, SCHED_FAILS, () =>
      stack.flows.run(SCHED_FAILS, {}, { system: true }),
    );
    expect(error).toBeUndefined();
    expect(value?.success).toBe(false);
    expect(value?.status).toBe('failed');
    expect(value?.flowName).toBe(SCHED_FAILS);
    expect(rows).toBe(0);
    expect(runs).toBe(1);
  });

  it('hands back an unknown flow as the engine answered it: success false, no code, nothing run', async () => {
    const name = 'fss_no_such_flow';
    const { value, error, runs } = await measure(name, name, () => stack.flows.run(name, {}, { system: true }));
    expect(error).toBeUndefined();
    expect(value?.success).toBe(false);
    expect(value?.code).toBeUndefined();
    expect(value?.error).toContain(name);
    expect(runs).toBe(0);
  });

  it('returns a FlowRun flows.resume takes back: a paused run, resumed as a person, performs the write', async () => {
    const rowName = 'named-on-resume';
    const run: FlowRun = await stack.flows.run(SCREEN, {}, { system: true });
    expect(run.status).toBe('paused');
    expect(typeof run.runId).toBe('string');
    expect(run.flowName).toBe(SCREEN);
    expect(await ledgerRows(rowName)).toBe(0);

    const resumed = await stack.flows.resume(run, { row_name: rowName }, { as: admin });
    expect(resumed.success).toBe(true);
    expect(resumed.status).not.toBe('paused');
    expect(await ledgerRows(rowName)).toBe(1);
  });
});

describe('the call names ONE caller', () => {
  it('refuses { as, system } together with INVALID_REQUEST / 400, before anything runs', async () => {
    const { value, error, rows, runs } = await measure(SCHED, SCHED, () =>
      stack.flows.run(SCHED, {}, { as: admin, system: true } as never),
    );
    expect(value).toBeUndefined();
    expect(codeOf(error)).toBe('INVALID_REQUEST');
    expect(statusOf(error)).toBe(400);
    expect(rows).toBe(0);
    expect(runs).toBe(0);
  });
});
