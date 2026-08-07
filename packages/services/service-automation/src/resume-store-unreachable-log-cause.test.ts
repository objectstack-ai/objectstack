// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression: #5912 — the ONE seam of `engine.ts` that interpolated a FOREIGN
// cause into a log MESSAGE on the resume path: `resumeInternal`'s
// `catch` around `loadSuspendedRunStrict`, which reports the durable
// suspended-run store being unreadable.
//
// The sixth instalment of the family #5048 (flow binding, PR #5572), #5575
// (`reconcileDeclaredConnectors`'s `fail()`, PR #5639), #5636
// (`degradeConnectorInstance`, PR #5662), #5661 (`plugin.ts`'s three startup
// seams) and #5737 (`builtin/wait-node.ts`'s five, PR #5911) closed.
//
// ## Why this seam outlived #5737, and why it is the last one on this path
//
// #5911 fixed wait-node's five records. One of them — the timer wake-up's
// `STORE_UNAVAILABLE` line — carries a cause that THIS function composed: the
// engine splices the driver's own `message` into the result envelope, wait-node
// reads that envelope off `AutomationResult.error`, and PR #5911 put it into its
// record's `meta` intact. So after #5737, one single "store unreachable while
// resuming" incident produced TWO records: wait-node's, already clean, and this
// one, still shredded. Closing this seam is what makes the whole path greppable.
//
// ## The harm
//
// `ObjectLogger.write()` (packages/core/src/logger.ts) emits one
// `<ts> <LEVEL> <message>` record per call, so a message carrying newlines
// becomes several physical lines of which only the FIRST has a level head. A
// file sink stores the rest as their own records and a `grep ERROR` returns the
// one line that holds no facts. `pretty` / `text` is the default format of
// `os dev` and `os serve`, so that is the shape an operator actually reads.
// `error` goes to stderr and therefore bypasses `serve`'s boot-quiet buffer — the
// harm here is being MISREAD, not being dropped. cloud#971 is this exact shape.
//
// ## The fix, and the two things deliberately NOT changed
//
// Identical to the five prior instalments, zero new vocabulary: a static,
// newline-free message plus the cause in the logger's structured slot, whose
// POSITION is set by the `Logger` contract
// (`packages/spec/src/contracts/logger.ts`): `error(message, error?, meta?)`
// takes it THIRD — the second slot is the `Error` slot and a raw error there
// would ship its stack on every record (#5575).
//
//   1. The RESULT envelope's `error` field keeps the cause spliced in, VERBATIM.
//      It is a structured return value a caller reads whole — over REST a JSON
//      string field, never split on newlines — and #5636 made the same call for
//      `degradedReason`. The `envelope stays byte-identical` case below is the
//      pin that keeps a future tidy-up from "fixing" it too.
//   2. The level stays `error`. The run is on disk and the resume did not land:
//      #4632's durability degradation exactly.
//
// Assertions read REAL BYTES off a REAL `ObjectLogger` wherever the question is
// "what would a line-oriented consumer see", per the #5662 / #5661 / #5737
// precedent — a spy proves what the seam *called*, not what the downstream
// splitter *sees*, and it was the latter that cost cloud#971 a release line.
// Spies appear only where the argument SLOT is itself the fact under test.

import { describe, it, expect, vi } from 'vitest';
import { ObjectLogger } from '@objectstack/core';
import { AutomationEngine, type SuspendedRun, type SuspendedRunStore } from './engine.js';

// ── fixtures ───────────────────────────────────────────────────────────────

/**
 * What a database driver's failure looks like when it is not one line. Postgres
 * (`error: … \n  detail: … \n  hint: …`) and better-sqlite3 wrappers both do
 * this; the in-repo drivers happen to be single-line today, which is why #5912
 * is a `finding` and not an outage report. Byte-identical to the fixture
 * `builtin/wait-node-log-cause.test.ts` and `plugin-startup-log-cause.test.ts`
 * use, because it is the same accident.
 */
const MULTILINE_DRIVER = [
    'SQLITE_ERROR: no such table: sys_automation_run',
    '  at Database.prepare (better-sqlite3/lib/methods/wrappers.js:5:21)',
    '  hint: run `os migrate` for this datasource, or set OS_SKIP_SCHEMA_SYNC=0',
].join('\n');

/** Today's in-repo shape: one line, no continuation. */
const SINGLE_LINE_DRIVER = 'connection refused';

const RUN_ID = 'run_parked_before_restart';

/**
 * A store that persisted fine and then cannot be READ back — the #4420 case
 * `loadSuspendedRunStrict` exists for. `load()` throwing is what separates
 * "the store is down, retry" from "this run is gone for good".
 */
function unreadableStore(message: string): SuspendedRunStore {
    return {
        async save() {},
        async load(): Promise<SuspendedRun | null> {
            throw new Error(message);
        },
        async delete() {},
        async list(): Promise<SuspendedRun[]> {
            return [];
        },
    };
}

function silent(): any {
    const l: any = { info() {}, warn() {}, error() {}, debug() {} };
    l.child = () => l;
    return l;
}

/** Capture everything written to one std stream while `fn` runs, split to lines. */
async function captureStream(which: 'stdout' | 'stderr', fn: () => Promise<void>): Promise<string[]> {
    const chunks: string[] = [];
    const spy = vi.spyOn(process[which], 'write').mockImplementation(((c: string | Uint8Array) => {
        chunks.push(String(c));
        return true;
    }) as never);
    try {
        await fn();
    } finally {
        spy.mockRestore();
    }
    return chunks.join('').split('\n').filter((l) => l.length > 0);
}

/**
 * `ObjectLogger`'s `pretty`/`text` record head — the same predicate
 * `classifyBootLogLine` applies in `packages/cli/src/utils/boot-log-capture.ts`.
 * Re-stated rather than imported: this package must not depend on
 * `@objectstack/cli`, and the predicate is the general one every line-based
 * consumer keys off.
 */
const RECORD_HEAD = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z(?: \|)? (DEBUG|INFO|WARN|ERROR|FATAL)\b/;

type Record_ = { level: string; msg: string; error?: string; issues?: unknown };

/** The single JSON record on `lines`, parsed. */
function soleRecord(lines: string[]): Record_ {
    expect(lines, 'one call, one physical line').toHaveLength(1);
    return JSON.parse(lines[0]) as Record_;
}

/**
 * Resume a run whose store cannot be read, capturing only stderr.
 *
 * Nothing is cached in this process — that is the point: the engine is a fresh
 * "second process" whose hot cache is empty, so `loadSuspendedRunStrict` reaches
 * the store and the store throws. The gate the public `resume()` runs first
 * (`refuseGatedResume`) uses the DEGRADING loader, which swallows the same
 * failure into a `warn` on **stdout**; capturing stderr isolates the seam under
 * test from it. (That `warn` splices the driver text too — a sibling defect in
 * the same file, out of this issue's nailed scope and filed separately.)
 */
async function resumeAgainstUnreadableStore(
    log: ObjectLogger,
    driverMessage: string,
): Promise<{ lines: string[]; result: Awaited<ReturnType<AutomationEngine['resume']>> }> {
    const engine = new AutomationEngine(log, unreadableStore(driverMessage));
    let result!: Awaited<ReturnType<AutomationEngine['resume']>>;
    const lines = await captureStream('stderr', async () => {
        result = await engine.resume(RUN_ID);
    });
    return { lines, result };
}

// ── the seam: `resumeInternal`'s store-unreachable durability alarm ─────────

describe('#5912 — the resume store-unreachable alarm is ONE stderr record', () => {
    it("the driver's multi-line failure never reaches the log message", async () => {
        const log = new ObjectLogger({ level: 'error', format: 'json' });
        const { lines } = await resumeAgainstUnreadableStore(log, MULTILINE_DRIVER);

        const record = soleRecord(lines);
        expect(record.level).toBe('error');
        expect(record.msg).not.toContain('\n');
        // #4632 demands the consequence and the fix in the record's own line,
        // and moving the cause out must not cost either.
        expect(record.msg, 'which run').toContain(RUN_ID);
        expect(record.msg, 'the consequence').toContain('NOT consumed');
        expect(record.msg, 'the run survived').toContain('stays parked');
        expect(record.msg, 'the fix').toContain('retried verbatim once the store is reachable');
        expect(record.msg, 'where the cause went').toContain("record's meta");
        // Not a validation rejection → `error`, and the WHOLE driver text
        // survives, its newlines escaped by the logger's JSON.stringify.
        expect(record.issues).toBeUndefined();
        expect(record.error).toBe(MULTILINE_DRIVER);
        expect(record.msg).not.toContain('no such table');
        expect(record.msg).not.toContain('better-sqlite3');
    });

    it('stays one physical line in `pretty`, the format `os dev` / `os serve` default to', async () => {
        // The JSON case above cannot fail the way #5912 reports, because
        // JSON.stringify escapes the newlines either way. This is the format the
        // family's measurements were taken in.
        const log = new ObjectLogger({ level: 'error', format: 'pretty' });
        const { lines } = await resumeAgainstUnreadableStore(log, MULTILINE_DRIVER);

        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(RECORD_HEAD);
        // Every fact is on the one line that a `grep ERROR` returns.
        expect(lines[0]).toContain('durable suspended-run store unreachable while resuming');
        expect(lines[0]).toContain('better-sqlite3');
        expect(lines[0]).toContain('run `os migrate` for this datasource');
    });

    it("calls error(message, undefined, meta) — the contract's third slot", async () => {
        const error = vi.spyOn(ObjectLogger.prototype, 'error');
        const log = new ObjectLogger({ level: 'error', format: 'json' });
        await resumeAgainstUnreadableStore(log, MULTILINE_DRIVER);

        const call = error.mock.calls.find((c) => String(c[0]).includes('store unreachable while resuming'));
        expect(call, 'the seam logged at error level').toBeDefined();
        const [message, errorSlot, meta] = call as unknown as [string, unknown, Record<string, unknown>];
        expect(message).not.toContain('\n');
        // The second slot stays empty on purpose: a raw `Error` there ships its
        // stack into the record (#5575).
        expect(errorSlot).toBeUndefined();
        expect(meta).toBeDefined();
        expect(meta.error).toBe(MULTILINE_DRIVER);
        error.mockRestore();
    });

    it('stays at `error` — a parked run that did not resume is a #4632 durability degradation', async () => {
        // Not a style pin. The store is unreachable while the run itself is on
        // disk: from the outside everything looks healthy and the resume simply
        // did not land, which is the class #4632 put at `error`. Downgrading it
        // is the regression this asserts against.
        const log = new ObjectLogger({ level: 'warn', format: 'json' });
        const { lines } = await resumeAgainstUnreadableStore(log, MULTILINE_DRIVER);
        const levels = lines.map((l) => (JSON.parse(l) as Record_).level);
        expect(levels).toContain('error');
    });

    it('renders a single-line driver failure in exactly the same shape — the fix is unconditional', async () => {
        // Today's in-repo drivers are all single-line, which is why #5912 is a
        // finding. The seam must not branch on that: same one record, same
        // newline-free message, same `meta.error` — so the day a driver wraps a
        // multi-line SDK error nothing about the record's shape changes.
        const log = new ObjectLogger({ level: 'error', format: 'json' });
        const { lines } = await resumeAgainstUnreadableStore(log, SINGLE_LINE_DRIVER);

        const record = soleRecord(lines);
        expect(record.level).toBe('error');
        expect(record.msg).not.toContain('\n');
        expect(record.msg).toContain(RUN_ID);
        expect(record.error).toBe(SINGLE_LINE_DRIVER);
        expect(record.msg).not.toContain(SINGLE_LINE_DRIVER);
    });
});

// ── the deliberate non-change: the result envelope ──────────────────────────

describe('#5912 — the STORE_UNAVAILABLE result envelope is byte-identical to before', () => {
    /**
     * The envelope is NOT a log record. It is the structured value the caller
     * reads — `AutomationResult.error`, `spec/contracts/automation-service.ts` —
     * and over REST it travels as a JSON string field that no consumer splits on
     * newlines. #5636 kept `degradedReason` verbatim for the same reason, and PR
     * #5911 already made the one line-oriented consumer of this envelope
     * (wait-node's timer wake-up) put it into its own record's `meta` intact.
     *
     * So this is a pin against a plausible future tidy-up, not a description of
     * the fix: whoever next reads "#5912 moved the cause to meta" must find here
     * that the envelope was excluded ON PURPOSE.
     */
    const expectedEnvelope = (driver: string) =>
        `Durable suspended-run store unreachable for run '${RUN_ID}' — retry once the store is available: ${driver}`;

    it('keeps the multi-line driver text spliced in, verbatim', async () => {
        const { result } = await resumeAgainstUnreadableStore(
            new ObjectLogger({ level: 'error', format: 'json' }),
            MULTILINE_DRIVER,
        );

        expect(result.success).toBe(false);
        expect(result.code).toBe('STORE_UNAVAILABLE');
        expect(result.error).toBe(expectedEnvelope(MULTILINE_DRIVER));
        // The property the #4420 caller depends on, unchanged.
        expect(result.error).toMatch(/retry once the store is available/);
    });

    it('keeps a single-line driver text spliced in, verbatim', async () => {
        const { result } = await resumeAgainstUnreadableStore(
            new ObjectLogger({ level: 'error', format: 'json' }),
            SINGLE_LINE_DRIVER,
        );

        expect(result.code).toBe('STORE_UNAVAILABLE');
        expect(result.error).toBe(expectedEnvelope(SINGLE_LINE_DRIVER));
    });

    it('reports STORE_UNAVAILABLE rather than RUN_NOT_FOUND — #4420 still holds', async () => {
        // The whole reason this catch exists. A silent logger keeps this case
        // about the RESULT only.
        const engine = new AutomationEngine(silent(), unreadableStore(MULTILINE_DRIVER));
        const result = await engine.resume(RUN_ID);
        expect(result.code).toBe('STORE_UNAVAILABLE');
        expect(result.code).not.toBe('RUN_NOT_FOUND');
    });
});
