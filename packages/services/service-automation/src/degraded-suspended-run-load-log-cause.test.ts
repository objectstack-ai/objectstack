// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression: #6230 — `engine.ts`'s DEGRADING suspended-run reader,
// `loadSuspendedRun`, interpolated a FOREIGN cause into a log MESSAGE. It is
// the other half of the same failure #5912 (PR #6228) closed: both catches sit
// around `loadSuspendedRunStrict`, and one "store unreachable while resuming"
// incident walks through both.
//
// The seventh instalment of the family #5048 (flow binding, PR #5572), #5575
// (`reconcileDeclaredConnectors`, PR #5639), #5636 (`degradeConnectorInstance`,
// PR #5662), #5661 (`plugin.ts`'s three startup seams), #5737
// (`builtin/wait-node.ts`'s five, PR #5911) and #5912 (`resumeInternal`, PR
// #6228) closed.
//
// ## Why this seam is the `warn` half, and why that makes it WORSE
//
// `ObjectLogger.write()` (packages/core/src/logger.ts) emits one
// `<ts> <LEVEL> <message>` record per call, so a message carrying newlines
// becomes several physical lines of which only the FIRST has a level head. That
// much is the whole family's shared harm: a `grep WARN` returns the one line
// that holds no facts.
//
// On top of it, `ObjectLogger` routes `debug`/`info`/`warn` to **stdout** and
// only `error`/`fatal` to stderr, and `serve`'s boot-quiet window wraps
// `process.stdout.write` alone. Inside that window
// `BootLogCapture.offer()` (packages/cli/src/utils/boot-log-capture.ts) retains
// a physical line ONLY when `classifyBootLogLine` finds a level head on it — so
// for a `warn` the continuation lines are not merely misread, they are
// **dropped**. #5912's seam is an `error` on stderr and never meets that
// filter; this one does, and `bootFilterRetains()` below pins the difference in
// this package without importing `@objectstack/cli`.
//
// And it is live during boot, not only in theory: `plugin.ts` `start()` calls
// `rearmSuspendedWaitTimers`, which calls `engine.resume(run.runId)` for every
// overdue run, and the public `resume()` runs its authorization gate
// (`refuseGatedResume` → `resolveEffectiveSuspension`) through THIS degrading
// reader before `resumeInternal` ever takes the strict one.
//
// ## The fix, and the one thing deliberately NOT changed
//
// Identical to the six prior instalments, zero new vocabulary: a static,
// newline-free message plus the cause in the logger's structured slot. The
// SLOT's position differs from #5912's, and that is the one place a copy of PR
// #6228 would go wrong: the `Logger` contract
// (`packages/spec/src/contracts/logger.ts`) declares
// `warn(message, meta?)` — `warn` has no `Error` slot, so `meta` is the
// **second** argument, not the third.
//
// The LEVEL stays `warn`, and that is a decision, not an omission. #4632 puts a
// *durability* degradation at `error`; this reader's entire contract is
// "best-effort answer for an incidental caller" (a gate lookup, a screen fetch)
// and `resumeInternal` uses the strict form exactly where the difference
// matters. Raising it would be #4632's mirror-image misuse — an alarm on every
// gate lookup for the duration of an outage — so `the level is not raised`
// below asserts against that, and `check:durability-degradation-log-level`
// keeps judging the seam it actually owns.
//
// Assertions read REAL BYTES off a REAL `ObjectLogger` wherever the question is
// "what would a line-oriented consumer see", per the #5662 / #5661 / #5737 /
// #5912 precedent — a spy proves what the seam *called*, not what the
// downstream splitter *sees*, and it was the latter that cost cloud#971 a
// release line. Spies appear only where the argument SLOT is itself the fact
// under test.

import { describe, it, expect, vi } from 'vitest';
import { ObjectLogger } from '@objectstack/core';
import { AutomationEngine, type SuspendedRun, type SuspendedRunStore } from './engine.js';

// ── fixtures ───────────────────────────────────────────────────────────────

/**
 * What a database driver's failure looks like when it is not one line. Postgres
 * (`error: … \n  detail: … \n  hint: …`) and better-sqlite3 wrappers both do
 * this; the in-repo drivers happen to be single-line today, which is why #6230
 * is a `finding` and not an outage report. Byte-identical to the fixture
 * `resume-store-unreachable-log-cause.test.ts`, `builtin/wait-node-log-cause.test.ts`
 * and `plugin-startup-log-cause.test.ts` use, because it is the same accident.
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
 * A store that persisted fine and then cannot be READ back — the #4420 case the
 * strict/degrading pair exists for. `load()` throwing is what separates "the
 * store is down" from "this run is gone for good"; the degrading reader
 * deliberately collapses the two, which is what its record has to say out loud.
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

// ── real-byte capture ──────────────────────────────────────────────────────

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

/** Capture BOTH streams at once — for the cases about which stream a record lands on. */
async function captureBoth(fn: () => Promise<void>): Promise<{ stdout: string[]; stderr: string[] }> {
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

/**
 * `serve`'s boot-quiet filter, re-stated.
 *
 * A faithful mirror of `classifyBootLogLine` + `isBootDiagnostic` from
 * `packages/cli/src/utils/boot-log-capture.ts`: strip SGR color, then keep a
 * physical line only if it carries a `<ts> <LEVEL>` head (pretty/text) or parses
 * as a JSON record with `time` + `level`, at or above the `warn` floor.
 * Everything else `BootLogCapture.offer()` discards.
 *
 * Re-stated rather than imported on purpose — this package must not depend on
 * `@objectstack/cli`, and the predicate is the general one every line-based
 * consumer keys off. It is the DROP semantics #6230 is about, so it is measured
 * here rather than described in prose.
 */
function bootFilterRetains(lines: readonly string[]): string[] {
    // The SGR escape is built from its CHAR CODE rather than written as a
    // `\u001B` regex escape: an editing tool materializes that escape into a
    // real control byte exactly when you are writing about one, and a raw
    // control byte in a source file renders as nothing and is unfindable in
    // both spellings (scripts/check-nul-bytes.mjs's header argues the harms).
    const SGR = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, 'g');
    const HEAD = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z(?: \|)? (DEBUG|INFO|WARN|ERROR|FATAL)\b/;
    const AT_OR_ABOVE_WARN = new Set(['warn', 'error', 'fatal']);
    return lines.filter((raw) => {
        const line = raw.replace(SGR, '').trim();
        if (!line) return false;
        if (line.startsWith('{')) {
            try {
                const rec = JSON.parse(line) as { time?: unknown; level?: unknown };
                if (typeof rec.time !== 'string' || typeof rec.level !== 'string') return false;
                return AT_OR_ABOVE_WARN.has(rec.level.toLowerCase());
            } catch {
                return false;
            }
        }
        const match = HEAD.exec(line);
        return match ? AT_OR_ABOVE_WARN.has(match[1].toLowerCase()) : false;
    });
}

/** Same head predicate, for the pretty-format assertions. */
const RECORD_HEAD = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z(?: \|)? (DEBUG|INFO|WARN|ERROR|FATAL)\b/;

type Record_ = { level: string; msg: string; error?: string; issues?: unknown };

/** The single JSON record on `lines`, parsed. */
function soleRecord(lines: string[]): Record_ {
    expect(lines, 'one call, one physical line').toHaveLength(1);
    return JSON.parse(lines[0]) as Record_;
}

/**
 * Drive the seam through `getSuspendedScreen`, capturing stdout.
 *
 * The cleanest public route to the degrading reader: one call in, one
 * `loadSuspendedRun` out, nothing else logged — so a physical-line COUNT on the
 * captured bytes is a reading of this record alone. Nothing is cached in this
 * process, which is the point: the hot cache is empty the way a restarted
 * process's is, so the read reaches the store and the store throws.
 *
 * `resume()` reaches the same reader through the gate (see the boot-path case
 * further down), but also produces #5912's stderr record; this route keeps the
 * count unambiguous.
 */
async function readScreenAgainstUnreadableStore(
    log: ObjectLogger,
    driverMessage: string,
): Promise<{ lines: string[]; screen: unknown }> {
    const engine = new AutomationEngine(log, unreadableStore(driverMessage));
    let screen: unknown;
    const lines = await captureStream('stdout', async () => {
        screen = await engine.getSuspendedScreen(RUN_ID);
    });
    return { lines, screen };
}

// ── the seam: the degrading reader's store-unreadable notice ────────────────

describe('#6230 — the degrading suspended-run read logs ONE stdout record', () => {
    it("the driver's multi-line failure never reaches the log message", async () => {
        const log = new ObjectLogger({ level: 'warn', format: 'json' });
        const { lines } = await readScreenAgainstUnreadableStore(log, MULTILINE_DRIVER);

        const record = soleRecord(lines);
        expect(record.level).toBe('warn');
        expect(record.msg).not.toContain('\n');
        // The record still has to say which run, what the failure was turned
        // into, and where the cause went.
        expect(record.msg, 'which run').toContain(RUN_ID);
        expect(record.msg, 'the degradation').toContain('DEGRADES to null');
        // #6230's "consequence" clause: the old text said the read failed and
        // stopped there, never that the failure had been TRANSLATED into "no
        // such suspended run" for the caller.
        expect(record.msg, 'what the caller is handed').toContain(
            'sees exactly what it would see if no suspension existed under that id',
        );
        expect(record.msg, 'the run survived').toContain('stays parked');
        expect(record.msg, 'where the cause went').toContain("this record's meta");
        // Not a validation rejection → `error`, and the WHOLE driver text
        // survives, its newlines escaped by the logger's JSON.stringify.
        expect(record.issues).toBeUndefined();
        expect(record.error).toBe(MULTILINE_DRIVER);
        expect(record.msg).not.toContain('no such table');
        expect(record.msg).not.toContain('better-sqlite3');
    });

    it('stays one physical line in `pretty`, the format `os dev` / `os serve` default to', async () => {
        // The JSON case above cannot fail the way #6230 reports, because
        // JSON.stringify escapes the newlines either way. This is the format the
        // family's measurements were taken in.
        const log = new ObjectLogger({ level: 'warn', format: 'pretty' });
        const { lines } = await readScreenAgainstUnreadableStore(log, MULTILINE_DRIVER);

        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(RECORD_HEAD);
        // Every fact is on the one line a `grep WARN` returns.
        expect(lines[0]).toContain('durable suspended-run store unreadable for run');
        expect(lines[0]).toContain('better-sqlite3');
        expect(lines[0]).toContain('run `os migrate` for this datasource');
    });

    it("survives `serve`'s boot-quiet filter whole — the drop this seam's level exposes it to", async () => {
        // The harm #6230 carries over #5912. `warn` goes to stdout, which is the
        // stream `serve` quiets during boot, and `BootLogCapture.offer()` keeps a
        // physical line only when it finds a level head — so a shredded record
        // loses its continuation lines OUTRIGHT rather than merely arriving
        // unattributable. Reachable for real: `plugin.ts` start() →
        // `rearmSuspendedWaitTimers` → `engine.resume()` → the gate → here.
        const log = new ObjectLogger({ level: 'warn', format: 'pretty' });
        const { lines } = await readScreenAgainstUnreadableStore(log, MULTILINE_DRIVER);

        const retained = bootFilterRetains(lines);
        expect(retained, 'nothing this seam emitted is dropped').toEqual(lines);
        // The point of surviving: the retained bytes still carry the cause. A
        // shredded record retains its first line too — and that line is exactly
        // the one with no facts on it.
        expect(retained.join('\n')).toContain('SQLITE_ERROR: no such table');
        expect(retained.join('\n')).toContain('hint: run `os migrate`');
    });

    it('hands the cause to warn(message, meta) — the second slot, not the third', async () => {
        // The one place copying PR #6228 verbatim would break: `error` takes
        // `(message, error?, meta?)` and `warn` takes `(message, meta?)`. A
        // `meta` passed third to `warn` is silently ignored.
        const warn = vi.spyOn(ObjectLogger.prototype, 'warn');
        const log = new ObjectLogger({ level: 'warn', format: 'json' });
        await readScreenAgainstUnreadableStore(log, MULTILINE_DRIVER);

        const call = warn.mock.calls.find((c) => String(c[0]).includes('durable suspended-run store unreadable'));
        expect(call, 'the seam logged at warn level').toBeDefined();
        const [message, meta, third] = call as unknown as [string, Record<string, unknown>, unknown];
        expect(message).not.toContain('\n');
        expect(meta, 'meta is the SECOND argument on `warn`').toBeDefined();
        expect(meta.error).toBe(MULTILINE_DRIVER);
        expect(meta.issues).toBeUndefined();
        expect(third, '`warn` has no third parameter to put it in').toBeUndefined();
        warn.mockRestore();
    });

    it('the level is not raised — a best-effort read degrading is #4632 FUNCTIONAL, not durability', async () => {
        // Not a style pin, and the inverse of `resume-store-unreachable-log-cause`'s
        // level case. This reader's declared contract is a best-effort answer for
        // an incidental caller; nothing the system claimed to persist has been
        // lost here, and `resumeInternal` takes the STRICT reader precisely where
        // the difference matters. Raising this to `error` would fire on every gate
        // lookup for the duration of an outage — #4632's mirror-image misuse, and
        // the regression this asserts against.
        const log = new ObjectLogger({ level: 'debug', format: 'json' });
        const engine = new AutomationEngine(log, unreadableStore(MULTILINE_DRIVER));
        const { stdout, stderr } = await captureBoth(async () => {
            await engine.getSuspendedScreen(RUN_ID);
        });

        expect(stderr, 'nothing on the error stream').toEqual([]);
        const record = soleRecord(stdout);
        expect(record.level).toBe('warn');
    });

    it('still degrades to null — the fix is to the record, not to the behaviour', async () => {
        const { screen } = await readScreenAgainstUnreadableStore(
            new ObjectLogger({ level: 'warn', format: 'json' }),
            MULTILINE_DRIVER,
        );
        expect(screen).toBeNull();
    });

    it('renders a single-line driver failure in exactly the same shape — the fix is unconditional', async () => {
        // Today's in-repo drivers are all single-line, which is why #6230 is a
        // finding. The seam must not branch on that: same one record, same
        // newline-free message, same `meta.error` — so the day a driver wraps a
        // multi-line SDK error nothing about the record's shape changes.
        const log = new ObjectLogger({ level: 'warn', format: 'json' });
        const { lines } = await readScreenAgainstUnreadableStore(log, SINGLE_LINE_DRIVER);

        const record = soleRecord(lines);
        expect(record.level).toBe('warn');
        expect(record.msg).not.toContain('\n');
        expect(record.msg).toContain(RUN_ID);
        expect(record.error).toBe(SINGLE_LINE_DRIVER);
        expect(record.msg).not.toContain(SINGLE_LINE_DRIVER);
    });
});

// ── the two halves of one failure, now both clean ───────────────────────────

describe('#6230 — one "store unreachable while resuming" incident, both records greppable', () => {
    /**
     * The reason this issue exists as #5912's sibling rather than as its own
     * unrelated finding. `resume()` walks BOTH catches around
     * `loadSuspendedRunStrict`:
     *
     *   gate  → `refuseGatedResume` → `resolveEffectiveSuspension` →
     *           `loadSuspendedRun`  → this seam,       `warn`  → **stdout**
     *   then  → `resumeInternal`    → strict read      → #5912, `error` → stderr
     *
     * PR #6228 made the stderr one a single line; until this change the stdout
     * one was still shredded, which is why #6228's own test had to isolate
     * itself by capturing stderr only. This case is the whole-path reading that
     * neither issue could take alone.
     */
    it('emits exactly one clean record per stream, and the driver text is in neither message', async () => {
        const log = new ObjectLogger({ level: 'warn', format: 'json' });
        const engine = new AutomationEngine(log, unreadableStore(MULTILINE_DRIVER));

        let result!: Awaited<ReturnType<AutomationEngine['resume']>>;
        const { stdout, stderr } = await captureBoth(async () => {
            result = await engine.resume(RUN_ID);
        });

        const degraded = soleRecord(stdout);
        expect(degraded.level).toBe('warn');
        expect(degraded.msg).not.toContain('\n');
        expect(degraded.error).toBe(MULTILINE_DRIVER);

        const alarm = soleRecord(stderr);
        expect(alarm.level).toBe('error');
        expect(alarm.msg).not.toContain('\n');
        expect(alarm.error).toBe(MULTILINE_DRIVER);

        // The result the caller gets is #5912's, unchanged by this PR: the gate
        // degrading to `null` lets `resumeInternal` take the strict read, which
        // is what distinguishes an outage from a missing run (#4420).
        expect(result.code).toBe('STORE_UNAVAILABLE');
    });

    it('both records survive the boot-quiet filter — the boot path this is reachable from', async () => {
        // In `pretty`, the format `serve` actually boots under. stdout is the
        // filtered stream; stderr bypasses the window entirely, and is asserted
        // here only to show the pair arrives intact.
        const log = new ObjectLogger({ level: 'warn', format: 'pretty' });
        const engine = new AutomationEngine(log, unreadableStore(MULTILINE_DRIVER));
        const { stdout, stderr } = await captureBoth(async () => {
            await engine.resume(RUN_ID);
        });

        expect(stdout).toHaveLength(1);
        expect(stderr).toHaveLength(1);
        expect(bootFilterRetains(stdout)).toEqual(stdout);
        expect(stdout[0]).toContain('hint: run `os migrate`');
        expect(stderr[0]).toContain('hint: run `os migrate`');
    });
});
