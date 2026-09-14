// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ⚠️ WAS A CHARACTERIZATION — **flipped**, and the reversal is the point of the
 * file now.
 *
 * It was written to RECORD what the executor did with a node carrying **no
 * config block at all**, explicitly not endorsing it: "every `expect` below is a
 * photograph, not a contract. If the behaviour is deliberately changed, update
 * the photograph — a red here is 'the recorded behaviour moved', which may be
 * exactly what a fix intends." That is what happened. The photograph it took —
 * a `wait` node with no `waitEventConfig` running to `{ success: true, suspend:
 * true }`, with no job armed though a job service was ANSWERING, no `waitUntil`
 * persisted, and **zero log lines at any level** — is the measurement that
 * carried the defect card, and the behaviour has been deliberately reversed.
 *
 * ## What moved, on each channel the old file measured
 *
 * | channel                 | recorded before                 | pinned now                                   |
 * | ----------------------- | ------------------------------- | -------------------------------------------- |
 * | the parse               | block-less `wait` ACCEPTED      | REFUSED, naming `waitEventConfig`            |
 * | `engine.execute()`      | `{ success: true, suspend: true }` | run FAILS, node status `failure`          |
 * | suspended runs          | one, parked forever             | none — the run never suspends                 |
 * | log lines during the run| **0 at any level**              | a `warn` naming the node and the remedy       |
 * | `output` on the return  | present key holding `undefined` | absent (the timer branch computes no deadline)|
 *
 * The ruling behind the direction (decision batch #127 item 5, maintainer,
 * verbatim and untranslated): 「16678 具体解释，计划用哪个字段判断经理。其他同意」
 * — carrying the presented option: the protocol is the source of truth, a
 * designer never invents a default the protocol does not apply, and **a required
 * key has no "unset behaves as"**. Triage's alternative on the closed duplicate
 * (warn and keep parsing) was considered and NOT taken.
 *
 * ## What did NOT move, and is still recorded here rather than re-derived
 *
 *  - **`boundary_event`** — the opposite shape, and the reason extrapolating
 *    from `wait` would have been wrong. No executor is registered for it at all
 *    (`installBuiltinNodes` seeds twelve packs, none of them this one; the
 *    README files it as BPMN *interop* representation rather than the native
 *    authoring model), so a run fails LOUDLY with `NO_EXECUTOR` before any
 *    config block is read — and it fails identically whether that block is
 *    absent or fully populated. ⇒ the executor side had nothing to change for
 *    it; only the parse door moved, which is why its fixtures below now carry
 *    the block they are required to carry.
 *  - **a paused run still emits no run-level log line.** Paused is not
 *    terminal, so the #4354 run-summary line is not owed and is not printed.
 *    Left as it was — deliberately, and re-recorded here so the next reader does
 *    not fold it into the silence this card closed. The silence that MATTERED
 *    was a node that could never wake saying nothing; a legitimate pause that
 *    says nothing is a different question.
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
 *
 * `stripBlockAfterRegistration` is how a BLOCK-LESS node reaches `execute` now
 * that the contract refuses it: `registerFlow` parses, so the only documents
 * that can still arrive without the block are STORED ones that reached the
 * executor by a path which did not re-parse them. Removing the block from the
 * registered (already parsed) flow is that document, staged at the one seam
 * where it is reproducible — and it keeps the ENGINE in the loop, so the run's
 * status, its suspension ledger and its log stream are all still real readings
 * rather than a direct call to `execute`.
 */
async function runWaitNode(node: Record<string, unknown>, stripBlockAfterRegistration = false) {
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
  if (stripBlockAfterRegistration) {
    const flows = (engine as unknown as { flows: Map<string, { nodes: Array<Record<string, unknown>> }> }).flows;
    const stored = flows.get('f')!;
    const target = stored.nodes.find((n) => n.id === node.id)!;
    delete target.waitEventConfig;
    expect(target.waitEventConfig, 'the staged document really has no block').toBeUndefined();
  }
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

/** The declared block a `wait` node must now carry to parse at all. */
const TIMER_BLOCK = { eventType: 'timer', timerDuration: 'PT1H' } as const;

/**
 * ⛔ REVERSED. This block used to assert that the parse contract ACCEPTS a node
 * with no config block — it was the premise leg, there so a reader could tell
 * "measured behaviour of a saveable document" from "measured behaviour of an
 * unreachable input". The document is no longer saveable, and that IS the fix,
 * so the leg now pins the refusal in the same position.
 */
describe('premise — the parse contract REFUSES a node with no config block', () => {
  const parse = (node: Record<string, unknown>) => FlowNodeSchema.safeParse(node);

  it('refuses a `wait` node with no `waitEventConfig` at all, as it already refused one whose block omits `eventType`', () => {
    const bare = parse({ id: 'pause', type: 'wait', label: 'Wait' });
    expect(bare.success).toBe(false);
    expect(bare.error!.issues.map((i) => i.path.join('.'))).toContain('waitEventConfig');
    // The boundary the OLD measurement turned on — "omitted key inside a present
    // block" vs "block absent" — has closed: two documents, ONE verdict now.
    expect(parse({ id: 'pause', type: 'wait', label: 'Wait', waitEventConfig: {} }).success).toBe(false);
    // CONTROL — the declared node still parses, so the refusals above are the
    // missing contract and not a schema that stopped accepting `wait` at all.
    expect(parse({ id: 'pause', type: 'wait', label: 'Wait', waitEventConfig: TIMER_BLOCK }).success).toBe(true);
  });

  it('refuses a `boundary_event` node with no `boundaryConfig` at all', () => {
    const bare = parse({ id: 'b', type: 'boundary_event', label: 'Boundary' });
    expect(bare.success).toBe(false);
    expect(bare.error!.issues.map((i) => i.path.join('.'))).toContain('boundaryConfig');
  });
});

describe('a STORED `wait` node that reaches execute with no config block · the reversal', () => {
  it('fails the run with a named, LOGGED refusal — never a silent suspension reporting success', async () => {
    const m = await runWaitNode({ id: 'pause', type: 'wait', label: 'Wait', waitEventConfig: TIMER_BLOCK }, true);

    // The run really reached the node and really stopped at it.
    expect(m.ran, 'the run must have reached the wait node').toEqual(['before']);

    // ① ⭐ The whole reversal, on the run's own verdict.
    expect(m.result.success).toBe(false);
    expect(m.result.status).toBe('failed');
    expect(nodeStatus(m.result, 'pause')).toBe('failure');
    expect(m.result.status).not.toBe('paused');

    // ② The executor's return value: a guard refusal, so a `fault` edge cannot
    //    route a metadata defect into a handler that then reports success.
    expect(m.returned?.success).toBe(false);
    expect(m.returned?.errorClass).toBe('guard');
    expect(m.returned?.suspend).toBeUndefined();
    expect(m.returned?.error).toContain('waitEventConfig');
    expect(m.returned?.error).toContain('pause');

    // ③ Nothing was parked: the suspension ledger and the durable store are both
    //    empty, where the old behaviour left one entry in each.
    expect(m.suspended).toEqual([]);
    expect(m.stored).toEqual([]);
    expect(m.scheduled).toEqual([]);

    // ④ ⭐ The silence is gone. The old reading here was `[]` — not one line at
    //    any level — and it is what made the hang unobservable.
    expect(m.logsDuringRun.length).toBeGreaterThan(0);
    const named = m.logsDuringRun.find((l) => l.level === 'warn' && l.text.includes("node 'pause'"));
    expect(named, 'the refusal names the node in the log, not only in the step record').toBeDefined();
    expect(named!.text).toContain('waitEventConfig');
    // The remedy travels with the complaint — an operator reading only this line
    // can fix the flow from it.
    expect(named!.text).toContain("eventType: 'timer'");
  });

  it('CONTROL — the same flow, block INTACT, still suspends and arms its timer', async () => {
    const control = await runWaitNode({ id: 'pause', type: 'wait', label: 'Wait', waitEventConfig: TIMER_BLOCK });

    // A wake-up job IS armed, one shot, ~1h out…
    expect(control.scheduled).toHaveLength(1);
    expect(control.scheduled[0].schedule.type).toBe('once');
    // …the deadline IS persisted, under the key the re-arm pass reads…
    const vars = (control.stored[0]?.variables ?? {}) as Record<string, unknown>;
    expect(typeof vars['pause.waitUntil']).toBe('string');
    expect(control.returned?.output).toEqual({ waitUntil: vars['pause.waitUntil'] });
    // …and the run parks, successfully, exactly as before this change.
    expect(control.result.status).toBe('paused');
    expect(control.result.success).toBe(true);
    expect(control.suspended).toHaveLength(1);

    // ⇒ the instrument discriminates: every channel that reads non-zero here
    //    reads the opposite above, so the failure above is the missing block and
    //    not a harness that fails everything.
  });

  it('a legitimate pause still emits no run-level summary line — deliberately unchanged', async () => {
    const control = await runWaitNode({ id: 'pause', type: 'wait', label: 'Wait', waitEventConfig: TIMER_BLOCK });
    // `paused` is not terminal, so the #4354 summary is not owed. Recorded so a
    // later reader does not mistake this silence for the one that was fixed:
    // the defect was a node that could NEVER wake saying nothing.
    expect(control.logsDuringRun.some((l) => l.text.includes('[automation] run'))).toBe(false);
  });

  it('the timer branch leaves `output` ABSENT when it computed no deadline', async () => {
    // A signal wait never computes one — the narrowest node that still reaches
    // a `return` with nothing to write. `toStrictEqual`, because a plain
    // `toEqual` cannot tell an absent key from one holding `undefined`, and the
    // old return carried the second (a JSON dump of it reads as the first,
    // which is how it went unnoticed).
    const m = await runWaitNode({
      id: 'pause', type: 'wait', label: 'Wait',
      waitEventConfig: { eventType: 'signal', signalName: 'order_paid' },
    });
    expect(m.returned).toStrictEqual({ success: true, suspend: true, correlation: 'order_paid' });
    expect(Object.keys(m.returned!)).not.toContain('output');
  });
});

describe('characterization — a `boundary_event` node · a DIFFERENT branch from `wait`, measured separately', () => {
  // ⛔ The fixtures below gained their `boundaryConfig`: a bare boundary node no
  //    longer registers. What they measure is unchanged, and the second case is
  //    the proof — the block is never consulted, so requiring it at the parse
  //    door moved nothing at the execute door.
  const BOUNDARY_BLOCK = { attachedToNodeId: 'before', eventType: 'error' } as const;

  it('fails the run loudly with NO_EXECUTOR — nothing is registered for the type, silent suspension never enters it', async () => {
    const m = await runUnexecutableNode({ id: 'b', type: 'boundary_event', label: 'Boundary', boundaryConfig: BOUNDARY_BLOCK });

    // The premise: the platform ships no `boundary_event` executor.
    expect(m.registeredTypes).not.toContain('boundary_event');

    // The run reached the node (`before` ran) and did NOT get past it.
    expect(m.ran).toEqual(['before']);

    // ⭐ Loud, not silent — which is why this type needed no executor change.
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
    // ⇒ a minimal block and a full one fail identically: the dispatch fails
    //    before any executor could read either. Which is exactly why the `wait`
    //    reading could not have been extrapolated onto this type.
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
