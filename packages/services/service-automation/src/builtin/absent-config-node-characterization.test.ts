// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ⚠️ CHARACTERIZATION — this file RECORDS what the executor does today with a
 * node that carries **no config block at all**. It does **not** endorse it, and
 * a green run here is **not** a statement that the behaviour is correct.
 *
 * A later reader: every `expect` below is a photograph, not a contract. If the
 * behaviour is deliberately changed, **update the photograph** — a red here is
 * "the recorded behaviour moved", which may be exactly what a fix intends. The
 * one thing it must never do is drift *unnoticed*.
 *
 * **Why the photograph was taken (#17843).** `@objectstack/spec` ACCEPTS a
 * `wait` node whose `waitEventConfig` block is absent entirely — that is the
 * state a freshly created node is in — while it REFUSES a node whose block is
 * present with `eventType` omitted. So "block absent" is a document an author
 * can really save, and what it then DOES at run time had never been observed:
 * the question was answered from source, and this file is the observed run that
 * closes that gap. It measures both halves the card asked for, because they are
 * different execution branches and neither predicts the other:
 *
 *  - **`wait`** — the executor defaults `eventType` to `'timer'` on purpose (the
 *    `?? 'timer'` in `wait-node.ts` carries a comment saying a wait node without
 *    a config block is a valid timer wait), and the timer branch with no
 *    `timerDuration` computes no deadline: no wake-up job, no `waitUntil`, not
 *    one log line, and `success: true, suspend: true`. The run parks there until
 *    something external calls `resume(runId)`. ⭐ Recorded, not blessed:
 *    whether a duration-less timer wait should warn or refuse is a product
 *    question that belongs to a successor card, not to this file.
 *  - **`boundary_event`** — ⭐ the opposite shape, and the reason extrapolating
 *    from `wait` would have been wrong. No executor is registered for it at all
 *    (`installBuiltinNodes` seeds twelve packs, none of them this one; the
 *    README files it as BPMN *interop* representation rather than the native
 *    authoring model), so the run fails LOUDLY with `NO_EXECUTOR` before the
 *    config block is ever read — and it fails identically whether that block is
 *    absent or fully populated.
 */

import { describe, it, expect } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutionResult, NodeExecutor } from '../engine.js';
import { InMemorySuspendedRunStore } from '../suspended-run-store.js';
import { registerWaitNode } from './wait-node.js';
import { FlowNodeSchema } from '@objectstack/spec/automation';
import type { AutomationResult } from '@objectstack/spec/contracts';
import type { IJobService, JobHandler, JobSchedule } from '@objectstack/spec/contracts';

type LogLine = { level: string; text: string };

/**
 * Every level the `Logger` contract offers, funnelled into ONE ordered sink —
 * the engine's logger and the plugin ctx's logger are the same recorder, so
 * "did anything at all get logged" is answerable rather than "did the level I
 * happened to spy on get logged".
 */
function recordingLogger(sink: LogLine[]): PluginContext['logger'] {
  const at = (level: string) => (...args: unknown[]) => {
    sink.push({ level, text: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') });
  };
  const logger = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') };
  return { ...logger, child: () => logger } as unknown as PluginContext['logger'];
}

/** A job service that records what was scheduled — the instrument for "was a wake-up armed". */
function jobCtx(sink: LogLine[]) {
  const scheduled: Array<{ name: string; schedule: JobSchedule }> = [];
  const job: IJobService = {
    async schedule(name: string, schedule: JobSchedule, _handler: JobHandler) {
      scheduled.push({ name, schedule });
    },
    async cancel() {},
    async trigger() {},
  };
  const ctx = {
    logger: recordingLogger(sink),
    getService: (id: string) => (id === 'job' ? job : undefined),
  } as unknown as PluginContext;
  return { ctx, scheduled };
}

/** Records the order nodes ran, so "the run never got past the node" is observed, not assumed. */
function marker(ran: string[]): NodeExecutor {
  return { type: 'mark', async execute(node) { ran.push(node.id); return { success: true }; } };
}

/**
 * start → before(mark) → <the node under measurement> → after(mark) → end.
 *
 * `before` proves the run REACHED the node; `after` proves whether it got past
 * it. Without those two the readings below would be compatible with a flow that
 * never ran at all.
 */
const flowWith = (node: Record<string, unknown>) => ({
  name: 'f',
  label: 'F',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'before', type: 'mark', label: 'Before' },
    node,
    { id: 'after', type: 'mark', label: 'After' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e0', source: 'start', target: 'before' },
    { id: 'e1', source: 'before', target: String(node.id) },
    { id: 'e2', source: String(node.id), target: 'after' },
    { id: 'e3', source: 'after', target: 'end' },
  ],
});

/**
 * One real, engine-driven run of a `wait` node, reporting every channel the
 * measurement needs.
 *
 * The executor's own return value is captured by wrapping the executor
 * `registerWaitNode` publishes — the value recorded is the one the ENGINE
 * received from a genuine run, never a second invocation staged by the test.
 */
async function runWaitNode(node: Record<string, unknown>) {
  const logs: LogLine[] = [];
  const ran: string[] = [];
  const engine = new AutomationEngine(recordingLogger(logs));
  const store = new InMemorySuspendedRunStore();
  engine.setSuspendedRunStore(store);
  engine.registerNodeExecutor(marker(ran));

  const { ctx, scheduled } = jobCtx(logs);
  let returned: NodeExecutionResult | undefined;
  const realRegister = engine.registerNodeExecutor.bind(engine);
  const patchable = engine as unknown as { registerNodeExecutor: (e: NodeExecutor) => void };
  patchable.registerNodeExecutor = (exec: NodeExecutor) => {
    if (exec.type !== 'wait') return realRegister(exec);
    const inner = exec.execute.bind(exec);
    return realRegister({
      ...exec,
      async execute(n, v, c) { const r = await inner(n, v, c); returned = r; return r; },
    });
  };
  registerWaitNode(engine, ctx);
  delete (engine as unknown as Record<string, unknown>).registerNodeExecutor;

  engine.registerFlow('f', flowWith(node));
  // Production seals the vocabulary at `kernel:bootstrapped`
  // (`AutomationServicePlugin`); sealing here keeps the engine's own
  // "never sealed" warning out of the window, so a log line seen during the run
  // is one the NODE produced.
  engine.sealNodeTypeVocabulary();
  const from = logs.length;
  const result = await engine.execute('f');
  return {
    result,
    returned,
    scheduled,
    suspended: engine.listSuspendedRuns(),
    stored: await store.list(),
    logsDuringRun: logs.slice(from),
    ran,
  };
}

/** One real, engine-driven run of a node whose type has no executor registered. */
async function runUnexecutableNode(node: Record<string, unknown>) {
  const logs: LogLine[] = [];
  const ran: string[] = [];
  const engine = new AutomationEngine(recordingLogger(logs));
  engine.registerNodeExecutor(marker(ran));
  registerWaitNode(engine, jobCtx(logs).ctx);
  engine.registerFlow('f', flowWith(node));

  const beforeSeal = logs.length;
  engine.sealNodeTypeVocabulary();
  const sealLogs = logs.slice(beforeSeal);

  const from = logs.length;
  const result = await engine.execute('f');
  return { result, registeredTypes: engine.getRegisteredNodeTypes(), sealLogs, logsDuringRun: logs.slice(from), ran };
}

const nodeStatus = (result: AutomationResult, nodeId: string) =>
  result.summary?.nodes?.find((n) => n.nodeId === nodeId)?.status;

/**
 * The premise, pinned: the documents measured below are ones an author can
 * really save. Without this leg the readings are untethered — if the spec ever
 * starts refusing a block-less node, this whole file characterizes a document
 * that can no longer exist, and its reader must be told that rather than left
 * reading run-time behaviour for an unreachable input.
 */
describe('premise (#17843) — the parse contract ACCEPTS a node with no config block', () => {
  const parse = (node: Record<string, unknown>) => FlowNodeSchema.safeParse(node);

  it('accepts a `wait` node with no `waitEventConfig` at all, and refuses one whose block omits `eventType`', () => {
    expect(parse({ id: 'pause', type: 'wait', label: 'Wait' }).success).toBe(true);
    // The boundary the measurement turns on: "omitted key inside a present
    // block" and "block absent" are different documents with different verdicts.
    expect(parse({ id: 'pause', type: 'wait', label: 'Wait', waitEventConfig: {} }).success).toBe(false);
  });

  it('accepts a `boundary_event` node with no `boundaryConfig` at all', () => {
    expect(parse({ id: 'b', type: 'boundary_event', label: 'Boundary' }).success).toBe(true);
  });
});

describe('characterization (#17843) — a `wait` node with NO config block at all · recorded, NOT endorsed', () => {
  it('defaults to a timer, arms nothing, writes no deadline and says nothing — and the run parks there', async () => {
    const m = await runWaitNode({ id: 'pause', type: 'wait', label: 'Wait' });

    // The run really reached the node and really stopped at it.
    expect(m.ran, 'the run must have reached the wait node').toEqual(['before']);
    expect(m.result.status).toBe('paused');
    expect(m.result.success).toBe(true);
    expect(m.suspended).toHaveLength(1);

    // ① The executor's return value, verbatim. ⚠️ `output` is a PRESENT key
    //    carrying `undefined` — not an absent one (`toStrictEqual`, because a
    //    plain `toEqual` cannot tell those two apart, and a JSON dump of this
    //    object drops the key entirely and reads as the second).
    expect(m.returned).toStrictEqual({
      success: true, suspend: true, correlation: 'timer:pause', output: undefined,
    });
    expect(m.returned?.output, 'nothing to write: no deadline was computed').toBeUndefined();

    // ② No wake-up job was scheduled, though a job service WAS available —
    //    which is what makes the silence below unconditional rather than a
    //    consequence of a job-less host.
    expect(m.scheduled).toEqual([]);

    // ③ No `waitUntil` is written, so a later cold boot's re-arm pass
    //    (`rearmSuspendedWaitTimers`) skips this run as "not a timer wait".
    const vars = (m.stored[0]?.variables ?? {}) as Record<string, unknown>;
    expect(Object.keys(vars).filter((k) => k.endsWith('.waitUntil'))).toEqual([]);

    // ④ ⭐ Not one log line — no `warn`, no `error`, nothing at any level.
    expect(m.logsDuringRun, 'the node emits nothing an operator could see').toEqual([]);

    // ⇒ the correlation is a bare `timer:<nodeId>`, which arms nothing and which
    //    `onSuspensionReleased` deliberately does not treat as a job name. The
    //    only exit from this pause is an external `resume(runId)`.
    expect(m.suspended[0]).toMatchObject({ nodeId: 'pause', correlation: 'timer:pause' });
  });

  it('CONTROL — the same node WITH `eventType: timer` + `timerDuration` behaves differently on every channel', async () => {
    const control = await runWaitNode({
      id: 'pause', type: 'wait', label: 'Wait',
      waitEventConfig: { eventType: 'timer', timerDuration: 'PT1H' },
    });
    const absent = await runWaitNode({ id: 'pause', type: 'wait', label: 'Wait' });

    // A wake-up job IS armed, one shot, ~1h out.
    expect(control.scheduled).toHaveLength(1);
    expect(control.scheduled[0].schedule.type).toBe('once');

    // …and the deadline IS persisted, under the key the re-arm pass reads.
    const controlVars = (control.stored[0]?.variables ?? {}) as Record<string, unknown>;
    expect(typeof controlVars['pause.waitUntil']).toBe('string');
    expect(control.returned?.output).toEqual({ waitUntil: controlVars['pause.waitUntil'] });

    // The correlation is the JOB's name here, the inert `timer:<nodeId>` there.
    expect(control.returned?.correlation).toBe(control.scheduled[0].name);
    expect(control.returned?.correlation).not.toBe(absent.returned?.correlation);

    // ⇒ the instrument discriminates: every channel that read zero above reads
    //    non-zero here, so the zeros are a reading of the absent-config path and
    //    not of a harness that measures nothing.
    expect([absent.scheduled.length, control.scheduled.length]).toEqual([0, 1]);
    expect([
      Object.keys((absent.stored[0]?.variables ?? {}) as Record<string, unknown>).some((k) => k.endsWith('.waitUntil')),
      Object.keys(controlVars).some((k) => k.endsWith('.waitUntil')),
    ]).toEqual([false, true]);

    // Both halves park the run, so "paused" is the one thing that does NOT
    // discriminate — recorded so a reader does not mistake it for a signal.
    expect([absent.result.status, control.result.status]).toEqual(['paused', 'paused']);
  });
});

describe('characterization (#17843) — a `boundary_event` node · a DIFFERENT branch from `wait`, measured separately', () => {
  it('fails the run loudly with NO_EXECUTOR — nothing is registered for the type, silent suspension never enters it', async () => {
    const m = await runUnexecutableNode({ id: 'b', type: 'boundary_event', label: 'Boundary' });

    // The premise: the platform ships no `boundary_event` executor.
    expect(m.registeredTypes).not.toContain('boundary_event');

    // The run reached the node (`before` ran) and did NOT get past it.
    expect(m.ran).toEqual(['before']);

    // ⭐ Loud, not silent — the opposite of the `wait` half above.
    expect(m.result.success).toBe(false);
    expect(m.result.status).toBe('failed');
    expect(m.result.error).toBe("No executor registered for node type 'boundary_event'");
    expect(nodeStatus(m.result, 'b')).toBe('failure');

    // Loud TWICE: sealing the vocabulary names the type before any run.
    expect(m.sealLogs.some((l) => l.level === 'warn' && l.text.includes('boundary_event'))).toBe(true);
    // …and the run itself is reported, rather than passing unremarked.
    expect(m.logsDuringRun.some((l) => l.text.includes('status=failed'))).toBe(true);
  });

  it('CONTROL — a fully populated `boundaryConfig` fails identically ⇒ the config block is never consulted', async () => {
    const populated = await runUnexecutableNode({
      id: 'b', type: 'boundary_event', label: 'Boundary',
      boundaryConfig: {
        attachedToNodeId: 'before', eventType: 'timer', timerDuration: 'PT1H', interrupting: true,
      },
    });

    expect(populated.result.success).toBe(false);
    expect(populated.result.error).toBe("No executor registered for node type 'boundary_event'");
    expect(populated.ran).toEqual(['before']);
    // ⇒ presence or absence of the block changes NOTHING here: the dispatch
    //    fails before any executor could read it. Which is exactly why the
    //    `wait` reading could not have been extrapolated onto this type.
  });

  it('CONTROL — the identical flow with a REGISTERED type in that slot runs to completion', async () => {
    const ok = await runUnexecutableNode({ id: 'b', type: 'mark', label: 'Marker in the boundary slot' });

    expect(ok.result.success).toBe(true);
    expect(ok.result.status).not.toBe('failed');
    // ⇒ the flow shape and the harness are sound; the failure above is the
    //    node type, not the fixture.
    expect(ok.ran).toEqual(['before', 'b', 'after']);
  });
});
