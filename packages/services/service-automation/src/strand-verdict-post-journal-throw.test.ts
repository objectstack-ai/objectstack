// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15555 — the strand VERDICT must not be lost when a statement after the
 * journal throws.
 *
 * ## The reported defect, in one sentence
 *
 * `journalConsumedSuspension` and the `status: 'stranded'` stamp are two
 * statements with executable code between them, so "a repair snapshot was
 * journalled" and "the engine said stranded" were not one fact. When the code
 * between them threw, the snapshot existed and the verdict never shipped —
 * and every consumer of the verdict derives repairability from it
 * (`plugin-approvals` `approval-service.ts`: `repairable = status ===
 * 'stranded'`). So the operator was told `repairable: false` about a run that
 * `restoreConsumedSuspension` puts back successfully.
 *
 * ⚠️ That direction is the whole point. The failure everybody checks for is a
 * false `true` — promising a repair for a lost run. This is a false `false`:
 * it stops someone from running a repair that WORKS.
 *
 * ## What is between the two statements
 *
 * `this.recordLog(...)` — synchronous and, at the time of this card,
 * unguarded. Two of its own statements can throw out of it on the terminal
 * path: the run-summary line (`this.logger.info(line, meta)`, on by default,
 * `runSummaryLog: 'info'`) and `this.store.recordTerminal(record)`, whose
 * SYNCHRONOUS throw escapes — the `void write.catch(...)` beneath it only ever
 * sees a returned promise's rejection. Then `await this.failAncestors(...)`.
 *
 * ## What this file pins
 *
 *  1. **The window, driven both ways it is reachable** — a store whose
 *     `recordTerminal` throws synchronously, and a logger whose `info` throws
 *     (which needs no store at all, so it also proves the journal that makes
 *     the run repairable is in-memory and independent of the durable row).
 *     In both, `resume` RETURNS `status: 'stranded'` and the repair verb
 *     answers `restored: true` on that same run.
 *  2. **The secondary failure stays loud.** The guard must not turn a lost
 *     history row into silence: it logs at `error`, naming the run, what was
 *     lost, and the verb that repairs the strand.
 *  3. **Controls, so the stamp is a reading and not a constant** — a clean
 *     strand takes no guard and logs no error; a resume refused BEFORE the
 *     consumption point still carries NO status and leaves the pause live.
 *     ⛔ The guard must widen nothing: only the one exit that already
 *     journalled a snapshot may say `stranded`.
 *
 * ## Deliberately NOT here
 *
 * ⛔ Cascade-failed ancestors. They go through `failSuspendedRun`, which
 * journals nothing, so `repairable: false` there is CORRECT and the repair
 * verb rightly refuses with `NO_CONSUMED_SUSPENSION`. This file never asserts
 * a stranded verdict for them.
 *
 * ⚠️ `repairable` is a point-in-time fact even when correct — an in-memory
 * journal is evicted past `MAX_CONSUMED_SUSPENSIONS`, and PIN 1's own run has
 * NO durable row (that is the failure being driven), so a restart loses the
 * repair. That residual is recorded on #15555 as explicitly NOT this card, and
 * nothing here promises otherwise: the pins assert the verb succeeds NOW,
 * which is exactly what the operator was wrongly told not to try.
 */

import { describe, it, expect } from 'vitest';

import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { defineActionDescriptor } from '@objectstack/spec/automation';

/** The secondary failure, distinct from the node's, so neither can stand in for the other. */
const TERMINAL_WRITE_FAILURE = 'run-history driver refused the terminal row';
const SUMMARY_LOG_FAILURE = 'log transport rejected the run-summary line';
/** The node failure that consumes the pause and strands the run. */
const NODE_FAILURE = 'tail blew up';

const holdDescriptor = defineActionDescriptor({
    type: 'hold', version: '1.0.0', name: 'hold',
    supportsPause: true, resumeAuthority: 'any',
});
const plain = (type: string) => defineActionDescriptor({ type, version: '1.0.0', name: type });

/** start → hold (pauses) → tail (throws on resume) → end. */
const STRAND_FLOW = {
    name: 'strand_flow', label: 'Strand', type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'hold', type: 'hold', label: 'Hold' },
        { id: 'tail', type: 'tail', label: 'Tail' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'hold' },
        { id: 'e2', source: 'hold', target: 'tail' },
        { id: 'e3', source: 'tail', target: 'end' },
    ],
};

const ctx = { event: 'test', record: { id: 'rec_1' } } as unknown as AutomationContext;

interface LoggedError { message: string; errorSlot: unknown; meta: unknown }

/**
 * A logger that records `error` calls positionally (the `Logger` contract is
 * `error(message, error?, meta?)`) and can be made to throw from `info`.
 */
function recorder(opts: { infoThrows?: string } = {}) {
    const errors: LoggedError[] = [];
    return {
        errors,
        logger: {
            info(_msg: string) { if (opts.infoThrows) throw new Error(opts.infoThrows); },
            warn() {},
            debug() {},
            error(message: string, errorSlot?: unknown, meta?: unknown) {
                errors.push({ message, errorSlot, meta });
            },
        } as never,
    };
}

/** A durable store whose terminal write throws SYNCHRONOUSLY, before any promise exists. */
class SyncThrowTerminalStore extends InMemorySuspendedRunStore {
    override recordTerminal(): Promise<void> {
        throw new Error(TERMINAL_WRITE_FAILURE);
    }
}

function engineOver(store: InMemorySuspendedRunStore | undefined, logger: never) {
    const led = { tail: 0 };
    const knobs = { throws: true };
    const engine = new AutomationEngine(logger, store);
    engine.registerNodeExecutor({
        type: 'hold',
        descriptor: holdDescriptor,
        async execute() { return { success: true, suspend: true, correlation: 'approval:req_1' }; },
    } as never);
    engine.registerNodeExecutor({
        type: 'tail',
        descriptor: plain('tail'),
        async execute() {
            led.tail++;
            if (knobs.throws) throw new Error(NODE_FAILURE);
            return { success: true, output: { done: true } };
        },
    } as never);
    engine.registerFlow('strand_flow', STRAND_FLOW as never);
    return { engine, led, knobs };
}

/**
 * Resume, recording WHICH WAY the call ended. The defect's whole shape is that
 * `resume` threw where it should have returned, so a plain `await` would fail
 * the test with a stack trace instead of a reading.
 */
async function resumeOutcome(engine: AutomationEngine, runId: string) {
    return engine.resume(runId).then(
        result => ({ kind: 'returned' as const, result, thrown: undefined }),
        (err: unknown) => ({ kind: 'threw' as const, result: undefined, thrown: err }),
    );
}

async function park(engine: AutomationEngine) {
    const started = await engine.execute('strand_flow', ctx);
    expect(started.status).toBe('paused');
    return started.runId as string;
}

describe('#15555 — a throw between the journal and the stamp must not lose the strand verdict', () => {
    it('PIN 1 — the durable terminal write throws synchronously: the verdict still ships, and the repair works', async () => {
        const store = new SyncThrowTerminalStore();
        const { errors, logger } = recorder();
        const { engine, led } = engineOver(store, logger);
        const runId = await park(engine);

        const outcome = await resumeOutcome(engine, runId);

        // ── The reproduction. Before the guard this was `'threw'`, carrying
        // the run-history failure and NO run-state discriminator at all, so
        // every consumer of `AutomationResult.status` saw nothing.
        expect(outcome.kind, 'resume must REPORT the strand, not throw the secondary failure').toBe('returned');
        expect(outcome.result?.success).toBe(false);
        expect(outcome.result?.status, "the producer's discriminator, #13937 shape 4").toBe('stranded');
        // The run's OWN failure is what the caller is told about — the node
        // text, not the history driver's. The secondary failure is an operator
        // fact and goes to the log, below.
        expect(outcome.result?.error).toContain(NODE_FAILURE);
        expect(outcome.result?.error).not.toContain(TERMINAL_WRITE_FAILURE);
        expect(led.tail).toBe(1);

        // ── And the verdict is TRUE: the run is exactly the one the operator
        // verb accepts. These two assertions together are what make the old
        // `repairable: false` a false NEGATIVE rather than a safe default.
        expect(await engine.hasSuspendedRun(runId)).toBe(false);
        expect((await engine.resume(runId)).code).toBe('RUN_NOT_FOUND');
        const restored = await engine.restoreConsumedSuspension(runId, { requestedBy: 'ops' });
        expect(restored.restored, 'the repair the operator was told not to attempt').toBe(true);
        expect(restored.refusal).toBeUndefined();
        expect(await engine.hasSuspendedRun(runId)).toBe(true);

        // ── The secondary failure was REAL, not simulated away: no durable
        // history row landed. The repair rides on the in-memory journal, which
        // is written before the row and survives its loss.
        expect(await store.loadTerminal(runId), 'the history row genuinely did not land').toBeFalsy();
    });

    it('PIN 2 — the run-summary log line throws, with NO store attached: same verdict, same repair', async () => {
        // A second, independent statement in the same window, and one that
        // needs no durable store at all — so this also shows the journal that
        // makes the run repairable is the in-memory one.
        const { errors, logger } = recorder({ infoThrows: SUMMARY_LOG_FAILURE });
        const { engine } = engineOver(undefined, logger);
        const runId = await park(engine);

        const outcome = await resumeOutcome(engine, runId);

        expect(outcome.kind).toBe('returned');
        expect(outcome.result?.status).toBe('stranded');
        expect(outcome.result?.error).toContain(NODE_FAILURE);
        expect((await engine.restoreConsumedSuspension(runId)).restored).toBe(true);

        expect(errors.length, 'the swallowed throw is still reported').toBe(1);
        expect(errors[0]?.message).toContain(runId);
    });

    it('PIN 3 — the swallowed secondary failure is loud: `error`, naming the run and its repair verb', async () => {
        // ⛔ The guard must not trade a lost verdict for a silent failure.
        // AGENTS.md "Degradation log levels": the terminal history row claims
        // to persist and did not, while the caller reads a clean strand — the
        // judgment question answers YES, so `error`, with the consequence and
        // the fix in the first line.
        const { errors, logger } = recorder();
        const { engine } = engineOver(new SyncThrowTerminalStore(), logger);
        const runId = await park(engine);

        await resumeOutcome(engine, runId);

        expect(errors.length).toBe(1);
        const line = errors[0]!;
        expect(line.message).toContain(runId);
        expect(line.message, 'the consequence: the verdict shipped, the bookkeeping did not').toMatch(/stranded/i);
        expect(line.message, 'the fix an operator can act on').toContain('restoreConsumedSuspension');
        // THIRD argument per `error(message, error?, meta?)` — the driver text
        // goes to the structured slot, never into the message (#6499).
        expect(line.errorSlot, 'the Error slot stays empty (#5575)').toBeUndefined();
        expect(JSON.stringify(line.meta)).toContain(TERMINAL_WRITE_FAILURE);
        expect(line.message).not.toContain(TERMINAL_WRITE_FAILURE);
    });

    it('CONTROL — a clean strand is unchanged: same verdict, and NO error is logged', async () => {
        // The reverse control for PIN 3. If this logged too, PIN 3 would be
        // measuring "the engine logs on every strand", not "the guard fired".
        const { errors, logger } = recorder();
        const { engine } = engineOver(new InMemorySuspendedRunStore(), logger);
        const runId = await park(engine);

        const outcome = await resumeOutcome(engine, runId);

        expect(outcome.kind).toBe('returned');
        expect(outcome.result?.status).toBe('stranded');
        expect((await engine.restoreConsumedSuspension(runId)).restored).toBe(true);
        expect(errors, 'no secondary failure ⇒ nothing to report').toEqual([]);
    });

    it('CONTROL — the guard widens nothing: a resume refused BEFORE the consumption point still carries no status', async () => {
        // ⛔ `stranded` stays the name of exactly one exit — the one that
        // journalled a snapshot. An exit above the consumption point has
        // nothing to repair and must keep saying so.
        const { errors, logger } = recorder();
        const { engine, knobs, led } = engineOver(new SyncThrowTerminalStore(), logger);
        const runId = await park(engine);

        const refused = await engine.resume(runId, { variables: { $internal: 1 } } as never);
        expect(refused.success).toBe(false);
        expect(refused.code).toBe('INVALID_SIGNAL');
        expect(refused.status, 'no journal ⇒ no strand verdict').toBeUndefined();
        expect(led.tail).toBe(0);
        expect(await engine.hasSuspendedRun(runId)).toBe(true);
        expect((await engine.restoreConsumedSuspension(runId)).refusal).toBe('RUN_SUSPENDED');
        expect(errors).toEqual([]);

        // …and the same run, resumed cleanly, still carries no status at all —
        // the terminal write throws here too, and a COMPLETED run is not a
        // strand however loudly its bookkeeping failed.
        knobs.throws = false;
        const done = await resumeOutcome(engine, runId);
        expect(done.kind).toBe('returned');
        expect(done.result?.success).toBe(true);
        expect(done.result?.status, 'a completed run is never stranded').toBeUndefined();
        expect(led.tail).toBe(1);
    });
});
