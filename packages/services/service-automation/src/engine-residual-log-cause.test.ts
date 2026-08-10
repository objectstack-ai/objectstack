// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression: #6499 — the 13 residual `engine.ts` seams that still interpolated
// a FOREIGN cause (a caught error's `.message`, or a foreign envelope field)
// into a log MESSAGE after #6299 / PR #6498, plus the separately-argued 14th
// (`validateFlowExpressions`, a self-authored `\n` in a message we control).
// The ninth instalment of the family #5048 / #5575 / #5636 / #5661 / #5737 /
// #5912 / #6230 / #6299 closed.
//
// ## The shared half: the message
//
// `ObjectLogger.write()` (packages/core/src/logger.ts) emits one
// `<ts> <LEVEL> <message>` record per call, so a message carrying newlines
// becomes several physical lines of which only the FIRST has a level head — a
// file sink stores the rest as headless records, `grep WARN`/`grep ERROR`
// returns the one line with no facts on it, and `serve`'s boot-quiet window
// drops the continuations outright on the stdout (warn) path. The thrown value
// at these seams is a datasource driver's, a plugin's, or (second-hand, via the
// `AutomationResult.error` envelope) a failing node's own text, whose line
// count we do not control. cloud#971 is the shape. The fix at every site is the
// family's: the message stays one line, the cause rides the logger's structured
// slot (`describeThrownForLog`), which every Logger implementation serializes
// with JSON.stringify — newlines become `\n` escapes, one physical line.
//
// ## The half that is NOT shared: the level
//
// ⛔ Per #6299's lesson, each seam's #4632 verdict was taken on its own
// consequence path — see the per-site comments in engine.ts. The outcome here:
//
//   - `persistSuspendedRun` → **error**, unchanged (#4460's raise; #4420 is
//     this exact seam's accident).
//   - `recordLog`'s fire-and-forget `store.recordTerminal` → **RAISED to
//     error** (durability): a terminal run's history row failed to land while
//     the run completed and every caller reads healthy; nothing retries it,
//     and after a restart the approvals sweeps read the hole as
//     stranded/never-finished.
//   - Every other seam (2–3, 5–13) and the 14th → **warn**, unchanged
//     (functional): nothing claimed-persisted fails to land; each record now
//     states its own degradation out loud.
//
// `check:durability-log-level` grades NONE of these (its callee vocabulary
// does not name `SuspendedRunStore`'s methods and its read-seam scan roots do
// not reach this package), so the level pins below are the only thing holding
// all 14 verdicts.
//
// Assertions read REAL BYTES off a REAL `ObjectLogger` (per the #5662 → #6230
// precedent: a spy proves what the seam called, not what a line-oriented
// consumer sees). Because the JSON format spreads `meta` into the record, a
// record that carries `error`/`source` proves the meta landed in the RIGHT
// argument slot — a meta passed third to `warn(message, meta?)` is silently
// dropped and the field would be absent. Prototype spies appear only where the
// `error(message, error?, meta?)` slot layout is itself the fact under test.

import { describe, it, expect, vi } from 'vitest';
import { ObjectLogger } from '@objectstack/core';
import { AutomationEngine } from './engine.js';
import type { NodeExecutor, SuspendedRun, SuspendedRunStore, FlowTrigger } from './engine.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { registerScreenNodes } from './builtin/screen-nodes.js';

// ── fixtures ───────────────────────────────────────────────────────────────

/**
 * What a database driver's failure looks like when it is not one line —
 * byte-identical to the fixture the whole family uses
 * (`suspended-run-store-consume-log-cause.test.ts` et al.), because it is the
 * same accident. In-repo drivers are single-line today, which is why #6499 is
 * a finding and not an outage report.
 */
const MULTILINE_DRIVER = [
    'SQLITE_ERROR: no such table: sys_automation_run',
    '  at Database.prepare (better-sqlite3/lib/methods/wrappers.js:5:21)',
    '  hint: run `os migrate` for this datasource, or set OS_SKIP_SCHEMA_SYNC=0',
].join('\n');

/** A store where everything works except the one method a test breaks. */
function workingStore(overrides: Partial<SuspendedRunStore>): SuspendedRunStore {
    return {
        async save() {},
        async load(): Promise<SuspendedRun | null> { return null; },
        async delete() {},
        async list(): Promise<SuspendedRun[]> { return []; },
        ...overrides,
    };
}

/**
 * A pausing executor; `onRelease` optionally makes its teardown throw.
 *
 * Declares `resumeAuthority: 'any'` because these tests continue the pause
 * through the public {@link AutomationEngine.resume} door. Since #5561 that is
 * an opt-in: a node type that declares nothing is refused there, so a fixture
 * exercising anything OTHER than the resume gate has to state the posture it
 * relies on — the same declaration the four pausing built-ins carry.
 */
function pauser(onRelease?: () => void): NodeExecutor {
    return {
        type: 'pauser',
        descriptor: defineActionDescriptor({
            type: 'pauser', version: '1.0.0', name: 'Pauser',
            supportsPause: true, resumeAuthority: 'any',
        }),
        async execute(node) {
            return { success: true, suspend: true, correlation: `test-armature:${node.id}` };
        },
        ...(onRelease ? { onSuspensionReleased: onRelease } : {}),
    } as NodeExecutor;
}

const PAUSE_FLOW = {
    name: 'pause_flow',
    label: 'Pause Flow',
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'hold', type: 'pauser', label: 'Hold' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'hold' },
        { id: 'e2', source: 'hold', target: 'end' },
    ],
};

/** The smallest flow that runs to a TERMINAL state. */
const NOOP_FLOW = {
    name: 'noop_flow',
    label: 'Noop',
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

/** A record-change-triggered flow, for the three trigger seams. */
function triggeredFlow(name: string) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { objectName: 'task', triggerType: 'record-after-update' } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 20));

// ── real-byte capture ──────────────────────────────────────────────────────

/** Capture BOTH streams — every site's verdict includes a STREAM claim. */
async function captureBoth(fn: () => Promise<void> | void): Promise<{ stdout: string[]; stderr: string[] }> {
    const out: string[] = [];
    const err: string[] = [];
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((c: string | Uint8Array) => {
        out.push(String(c));
        return true;
    }) as never);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((c: string | Uint8Array) => {
        err.push(String(c));
        return true;
    }) as never);
    try {
        await fn();
    } finally {
        outSpy.mockRestore();
        errSpy.mockRestore();
    }
    const split = (chunks: string[]) => chunks.join('').split('\n').filter((l) => l.length > 0);
    return { stdout: split(out), stderr: split(err) };
}

type Rec = {
    level: string;
    msg: string;
    error?: string;
    issues?: unknown;
    source?: string;
    visibleWhen?: string;
    // #6654 — the name-splice sweep's structured slots.
    recordId?: string;
    rejected?: string[];
    unknownTypes?: string[];
    knownTypes?: string[];
    branchLabel?: string;
    outEdges?: Array<{ id: string; label: string | null }>;
};

/**
 * The ONE JSON record on `lines` whose message carries `marker` — asserting
 * both that it exists and that the record occupies exactly one physical line
 * (a shredded record's continuation lines would not parse and would not carry
 * the marker's level head).
 */
function soleRecordWith(lines: string[], marker: string): Rec {
    const hits = lines.filter((l) => l.includes(marker));
    expect(hits, `exactly one physical line carries '${marker}'`).toHaveLength(1);
    return JSON.parse(hits[0]) as Rec;
}

/** Assert `lines` carries NO line mentioning `marker` (stream-silence pin). */
function assertSilent(lines: string[], marker: string, stream: string): void {
    expect(lines.filter((l) => l.includes(marker)), `nothing on ${stream}`).toEqual([]);
}

function jsonLogger(): ObjectLogger {
    return new ObjectLogger({ level: 'warn', format: 'json' });
}

/** The pretty-format `<ts> <LEVEL>` head. */
const RECORD_HEAD = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z(?: \|)? (DEBUG|INFO|WARN|ERROR|FATAL)\b/;

/** The core one-line + cause-in-meta contract every site below re-asserts. */
function expectOneLineWithCause(record: Rec, level: string): void {
    expect(record.level).toBe(level);
    expect(record.msg).not.toContain('\n');
    expect(record.msg, 'no driver fact leaks into the message').not.toContain('no such table');
    expect(record.msg).not.toContain('better-sqlite3');
    expect(record.error, 'the WHOLE driver text rides the structured slot').toBe(MULTILINE_DRIVER);
    expect(record.issues).toBeUndefined();
}

// ═══ datasource-driver seam (sites 1–4) ════════════════════════════════════

describe('#6499 sites 1–4 — SuspendedRunStore driver seams', () => {
    it("site 1: persistSuspendedRun — #4632 DURABILITY, stays `error`, one stderr line, cause in meta", async () => {
        const engine = new AutomationEngine(jsonLogger(), workingStore({
            async save() { throw new Error(MULTILINE_DRIVER); },
        }));
        engine.registerNodeExecutor(pauser());
        engine.registerFlow('pause_flow', PAUSE_FLOW);

        let paused: { status?: string } = {};
        const streams = await captureBoth(async () => {
            paused = await engine.execute('pause_flow');
        });

        // Behaviour unchanged: the in-memory suspension still parks the run.
        expect(paused.status).toBe('paused');

        const record = soleRecordWith(streams.stderr, 'failed to persist suspended run');
        expectOneLineWithCause(record, 'error');
        expect(record.msg).toContain('NOT be resumable after a restart');
        expect(record.msg).toContain("this record's meta");
        assertSilent(streams.stdout, 'failed to persist', 'stdout');
    });

    it('site 1: stays one physical line in `pretty`, with every fact on the greppable line', async () => {
        const engine = new AutomationEngine(new ObjectLogger({ level: 'warn', format: 'pretty' }), workingStore({
            async save() { throw new Error(MULTILINE_DRIVER); },
        }));
        engine.registerNodeExecutor(pauser());
        engine.registerFlow('pause_flow', PAUSE_FLOW);

        const streams = await captureBoth(async () => { await engine.execute('pause_flow'); });
        expect(streams.stderr).toHaveLength(1);
        expect(streams.stderr[0]).toMatch(RECORD_HEAD);
        expect(streams.stderr[0]).toContain('failed to persist suspended run');
        expect(streams.stderr[0]).toContain('run `os migrate` for this datasource');
    });

    it('site 1: hands the cause to error(message, error, meta) — meta THIRD, Error slot empty (#5575)', async () => {
        const spy = vi.spyOn(ObjectLogger.prototype, 'error');
        const engine = new AutomationEngine(jsonLogger(), workingStore({
            async save() { throw new Error(MULTILINE_DRIVER); },
        }));
        engine.registerNodeExecutor(pauser());
        engine.registerFlow('pause_flow', PAUSE_FLOW);
        await captureBoth(async () => { await engine.execute('pause_flow'); });

        const call = spy.mock.calls.find((c) => String(c[0]).includes('failed to persist suspended run'));
        expect(call).toBeDefined();
        const [message, errorSlot, meta] = call as unknown as [string, unknown, Record<string, unknown>];
        expect(message).not.toContain('\n');
        expect(errorSlot).toBeUndefined();
        expect(meta.error).toBe(MULTILINE_DRIVER);
        spy.mockRestore();
    });

    it("site 2: listRuns — #4632 FUNCTIONAL, stays `warn`, one stdout line, degradation said out loud", async () => {
        const engine = new AutomationEngine(jsonLogger(), workingStore({
            async listHistory() { throw new Error(MULTILINE_DRIVER); },
        }));

        let listed: unknown[] = [];
        const streams = await captureBoth(async () => {
            listed = await engine.listRuns('some_flow');
        });

        expect(listed).toEqual([]); // behaviour unchanged: degrades to the ring buffer
        const record = soleRecordWith(streams.stdout, 'run-history read failed');
        expectOneLineWithCause(record, 'warn');
        expect(record.msg).toContain('DEGRADES to the in-memory ring buffer');
        expect(record.msg).toContain('cannot tell a short list from a complete one');
        assertSilent(streams.stderr, 'run-history read failed', 'stderr');
    });

    it('site 2: stays one physical line in `pretty`', async () => {
        const engine = new AutomationEngine(new ObjectLogger({ level: 'warn', format: 'pretty' }), workingStore({
            async listHistory() { throw new Error(MULTILINE_DRIVER); },
        }));
        const streams = await captureBoth(async () => { await engine.listRuns('some_flow'); });
        expect(streams.stdout).toHaveLength(1);
        expect(streams.stdout[0]).toMatch(RECORD_HEAD);
        expect(streams.stdout[0]).toContain('run `os migrate` for this datasource');
    });

    it("site 3: getRun — #4632 FUNCTIONAL, stays `warn`; the record admits null is indistinguishable", async () => {
        const engine = new AutomationEngine(jsonLogger(), workingStore({
            async loadTerminal() { throw new Error(MULTILINE_DRIVER); },
        }));

        let got: unknown = 'unset';
        const streams = await captureBoth(async () => {
            got = await engine.getRun('run_gone');
        });

        expect(got).toBeNull(); // behaviour unchanged — the #5186 shape is out of #6499's scope
        const record = soleRecordWith(streams.stdout, 'durable run lookup failed');
        expectOneLineWithCause(record, 'warn');
        expect(record.msg).toContain('DEGRADES to null');
        expect(record.msg).toContain('cannot tell the two apart');
        assertSilent(streams.stderr, 'durable run lookup failed', 'stderr');
    });

    it("site 4: recordTerminal — #4632 DURABILITY, RAISED warn→error: the run reads healthy while its history row never landed", async () => {
        const engine = new AutomationEngine(jsonLogger(), workingStore({
            async recordTerminal() { throw new Error(MULTILINE_DRIVER); },
        }));
        engine.registerFlow('noop_flow', NOOP_FLOW);

        let res: { success?: boolean } = {};
        const streams = await captureBoth(async () => {
            res = await engine.execute('noop_flow');
            await flush(); // fire-and-forget .catch()
        });

        expect(res.success).toBe(true); // the run itself is untouched — that is the hazard
        const record = soleRecordWith(streams.stderr, 'run-history persist failed');
        expectOneLineWithCause(record, 'error');
        expect(record.msg).toContain('nothing retries the write');
        expect(record.msg).toContain('approvals sweeps read it as never-finished');
        assertSilent(streams.stdout, 'run-history persist failed', 'stdout');
    });

    it('site 4: hands the cause to error(message, error, meta) — meta THIRD, Error slot empty (#5575)', async () => {
        const spy = vi.spyOn(ObjectLogger.prototype, 'error');
        const engine = new AutomationEngine(jsonLogger(), workingStore({
            async recordTerminal() { throw new Error(MULTILINE_DRIVER); },
        }));
        engine.registerFlow('noop_flow', NOOP_FLOW);
        await captureBoth(async () => {
            await engine.execute('noop_flow');
            await flush();
        });

        const call = spy.mock.calls.find((c) => String(c[0]).includes('run-history persist failed'));
        expect(call).toBeDefined();
        const [message, errorSlot, meta] = call as unknown as [string, unknown, Record<string, unknown>];
        expect(message).not.toContain('\n');
        expect(errorSlot).toBeUndefined();
        expect(meta.error).toBe(MULTILINE_DRIVER);
        spy.mockRestore();
    });
});

// ═══ plugin-supplied code seam (sites 5–8) ═════════════════════════════════

describe('#6499 sites 5–8 — plugin-supplied code seams, all #4632 FUNCTIONAL, all stay `warn`', () => {
    it("site 5: releaseSuspension — the executor's thrown teardown rides meta; the handle stays in the message", async () => {
        const engine = new AutomationEngine(jsonLogger());
        engine.registerNodeExecutor(pauser(() => { throw new Error(MULTILINE_DRIVER); }));
        engine.registerFlow('pause_flow', PAUSE_FLOW);

        const paused = await engine.execute('pause_flow');
        let resumed: { success?: boolean } = {};
        const streams = await captureBoth(async () => {
            resumed = await engine.resume(paused.runId!);
        });

        expect(resumed.success).toBe(true); // teardown is best-effort — behaviour unchanged
        const record = soleRecordWith(streams.stdout, 'failed to release its suspension');
        expectOneLineWithCause(record, 'warn');
        expect(record.msg, 'the operator clean-up handle').toContain('test-armature:hold');
        expect(record.msg).toContain('may still be scheduled');
        assertSilent(streams.stderr, 'failed to release', 'stderr');
    });

    it("site 6: unregisterTrigger — the trigger's thrown stop() rides meta", async () => {
        const engine = new AutomationEngine(jsonLogger());
        const trigger: FlowTrigger = { type: 'record_change', start() {}, stop() { throw new Error(MULTILINE_DRIVER); } };
        engine.registerTrigger(trigger);
        engine.registerFlow('rc_unreg', triggeredFlow('rc_unreg'));

        const streams = await captureBoth(() => { engine.unregisterTrigger('record_change'); });

        const record = soleRecordWith(streams.stdout, 'failed while unregistering the trigger');
        expectOneLineWithCause(record, 'warn');
        expect(record.msg).toContain("stop('rc_unreg')");
        expect(record.msg).toContain('may keep firing until the process restarts');
        assertSilent(streams.stderr, 'unregistering the trigger', 'stderr');
    });

    it("site 7: activateFlowTrigger — the trigger's thrown start() rides meta; the flow's not-armed state is in the message", async () => {
        const engine = new AutomationEngine(jsonLogger());
        const trigger: FlowTrigger = { type: 'record_change', start() { throw new Error(MULTILINE_DRIVER); }, stop() {} };
        engine.registerTrigger(trigger);

        const streams = await captureBoth(() => { engine.registerFlow('rc_bind', triggeredFlow('rc_bind')); });

        const record = soleRecordWith(streams.stdout, 'Failed to bind flow');
        expectOneLineWithCause(record, 'warn');
        expect(record.msg).toContain("'rc_bind'");
        expect(record.msg).toContain('will NOT fire on this trigger');
        assertSilent(streams.stderr, 'Failed to bind flow', 'stderr');
    });

    it("site 8: deactivateFlowTrigger — the trigger's thrown stop() rides meta", async () => {
        const engine = new AutomationEngine(jsonLogger());
        const trigger: FlowTrigger = { type: 'record_change', start() {}, stop() { throw new Error(MULTILINE_DRIVER); } };
        engine.registerTrigger(trigger);
        engine.registerFlow('rc_unbind', triggeredFlow('rc_unbind'));

        const streams = await captureBoth(async () => { await engine.toggleFlow('rc_unbind', false); });

        const record = soleRecordWith(streams.stdout, 'failed while unbinding the flow');
        expectOneLineWithCause(record, 'warn');
        expect(record.msg).toContain("stop('rc_unbind')");
        assertSilent(streams.stderr, 'unbinding the flow', 'stderr');
    });
});

// ═══ engine-internal, transitively foreign text (sites 9–13) ═══════════════

describe('#6499 sites 9–13 — engine-internal seams carrying foreign text, all #4632 FUNCTIONAL, all stay `warn`', () => {
    it("site 9: resolveRunContext — the grants resolver's thrown text rides meta; fail-safe stays audible", async () => {
        const engine = new AutomationEngine(jsonLogger());
        engine.registerFlow('noop_flow', NOOP_FLOW);
        engine.setUserGrantsResolver(() => { throw new Error(MULTILINE_DRIVER); });

        let res: { success?: boolean } = {};
        const streams = await captureBoth(async () => {
            res = await engine.execute('noop_flow', { userId: 'u1' } as AutomationContext);
        });

        expect(res.success).toBe(true); // fail-safe: the run proceeds, un-elevated
        const record = soleRecordWith(streams.stdout, 'could not resolve grants');
        expectOneLineWithCause(record, 'warn');
        expect(record.msg).toContain('baseline member permissions (not elevated)');
        assertSilent(streams.stderr, 'could not resolve grants', 'stderr');
    });

    it("site 10: expandDeclaredLookups — the expander's thrown text rides meta", async () => {
        const engine = new AutomationEngine(jsonLogger());
        engine.registerFlow('expand_flow', {
            ...NOOP_FLOW,
            name: 'expand_flow',
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: { expand: ['owner'] } },
                { id: 'end', type: 'end', label: 'End' },
            ],
        });
        engine.setRecordExpander(() => { throw new Error(MULTILINE_DRIVER); });

        let res: { success?: boolean } = {};
        const streams = await captureBoth(async () => {
            res = await engine.execute('expand_flow', { record: { id: 'r1' }, object: 'contact' } as AutomationContext);
        });

        expect(res.success).toBe(true); // expansion must never break the flow it feeds
        const record = soleRecordWith(streams.stdout, 'could not expand lookups');
        expectOneLineWithCause(record, 'warn');
        expect(record.msg).toContain('[owner]');
        expect(record.msg).toContain('resolve to the scalar id');
        assertSilent(streams.stderr, 'could not expand lookups', 'stderr');
    });

    it("site 11: refuseInvalidScreenInput — the author's predicate AND the evaluator's multi-line throw both ride meta", async () => {
        // The predicate is metadata-author text and the evaluator's thrown
        // message deliberately embeds it (`— source: \`…\``), so BOTH spliced
        // pieces were uncontrolled. The broken predicate lives in the STORED
        // row (rows at rest are not re-validated), the registered flow is
        // clean — which is exactly how such a predicate reaches this seam.
        const brokenPredicate = '][ not a predicate\nsecond line';
        const parked: SuspendedRun = {
            runId: 'run_scr',
            flowName: 'onboard',
            nodeId: 'collect',
            variables: {},
            steps: [],
            context: {} as AutomationContext,
            startedAt: new Date().toISOString(),
            startTime: Date.now(),
            screen: {
                nodeId: 'collect',
                title: 'Your details',
                fields: [{ name: 'full_name', label: 'Full name', type: 'text', required: true, visibleWhen: brokenPredicate }],
            } as SuspendedRun['screen'],
        };
        const engine = new AutomationEngine(jsonLogger(), workingStore({
            async load(runId) { return runId === 'run_scr' ? parked : null; },
        }));
        // The real `screen` executor, as any booted engine has it. Needed since
        // #5561 step two: the resume below goes through the public gate, and the
        // authority of a pause is read off the SUSPENDED NODE's descriptor — with
        // no `screen` registered there is no descriptor, which now resolves
        // fail-closed and refuses the resume before this seam is ever reached.
        // `screen` declares `resumeAuthority: 'any'`, so registering it restores
        // exactly the production shape this site is about.
        registerScreenNodes(engine, { logger: jsonLogger(), getService() { return undefined; } } as never);
        engine.registerFlow('onboard', {
            name: 'onboard',
            label: 'Onboard',
            type: 'screen',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'collect', type: 'screen', label: 'Your details', config: { title: 'Your details', fields: [] } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'collect' },
                { id: 'e2', source: 'collect', target: 'end' },
            ],
        });

        let resumed: { success?: boolean } = {};
        const streams = await captureBoth(async () => {
            resumed = await engine.resume('run_scr', { variables: {} });
        });

        expect(resumed.success).toBe(true); // unevaluable ⇒ hidden ⇒ `required` not enforced
        const record = soleRecordWith(streams.stdout, 'has a visibleWhen that could not be evaluated');
        expect(record.level).toBe('warn');
        expect(record.msg).not.toContain('\n');
        expect(record.msg, 'the predicate never reaches the message').not.toContain('][ not a predicate');
        expect(record.msg).toContain('`required` is not enforced');
        expect(record.visibleWhen, "the author's predicate, whole").toBe(brokenPredicate);
        expect(record.error, "the evaluator's own multi-line throw").toContain('condition');
        expect(record.error).toContain('][ not a predicate');
        assertSilent(streams.stderr, 'visibleWhen', 'stderr');
    });

    it("site 12: bubbleToParent — the parent's failure ENVELOPE (which carries foreign text verbatim, #5912) rides meta", async () => {
        const engine = new AutomationEngine(jsonLogger());
        engine.registerNodeExecutor(pauser());
        engine.registerFlow('pause_flow', PAUSE_FLOW);
        const paused = await engine.execute('pause_flow', { $parentRunId: 'run_parent' } as unknown as AutomationContext);
        expect(paused.status).toBe('paused');

        // Route ONLY the parent's resume into a failure envelope carrying the
        // driver's text verbatim — the #5912-preserved `AutomationResult.error`
        // shape this seam re-splices second-hand. The child's own resume goes
        // through the real implementation untouched.
        const eng = engine as unknown as { resumeInternal: (runId: string, ...rest: unknown[]) => Promise<unknown> };
        const real = eng.resumeInternal.bind(engine);
        eng.resumeInternal = async (runId: string, ...rest: unknown[]) =>
            runId === 'run_parent' ? { success: false, error: MULTILINE_DRIVER } : real(runId, ...rest);

        let resumed: { success?: boolean } = {};
        const streams = await captureBoth(async () => {
            resumed = await engine.resume(paused.runId!);
        });

        expect(resumed.success).toBe(true); // the child's completion is genuine
        const record = soleRecordWith(streams.stdout, "the parent's failure envelope is in this record's meta");
        expectOneLineWithCause(record, 'warn');
        expect(record.msg).toContain("resuming parent 'run_parent'");
        assertSilent(streams.stderr, 'resuming parent', 'stderr');
    });

    it('site 13: bubbleToParent — a THROWN parent resume rides meta', async () => {
        const engine = new AutomationEngine(jsonLogger());
        engine.registerNodeExecutor(pauser());
        engine.registerFlow('pause_flow', PAUSE_FLOW);
        const paused = await engine.execute('pause_flow', { $parentRunId: 'run_parent' } as unknown as AutomationContext);

        const eng = engine as unknown as { resumeInternal: (runId: string, ...rest: unknown[]) => Promise<unknown> };
        const real = eng.resumeInternal.bind(engine);
        eng.resumeInternal = async (runId: string, ...rest: unknown[]) => {
            if (runId === 'run_parent') throw new Error(MULTILINE_DRIVER);
            return real(runId, ...rest);
        };

        let resumed: { success?: boolean } = {};
        const streams = await captureBoth(async () => {
            resumed = await engine.resume(paused.runId!);
        });

        expect(resumed.success).toBe(true); // best-effort: never thrown back at the child's resumer
        const record = soleRecordWith(streams.stdout, "threw — the thrown failure is in this record's meta");
        expectOneLineWithCause(record, 'warn');
        expect(record.msg).toContain("resuming parent 'run_parent'");
        assertSilent(streams.stderr, 'resuming parent', 'stderr');
    });
});

// ═══ the separately-argued 14th site ═══════════════════════════════════════

describe("#6499 site 14 — validateFlowExpressions' advisory pass: a self-authored newline, not a foreign one", () => {
    it("the advisory finding stays one line; the author's (possibly multi-line) expression source rides meta", async () => {
        // The OPPOSITE cause of sites 1–13: nothing threw and no envelope is
        // involved — the old message itself authored `\n      source: …`, and
        // `issue.source` is the flow AUTHOR's expression, whose line count is
        // theirs (CEL is newline-tolerant, as this fixture proves by
        // registering cleanly). Level stays `warn` BY #1928's contract:
        // advisory, logged-never-thrown, strictly additive to registration.
        const engine = new AutomationEngine(jsonLogger());
        engine.setObjectSchemaResolver(() => ({ fields: ['amount', 'status'] }));
        const source = 'amout >\n  100'; // near-miss of `amount`, spanning two lines

        let registered = false;
        const streams = await captureBoth(() => {
            engine.registerFlow('expense_check', {
                name: 'expense_check',
                label: 'Expense check',
                type: 'autolaunched',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start', config: { objectName: 'expense', condition: source } },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [{ id: 'e1', source: 'start', target: 'end' }],
            });
            registered = true;
        });

        expect(registered).toBe(true); // advisory: the flow registers cleanly
        const record = soleRecordWith(streams.stdout, "[flow 'expense_check']");
        expect(record.level).toBe('warn');
        expect(record.msg).not.toContain('\n');
        expect(record.msg, 'the did-you-mean finding itself').toContain('did you mean');
        expect(record.msg).toContain('`amount`');
        expect(record.source, "the author's expression, whole, newline intact").toBe(source);
        assertSilent(streams.stderr, "[flow 'expense_check']", 'stderr');
    });
});

// ═══ the fired-run envelope seam #6499's sweep left (#6587) ════════════════

describe("#6587 — activateFlowTrigger's trigger-fired-run callback: the AutomationResult.error envelope rides meta", () => {
    // The same class as site 12 (the envelope carries a failing node's /
    // driver's text VERBATIM, #5912) on the FIRED-RUN path instead of the
    // subflow path — reported in PR #6568's residual sweep, outside #6499's
    // list of 13, fixed here.

    /** A record-change flow whose one work node throws the driver's text. */
    const FIRED_FLOW = {
        name: 'rc_fired',
        label: 'rc_fired',
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { objectName: 'task', triggerType: 'record-after-update' } },
            { id: 'boom', type: 'exploder', label: 'Boom' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'boom' },
            { id: 'e2', source: 'boom', target: 'end' },
        ],
    };

    /**
     * Register trigger + flow, then fire the captured callback ONCE — the
     * exact path a real trigger plugin drives. The executor THROWS (rather
     * than returning `success: false`) so `execute()`'s catch puts the
     * driver's text into `AutomationResult.error` verbatim, un-prefixed —
     * the #5912-preserved shape this seam re-splices second-hand.
     */
    async function fireOnce(engine: AutomationEngine): Promise<void> {
        let fire: ((ctx: AutomationContext) => Promise<void>) | undefined;
        const trigger: FlowTrigger = {
            type: 'record_change',
            start(_binding, callback) { fire = callback; },
            stop() {},
        };
        engine.registerTrigger(trigger);
        engine.registerNodeExecutor({
            type: 'exploder',
            async execute() { throw new Error(MULTILINE_DRIVER); },
        } as NodeExecutor);
        engine.registerFlow('rc_fired', FIRED_FLOW);
        expect(fire, 'the engine handed the trigger a callback').toBeDefined();
        await fire!({ event: 'record-after-update', object: 'task', record: { id: 't1' } } as AutomationContext);
    }

    it("#4632 stays `error` on its own reasoning (no caller holds the envelope): one stderr line, envelope in meta", async () => {
        const engine = new AutomationEngine(jsonLogger());
        const streams = await captureBoth(async () => { await fireOnce(engine); });

        // Behaviour unchanged: the callback resolves (nothing is thrown back
        // at the trigger plugin) and the failed run still lands in history.
        const runs = await engine.listRuns('rc_fired');
        expect(runs).toHaveLength(1);
        expect((runs[0] as { status?: string }).status).toBe('failed');

        const record = soleRecordWith(streams.stderr, 'Trigger-fired run of flow');
        expectOneLineWithCause(record, 'error');
        expect(record.msg, 'the flow-name correlation').toContain("'rc_fired'");
        expect(record.msg, 'the trigger correlation').toContain("trigger 'record_change'");
        expect(record.msg, 'the consequence, stated out loud').toContain('no caller holds this result');
        assertSilent(streams.stdout, 'Trigger-fired run', 'stdout');
    });

    it('stays one physical line in `pretty`, with every fact on the greppable line', async () => {
        const engine = new AutomationEngine(new ObjectLogger({ level: 'warn', format: 'pretty' }));
        const streams = await captureBoth(async () => { await fireOnce(engine); });
        expect(streams.stderr).toHaveLength(1);
        expect(streams.stderr[0]).toMatch(RECORD_HEAD);
        expect(streams.stderr[0]).toContain('Trigger-fired run of flow');
        expect(streams.stderr[0]).toContain('run `os migrate` for this datasource');
    });

    it('hands the envelope to error(message, error, meta) — meta THIRD, Error slot empty (#5575)', async () => {
        const spy = vi.spyOn(ObjectLogger.prototype, 'error');
        const engine = new AutomationEngine(jsonLogger());
        await captureBoth(async () => { await fireOnce(engine); });

        const call = spy.mock.calls.find((c) => String(c[0]).includes('Trigger-fired run of flow'));
        expect(call).toBeDefined();
        const [message, errorSlot, meta] = call as unknown as [string, unknown, Record<string, unknown>];
        expect(message).not.toContain('\n');
        expect(errorSlot).toBeUndefined();
        expect(meta.error).toBe(MULTILINE_DRIVER);
        spy.mockRestore();
    });
});

// ═══ #6654 — the five NAME-shaped splices (the weaker class #6499 reported) ═

// Unlike sites 1–14 above, nothing here throws and no envelope is involved:
// these five sites interpolated NAMES/IDENTIFIERS that originate outside the
// engine's control — a caller's record id, a resume signal's variable names,
// user-submitted screen keys, flow-author node type names, a computed branch
// label plus edge labels — none of which is schema-constrained against
// newlines. The fixtures below put a newline INTO the identifier to prove the
// family contract: the message stays one physical line carrying only
// controlled facts, the foreign identifier rides the structured meta slot,
// the level is unchanged (option A changes none), and behaviour is unchanged.

describe("#6654 site 1 — the re-entrancy guard: the caller's record id rides meta", () => {
    /** A record id only a caller could produce — carrying a newline. */
    const NL_RECORD_ID = 'case-1\nSECOND LINE';

    /** Register a self-retriggering flow; returns the inner skip observation. */
    function armLoop(engine: AutomationEngine): { sawGuardSkip: () => boolean } {
        let skipped = false;
        engine.registerNodeExecutor({
            type: 'self_retrigger',
            async execute() {
                // Re-fire the SAME flow for the SAME record (the loop shape).
                const r = await engine.execute('looping_flow', {
                    record: { id: NL_RECORD_ID },
                    object: 'crm_case',
                    event: 'record-after-update',
                } as unknown as AutomationContext);
                if ((r.output as { reason?: string } | undefined)?.reason === 'reentrancy_loop_guard') skipped = true;
                return { success: true };
            },
        } as NodeExecutor);
        engine.registerFlow('looping_flow', {
            name: 'looping_flow',
            label: 'Looping',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'loop', type: 'self_retrigger', label: 'Loop' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'loop' },
                { id: 'e2', source: 'loop', target: 'end' },
            ],
        });
        return { sawGuardSkip: () => skipped };
    }

    it("stays `warn`, one stdout line; the record id never reaches the message", async () => {
        const engine = new AutomationEngine(jsonLogger());
        const loop = armLoop(engine);

        let res: { success?: boolean } = {};
        const streams = await captureBoth(async () => {
            res = await engine.execute('looping_flow', {
                record: { id: NL_RECORD_ID },
                object: 'crm_case',
                event: 'record-after-update',
            } as unknown as AutomationContext);
        });

        // Behaviour unchanged: the outer run completes, the inner re-fire is
        // skipped with the guard's envelope.
        expect(res.success).toBe(true);
        expect(loop.sawGuardSkip()).toBe(true);

        const record = soleRecordWith(streams.stdout, 're-entered for the same record');
        expect(record.level).toBe('warn');
        expect(record.msg).not.toContain('\n');
        expect(record.msg, 'the record id never reaches the message').not.toContain('SECOND LINE');
        expect(record.msg, 'the flow-name correlation stays').toContain("'looping_flow'");
        expect(record.recordId, "the caller's id, whole, newline intact").toBe(NL_RECORD_ID);
        assertSilent(streams.stderr, 're-entered for the same record', 'stderr');
    });

    it('stays one physical line in `pretty`, with the id escaped onto the greppable line', async () => {
        const engine = new AutomationEngine(new ObjectLogger({ level: 'warn', format: 'pretty' }));
        armLoop(engine);
        // Seal AFTER registering, so the vocabulary-never-sealed warning
        // (#4792) cannot add a second stdout line to this count.
        engine.sealNodeTypeVocabulary();

        const streams = await captureBoth(async () => {
            await engine.execute('looping_flow', {
                record: { id: NL_RECORD_ID },
                object: 'crm_case',
                event: 'record-after-update',
            } as unknown as AutomationContext);
        });

        expect(streams.stdout).toHaveLength(1);
        expect(streams.stdout[0]).toMatch(RECORD_HEAD);
        expect(streams.stdout[0]).toContain('re-entered for the same record');
        // JSON.stringify escapes the newline, so the id survives ON this line.
        expect(streams.stdout[0]).toContain('SECOND LINE');
    });
});

describe("#6654 site 2 — refused resume: the signal's rejected variable names ride meta", () => {
    it("stays `warn`, one stdout line; the caller's names never reach the message; the refusal envelope still names them", async () => {
        const engine = new AutomationEngine(jsonLogger());
        engine.registerNodeExecutor(pauser());
        engine.registerFlow('pause_flow', PAUSE_FLOW);
        const paused = await engine.execute('pause_flow');
        expect(paused.status).toBe('paused');

        const evilName = '$evil\nname';
        let res: { success?: boolean; code?: string; error?: string } = {};
        const streams = await captureBoth(async () => {
            res = await engine.resume(paused.runId!, { variables: { [evilName]: 1 } });
        });

        // Behaviour unchanged: refused as a whole, envelope code intact, and
        // the ENVELOPE (caller-facing refusal text, not a log record — the
        // class ruled elsewhere) still names the variables.
        expect(res.success).toBe(false);
        expect(res.code).toBe('INVALID_SIGNAL');
        expect(res.error).toContain('may not set engine-internal variables');

        const record = soleRecordWith(streams.stdout, 'signal writes engine-internal');
        expect(record.level).toBe('warn');
        expect(record.msg).not.toContain('\n');
        expect(record.msg, 'the rejected name never reaches the message').not.toContain('$evil');
        expect(record.msg, 'the run correlation stays').toContain(`'${paused.runId}'`);
        expect(record.rejected, 'the rejected names, whole, newline intact').toEqual([evilName]);
        assertSilent(streams.stderr, 'signal writes engine-internal', 'stderr');

        // The pause stayed live: the legitimate continuation still lands.
        const retry = await engine.resume(paused.runId!, { variables: { ok: 1 } });
        expect(retry.success).toBe(true);
    });
});

describe('#6654 site 3 — screen-input refusal: the user-submitted keys ride meta', () => {
    it("stays `warn`, one stdout line; the submitted key never reaches the message; the refusal envelope keeps the summary", async () => {
        const parked: SuspendedRun = {
            runId: 'run_scr2',
            flowName: 'onboard2',
            nodeId: 'collect',
            variables: {},
            steps: [],
            context: {} as AutomationContext,
            startedAt: new Date().toISOString(),
            startTime: Date.now(),
            screen: {
                nodeId: 'collect',
                title: 'Your details',
                fields: [{ name: 'full_name', label: 'Full name', type: 'text', required: true }],
            } as SuspendedRun['screen'],
        };
        const engine = new AutomationEngine(jsonLogger(), workingStore({
            async load(runId) { return runId === 'run_scr2' ? parked : null; },
        }));
        // The real `screen` executor, for site 11's reason: since #5561 step
        // two the public gate reads the pause's authority off the suspended
        // node's descriptor, and with no `screen` registered the resume is
        // refused fail-closed before this seam is reached.
        registerScreenNodes(engine, { logger: jsonLogger(), getService() { return undefined; } } as never);
        engine.registerFlow('onboard2', {
            name: 'onboard2',
            label: 'Onboard',
            type: 'screen',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'collect', type: 'screen', label: 'Your details', config: { title: 'Your details', fields: [] } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'collect' },
                { id: 'e2', source: 'collect', target: 'end' },
            ],
        });

        const evilKey = 'evil\nkey';
        let res: { success?: boolean; code?: string; error?: string } = {};
        const streams = await captureBoth(async () => {
            res = await engine.resume('run_scr2', { variables: { full_name: 'ok', [evilKey]: 1 } });
        });

        // Behaviour unchanged: refused with the same code, and the ENVELOPE
        // (caller-facing refusal text, not a log record — the class ruled
        // elsewhere) still carries the per-field summary.
        expect(res.success).toBe(false);
        expect(res.code).toBe('INVALID_SCREEN_INPUT');
        expect(res.error).toContain('Unknown screen field');

        const record = soleRecordWith(streams.stdout, 'violates its declared field contract');
        expect(record.level).toBe('warn');
        expect(record.msg).not.toContain('\n');
        expect(record.msg, 'the submitted key never reaches the message').not.toContain('evil');
        expect(record.msg, 'the controlled count stays in the message').toContain('1 issue(s)');
        const issues = record.issues as Array<{ field: string; code: string; message: string }>;
        expect(issues).toHaveLength(1);
        expect(issues[0].field, "the caller's key, whole, newline intact").toBe(evilKey);
        expect(issues[0].code).toBe('unknown_field');
        expect(issues[0].message).toContain('Unknown screen field');
        assertSilent(streams.stderr, 'violates its declared field contract', 'stderr');
    });
});

describe("#6654 site 4 — warnUnknownNodeTypes: the flow's type names ride meta", () => {
    it("stays `warn`, one stdout line; the counted lead phrase survives; the names ride meta", async () => {
        const engine = new AutomationEngine(jsonLogger());
        engine.sealNodeTypeVocabulary(); // close the vocabulary FIRST — registration validates inline

        const nlType = 'mys\ntery';
        let registered = false;
        const streams = await captureBoth(() => {
            engine.registerFlow('typo_flow', {
                name: 'typo_flow',
                label: 'Typo',
                type: 'autolaunched',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'mid', type: nlType, label: 'Mid' },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'mid' },
                    { id: 'e2', source: 'mid', target: 'end' },
                ],
            });
            registered = true;
        });

        // Behaviour unchanged: the warning is advisory — the flow registers.
        expect(registered).toBe(true);

        // The lead phrase is load-bearing: tests and log filters count
        // per-flow findings by this exact substring.
        const record = soleRecordWith(streams.stdout, 'no registered executor or descriptor');
        expect(record.level).toBe('warn');
        expect(record.msg).not.toContain('\n');
        expect(record.msg, 'the type name never reaches the message').not.toContain('mys');
        expect(record.msg, 'the flow-name correlation stays').toContain("'typo_flow'");
        expect(record.unknownTypes, 'the unknown names, whole, newline intact').toEqual([nlType]);
        expect(record.knownTypes, 'the vocabulary the audit judged against').toContain('start');
        assertSilent(streams.stderr, 'no registered executor or descriptor', 'stderr');
    });
});

describe('#6654 site 5 — unclaimed branch label: the computed label and the edge labels ride meta', () => {
    it("stays `warn`, one stdout line; label and edge labels never reach the message; traversal still fans out", async () => {
        const nlBranch = 'sneaky\nbranch';
        const engine = new AutomationEngine(jsonLogger());
        let endReached = false;
        engine.registerNodeExecutor({
            type: 'chooser',
            async execute() { return { success: true, branchLabel: nlBranch }; },
        } as NodeExecutor);
        engine.registerNodeExecutor({
            type: 'probe',
            async execute() { endReached = true; return { success: true }; },
        } as NodeExecutor);
        engine.registerFlow('branchy', {
            name: 'branchy',
            label: 'Branchy',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'choose', type: 'chooser', label: 'Choose' },
                { id: 'after', type: 'probe', label: 'After' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'choose' },
                { id: 'e2', source: 'choose', target: 'after', label: 'approved' },
                { id: 'e3', source: 'after', target: 'end' },
            ],
        });

        let res: { success?: boolean } = {};
        const streams = await captureBoth(async () => {
            res = await engine.execute('branchy');
        });

        // Behaviour unchanged (#4414): the unclaimed selection is IGNORED,
        // every out-edge is evaluated, and the run completes.
        expect(res.success).toBe(true);
        expect(endReached).toBe(true);

        const record = soleRecordWith(streams.stdout, 'no out-edge carries that label');
        expect(record.level).toBe('warn');
        expect(record.msg).not.toContain('\n');
        expect(record.msg, 'the computed label never reaches the message').not.toContain('sneaky');
        expect(record.msg, 'the edge labels never reach the message').not.toContain('approved');
        expect(record.msg, 'the node correlation stays').toContain("'choose'");
        expect(record.branchLabel, 'the computed label, whole, newline intact').toBe(nlBranch);
        expect(record.outEdges, 'each out-edge id with its label').toEqual([{ id: 'e2', label: 'approved' }]);
        assertSilent(streams.stderr, 'no out-edge carries that label', 'stderr');
    });
});
