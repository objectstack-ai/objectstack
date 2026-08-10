// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression: #6299 — the last three seams of `engine.ts` that interpolated a
// FOREIGN cause into a log MESSAGE, all three of them catches around the
// `SuspendedRunStore` driver: `forgetSuspendedRun` (`store.delete`),
// `cancelRun` (`store.load`) and `listSuspendedRunsDurable` (`store.list`).
//
// The eighth instalment of the family #5048 (flow binding, PR #5572), #5575
// (`reconcileDeclaredConnectors`, PR #5639), #5636 (`degradeConnectorInstance`,
// PR #5662), #5661 (`plugin.ts`'s three startup seams), #5737
// (`builtin/wait-node.ts`'s five, PR #5911), #5912 (`resumeInternal`, PR #6228)
// and #6230 (`loadSuspendedRun`, PR #6297) closed.
//
// ## The shared half: the message
//
// `ObjectLogger.write()` (packages/core/src/logger.ts) emits one
// `<ts> <LEVEL> <message>` record per call, so a message carrying newlines
// becomes several physical lines of which only the FIRST has a level head.
// A file sink stores the rest as their own headless records and a
// `grep WARN`/`grep ERROR` returns the one line that holds no facts. The thrown
// value at all three seams is the datasource DRIVER's own text, whose line
// count we do not control. cloud#971 is this exact shape.
//
// ## The half that is NOT shared: the level
//
// ⛔ #6230's "the level stays warn" is NOT a template. Each seam's #4632
// verdict was taken on its own consequence path, and they do not agree:
//
//   - `forgetSuspendedRun` → **error** (durability). The hot cache is dropped
//     BEFORE the try and this is the single choke point every consumption of a
//     suspension passes through, so a failed `delete` leaves the suspension
//     gone in-process and the durable row alive. Callers report success; the
//     surviving row is re-listed and re-resumed after the next restart, running
//     a continuation that already ran. The durability gate's own vocabulary
//     grades the same shape `error` for the metadata store
//     (`deleteMetaItemFromLoader`, #5259).
//   - `cancelRun` → **error** (durability). The failed read becomes "no such
//     suspended run" and the method returns `false`, which its contract calls
//     idempotent success, so the cancellation is skipped while the call reads
//     clean. `plugin-approvals`' revise-window recall never reads that boolean
//     — it only catches a THROW, which it grades `error` with "the run may be
//     stranded" (#4420). The store-read failure strands the run without firing
//     that alarm.
//   - `listSuspendedRunsDurable` → **warn**, unchanged (functional). Nothing
//     that was claimed persisted failed to land: the rows are intact, resumable
//     by id, and the next boot's `rearmSuspendedWaitTimers` still re-arms them
//     off its own `store.list()`. The defect is an INVENTED short answer
//     (#5186's shape), whose remedy is propagation — a return-contract change
//     outside #6299 — so the record has to say the shortfall out loud instead.
//     Raising it would alarm for the duration of an outage on a read nothing
//     acts on: #4632's mirror-image misuse.
//
// `check:durability-log-level` grades none of the three: its write-rule
// vocabulary (`DURABILITY_CRITICAL_CALLEES`) does not name `SuspendedRunStore`'s
// methods, and its read-seam rule's scan roots (`packages/metadata`,
// `metadata-protocol`, `objectql`) do not reach this package. The level pins
// below are therefore the ONLY thing holding these three verdicts.
//
// ## The boot-quiet filter reaches exactly one of the three, and that changed
//
// `ObjectLogger` routes `debug`/`info`/`warn` to **stdout** and `error`/`fatal`
// to **stderr**, and `serve`'s boot-quiet window wraps `process.stdout.write`
// ALONE (packages/cli/src/commands/serve.ts), where `BootLogCapture.offer()`
// keeps a physical line only when `classifyBootLogLine` finds a level head —
// continuation lines are DROPPED, not merely misread. So the drop mechanism
// applies to `listSuspendedRunsDurable` and, as a side effect of their level
// change, no longer to the other two. That side effect is measured below rather
// than claimed, and it is NOT the reason either level was raised.
//
// Assertions read REAL BYTES off a REAL `ObjectLogger` wherever the question is
// "what would a line-oriented consumer see", per the #5662 / #5661 / #5737 /
// #5912 / #6230 precedent — a spy proves what the seam *called*, not what the
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
 * this; the in-repo drivers happen to be single-line today, which is why #6299
 * is a `finding` and not an outage report. Byte-identical to the fixture
 * `degraded-suspended-run-load-log-cause.test.ts`,
 * `resume-store-unreachable-log-cause.test.ts` and
 * `plugin-startup-log-cause.test.ts` use, because it is the same accident.
 */
const MULTILINE_DRIVER = [
    'SQLITE_ERROR: no such table: sys_automation_run',
    '  at Database.prepare (better-sqlite3/lib/methods/wrappers.js:5:21)',
    '  hint: run `os migrate` for this datasource, or set OS_SKIP_SCHEMA_SYNC=0',
].join('\n');

/** Today's in-repo shape: one line, no continuation. */
const SINGLE_LINE_DRIVER = 'connection refused';

const RUN_ID = 'run_parked_before_restart';

/** A suspension as it sits in the durable store — enough for the seams under test. */
function storedRun(runId = RUN_ID): SuspendedRun {
    return {
        runId,
        flowName: 'expense_approval',
        nodeId: 'await_manager',
        // No `nodeType`, and no flow is registered on these bare engines, so
        // `resolveSuspendedNodeType` finds nothing and `releaseSuspension`
        // returns before logging anything. The record counts below are readings
        // of the seam under test alone.
        variables: {},
        steps: [],
        context: {} as SuspendedRun['context'],
        startedAt: new Date().toISOString(),
        startTime: Date.now(),
    };
}

/**
 * A store whose rows are readable but whose DELETE fails — `forgetSuspendedRun`'s
 * seam. The suspension is handed back by `load`, so the consumption proceeds all
 * the way to the delete and then loses only the durable half.
 */
function undeletableStore(message: string): SuspendedRunStore {
    return {
        async save() {},
        async load(): Promise<SuspendedRun | null> {
            return storedRun();
        },
        async delete(): Promise<void> {
            throw new Error(message);
        },
        async list(): Promise<SuspendedRun[]> {
            return [];
        },
    };
}

/** A store that persisted fine and then cannot be READ back — `cancelRun`'s seam. */
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

/** A store that cannot be ENUMERATED — `listSuspendedRunsDurable`'s seam. */
function unlistableStore(message: string): SuspendedRunStore {
    return {
        async save() {},
        async load(): Promise<SuspendedRun | null> {
            return null;
        },
        async delete() {},
        async list(): Promise<SuspendedRun[]> {
            throw new Error(message);
        },
    };
}

// ── real-byte capture ──────────────────────────────────────────────────────

/**
 * Capture BOTH streams at once.
 *
 * Always both, never one: every seam here has a STREAM claim as part of its
 * #4632 verdict (the two durability seams must be on stderr and silent on
 * stdout, the functional one the reverse), and a single-stream capture can only
 * assert where a record IS, never that the other stream stayed empty.
 */
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
 * consumer keys off. Copied verbatim from
 * `degraded-suspended-run-load-log-cause.test.ts` (#6230), which is where it was
 * measured.
 */
function bootFilterRetains(lines: readonly string[]): string[] {
    // The SGR escape is built from its CHAR CODE rather than written as a
    // backslash-u001B regex escape (spelled out here rather than pasted, which
    // is the whole point): an editing tool materializes that escape into a real
    // control byte exactly when you are writing about one, and a raw control
    // byte in a source file renders as nothing and is unfindable in both
    // spellings (scripts/check-nul-bytes.mjs's header argues the harms). This
    // very line grew a raw 0x1B while being copied from #6230's test — caught by
    // the beyond-the-gate self-scan, not by `check:nul-bytes`, which only reads
    // TRACKED files and so cannot see a new test file before its first commit.
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

// ── drivers for the three seams ────────────────────────────────────────────
//
// Every engine here is bare (`new AutomationEngine(log, store)`): no flow, no
// node executor, so nothing else logs. `level: 'warn'` also suppresses
// `recordLog`'s terminal run-summary `info` line, which would otherwise share
// stdout with the seam under test and make a physical-line COUNT ambiguous.

/** `cancelRun` on a readable store whose DELETE throws → `forgetSuspendedRun`'s seam. */
async function cancelAgainstUndeletableStore(
    log: ObjectLogger,
    driverMessage: string,
): Promise<{ streams: { stdout: string[]; stderr: string[] }; cancelled: boolean }> {
    const engine = new AutomationEngine(log, undeletableStore(driverMessage));
    let cancelled = false;
    const streams = await captureBoth(async () => {
        cancelled = await engine.cancelRun(RUN_ID, 'recalled during revision');
    });
    return { streams, cancelled };
}

/** `cancelRun` on an unreadable store → `cancelRun`'s own seam. */
async function cancelAgainstUnreadableStore(
    log: ObjectLogger,
    driverMessage: string,
): Promise<{ streams: { stdout: string[]; stderr: string[] }; cancelled: boolean }> {
    const engine = new AutomationEngine(log, unreadableStore(driverMessage));
    let cancelled = false;
    const streams = await captureBoth(async () => {
        cancelled = await engine.cancelRun(RUN_ID, 'recalled during revision');
    });
    return { streams, cancelled };
}

/** `listSuspendedRunsDurable` on a store that cannot be enumerated. */
async function listAgainstUnlistableStore(
    log: ObjectLogger,
    driverMessage: string,
): Promise<{ streams: { stdout: string[]; stderr: string[] }; listed: unknown[] }> {
    const engine = new AutomationEngine(log, unlistableStore(driverMessage));
    let listed: unknown[] = [];
    const streams = await captureBoth(async () => {
        listed = await engine.listSuspendedRunsDurable();
    });
    return { streams, listed };
}

// ── seam 1: forgetSuspendedRun — the durable row that outlived its suspension ─

describe("#6299 — forgetSuspendedRun's failed delete logs ONE stderr record", () => {
    it("the driver's multi-line failure never reaches the log message", async () => {
        const log = new ObjectLogger({ level: 'warn', format: 'json' });
        const { streams } = await cancelAgainstUndeletableStore(log, MULTILINE_DRIVER);

        const record = soleRecord(streams.stderr);
        expect(record.msg).not.toContain('\n');
        // The record has to say which run, what survived, and where the cause is.
        expect(record.msg, 'which run').toContain(RUN_ID);
        expect(record.msg, 'why it was being deleted').toContain('was consumed (cancelled)');
        expect(record.msg, 'what survived').toContain('durable row SURVIVES');
        expect(record.msg, 'the consequence').toContain('re-runs a continuation that has already run');
        expect(record.msg, 'nobody will retry it').toContain('Nothing retries this delete');
        expect(record.msg, 'where the cause went').toContain("this record's meta");
        // Not a validation rejection → `error`, and the WHOLE driver text
        // survives, its newlines escaped by the logger's JSON.stringify.
        expect(record.issues).toBeUndefined();
        expect(record.error).toBe(MULTILINE_DRIVER);
        expect(record.msg).not.toContain('no such table');
        expect(record.msg).not.toContain('better-sqlite3');
    });

    it('stays one physical line in `pretty`, the format `os dev` / `os serve` default to', async () => {
        // The JSON case above cannot fail the way #6299 reports — JSON.stringify
        // escapes the newlines either way. This is the format the family's
        // measurements were taken in.
        const log = new ObjectLogger({ level: 'warn', format: 'pretty' });
        const { streams } = await cancelAgainstUndeletableStore(log, MULTILINE_DRIVER);

        expect(streams.stderr).toHaveLength(1);
        expect(streams.stderr[0]).toMatch(RECORD_HEAD);
        // Every fact is on the one line a `grep ERROR` returns.
        expect(streams.stderr[0]).toContain('could NOT be deleted from the durable store');
        expect(streams.stderr[0]).toContain('better-sqlite3');
        expect(streams.stderr[0]).toContain('run `os migrate` for this datasource');
    });

    it('#4632: DURABILITY — the level is RAISED to error, and lands on stderr', async () => {
        // Not a style pin, and deliberately NOT #6230's verdict. The hot-cache
        // entry is dropped before the try, so a failed delete leaves the
        // suspension consumed in-process and the row alive: `cancelRun` returns
        // `true`, a terminal log is recorded, and the next restart re-lists and
        // re-resumes a run that already ended. Nothing retries the delete.
        const log = new ObjectLogger({ level: 'warn', format: 'json' });
        const { streams } = await cancelAgainstUndeletableStore(log, MULTILINE_DRIVER);

        expect(streams.stdout, 'nothing on the out stream').toEqual([]);
        expect(soleRecord(streams.stderr).level).toBe('error');
    });

    it('hands the cause to error(message, error, meta) — the THIRD slot, Error slot empty', async () => {
        // `error(message, error?, meta?)`: `meta` is third. The second is the
        // `Error` slot and is left empty on purpose (#5575) — a raw `Error`
        // there ships its stack trace on every record.
        const spy = vi.spyOn(ObjectLogger.prototype, 'error');
        const log = new ObjectLogger({ level: 'warn', format: 'json' });
        await cancelAgainstUndeletableStore(log, MULTILINE_DRIVER);

        const call = spy.mock.calls.find((c) => String(c[0]).includes('could NOT be deleted from'));
        expect(call, 'the seam logged at error level').toBeDefined();
        const [message, errorSlot, meta] = call as unknown as [string, unknown, Record<string, unknown>];
        expect(message).not.toContain('\n');
        expect(errorSlot, 'the Error slot stays empty (#5575)').toBeUndefined();
        expect(meta, 'meta is the THIRD argument on `error`').toBeDefined();
        expect(meta.error).toBe(MULTILINE_DRIVER);
        expect(meta.issues).toBeUndefined();
        spy.mockRestore();
    });

    it('still swallows the failure — the fix is to the record, not to the behaviour', async () => {
        const { cancelled } = await cancelAgainstUndeletableStore(
            new ObjectLogger({ level: 'warn', format: 'json' }),
            MULTILINE_DRIVER,
        );
        // The cancellation itself is unchanged: the run left the node, so a
        // durable-store failure must not fail the consumption.
        expect(cancelled).toBe(true);
    });

    it('renders a single-line driver failure in exactly the same shape — the fix is unconditional', async () => {
        // Today's in-repo drivers are all single-line, which is why #6299 is a
        // finding. The seam must not branch on that.
        const log = new ObjectLogger({ level: 'warn', format: 'json' });
        const { streams } = await cancelAgainstUndeletableStore(log, SINGLE_LINE_DRIVER);

        const record = soleRecord(streams.stderr);
        expect(record.level).toBe('error');
        expect(record.msg).not.toContain('\n');
        expect(record.msg).toContain(RUN_ID);
        expect(record.error).toBe(SINGLE_LINE_DRIVER);
        expect(record.msg).not.toContain(SINGLE_LINE_DRIVER);
    });
});

// ── seam 2: cancelRun — the cancellation that silently did not happen ───────

describe("#6299 — cancelRun's unreadable store logs ONE stderr record", () => {
    it("the driver's multi-line failure never reaches the log message", async () => {
        const log = new ObjectLogger({ level: 'warn', format: 'json' });
        const { streams } = await cancelAgainstUnreadableStore(log, MULTILINE_DRIVER);

        const record = soleRecord(streams.stderr);
        expect(record.msg).not.toContain('\n');
        expect(record.msg, 'which run').toContain(RUN_ID);
        // The consequence clause #6299 asked for: the old text said the load
        // failed and stopped there, never that the CANCELLATION had been
        // skipped and reported as success.
        expect(record.msg, 'what did not happen').toContain('cancellation was SKIPPED');
        expect(record.msg, 'what the caller was told').toContain('reported as idempotent success');
        expect(record.msg, 'the run is still live').toContain('The run is NOT cancelled');
        expect(record.msg, 'what happens next').toContain('next restart re-arms and resumes it');
        expect(record.msg, 'where the cause went').toContain("this record's meta");
        expect(record.issues).toBeUndefined();
        expect(record.error).toBe(MULTILINE_DRIVER);
        expect(record.msg).not.toContain('no such table');
        expect(record.msg).not.toContain('better-sqlite3');
    });

    it('stays one physical line in `pretty`', async () => {
        const log = new ObjectLogger({ level: 'warn', format: 'pretty' });
        const { streams } = await cancelAgainstUnreadableStore(log, MULTILINE_DRIVER);

        expect(streams.stderr).toHaveLength(1);
        expect(streams.stderr[0]).toMatch(RECORD_HEAD);
        expect(streams.stderr[0]).toContain('could not read the durable suspended-run store');
        expect(streams.stderr[0]).toContain('better-sqlite3');
        expect(streams.stderr[0]).toContain('run `os migrate` for this datasource');
    });

    it('#4632: DURABILITY — the level is RAISED to error, and lands on stderr', async () => {
        // The inverse of #6230's verdict, on purpose. `loadSuspendedRun` is a
        // DECLARED best-effort reader whose callers are incidental and whose
        // strict twin exists for when the difference matters. `cancelRun` has no
        // strict alternative and its degradation decides a WRITE: the failed
        // read becomes `false`, which the contract calls idempotent success, so
        // the cancellation is skipped and the run is stranded — the very outcome
        // plugin-approvals grades `error` when the same call THROWS (#4420).
        const log = new ObjectLogger({ level: 'warn', format: 'json' });
        const { streams } = await cancelAgainstUnreadableStore(log, MULTILINE_DRIVER);

        expect(streams.stdout, 'nothing on the out stream').toEqual([]);
        expect(soleRecord(streams.stderr).level).toBe('error');
    });

    it('hands the cause to error(message, error, meta) — the THIRD slot, Error slot empty', async () => {
        const spy = vi.spyOn(ObjectLogger.prototype, 'error');
        const log = new ObjectLogger({ level: 'warn', format: 'json' });
        await cancelAgainstUnreadableStore(log, MULTILINE_DRIVER);

        const call = spy.mock.calls.find((c) => String(c[0]).includes('could not read the durable suspended-run store'));
        expect(call, 'the seam logged at error level').toBeDefined();
        const [message, errorSlot, meta] = call as unknown as [string, unknown, Record<string, unknown>];
        expect(message).not.toContain('\n');
        expect(errorSlot, 'the Error slot stays empty (#5575)').toBeUndefined();
        expect(meta, 'meta is the THIRD argument on `error`').toBeDefined();
        expect(meta.error).toBe(MULTILINE_DRIVER);
        spy.mockRestore();
    });

    it('still returns false — the fix is to the record, not to the behaviour', async () => {
        // The behaviour this record exists to make audible is unchanged: an
        // unreadable store is still indistinguishable from "no such run" to the
        // caller. Fixing THAT is #5186-shaped propagation, not #6299.
        const { cancelled } = await cancelAgainstUnreadableStore(
            new ObjectLogger({ level: 'warn', format: 'json' }),
            MULTILINE_DRIVER,
        );
        expect(cancelled).toBe(false);
    });

    it('renders a single-line driver failure in exactly the same shape', async () => {
        const log = new ObjectLogger({ level: 'warn', format: 'json' });
        const { streams } = await cancelAgainstUnreadableStore(log, SINGLE_LINE_DRIVER);

        const record = soleRecord(streams.stderr);
        expect(record.level).toBe('error');
        expect(record.msg).not.toContain('\n');
        expect(record.error).toBe(SINGLE_LINE_DRIVER);
        expect(record.msg).not.toContain(SINGLE_LINE_DRIVER);
    });
});

// ── seam 3: listSuspendedRunsDurable — the silently short list ──────────────

describe("#6299 — listSuspendedRunsDurable's unlistable store logs ONE stdout record", () => {
    it("the driver's multi-line failure never reaches the log message", async () => {
        const log = new ObjectLogger({ level: 'warn', format: 'json' });
        const { streams } = await listAgainstUnlistableStore(log, MULTILINE_DRIVER);

        const record = soleRecord(streams.stdout);
        expect(record.msg).not.toContain('\n');
        // The consequence clause: the old text said the list failed and stopped
        // there, never that the ANSWER handed back is short and unmarked.
        expect(record.msg, 'the degradation').toContain('DEGRADES to the in-memory cache alone');
        expect(record.msg, 'what is missing').toContain('every run parked by a previous process is missing');
        expect(record.msg, 'why it is invisible').toContain('cannot tell a short list from a complete one');
        expect(record.msg, 'the rows are fine').toContain('still stored, still resumable by id');
        expect(record.msg, 'where the cause went').toContain("this record's meta");
        expect(record.issues).toBeUndefined();
        expect(record.error).toBe(MULTILINE_DRIVER);
        expect(record.msg).not.toContain('no such table');
        expect(record.msg).not.toContain('better-sqlite3');
    });

    it('stays one physical line in `pretty`', async () => {
        const log = new ObjectLogger({ level: 'warn', format: 'pretty' });
        const { streams } = await listAgainstUnlistableStore(log, MULTILINE_DRIVER);

        expect(streams.stdout).toHaveLength(1);
        expect(streams.stdout[0]).toMatch(RECORD_HEAD);
        expect(streams.stdout[0]).toContain('could not be listed');
        expect(streams.stdout[0]).toContain('better-sqlite3');
        expect(streams.stdout[0]).toContain('run `os migrate` for this datasource');
    });

    it('#4632: FUNCTIONAL — the level STAYS warn, on stdout', async () => {
        // The one of #6299's three where #6230's verdict does carry, for its own
        // reason: nothing claimed-persisted failed to land. The rows are intact
        // and still resumable by id, and the next boot's
        // `rearmSuspendedWaitTimers` re-arms them off its OWN `store.list()` —
        // which wait-node.ts grades `error` precisely because THAT failure
        // breaks the promise to resume them. This one breaks no promise, and
        // raising it would alarm for the duration of an outage on a read
        // nothing acts on.
        const log = new ObjectLogger({ level: 'warn', format: 'json' });
        const { streams } = await listAgainstUnlistableStore(log, MULTILINE_DRIVER);

        expect(streams.stderr, 'nothing on the error stream').toEqual([]);
        expect(soleRecord(streams.stdout).level).toBe('warn');
    });

    it('hands the cause to warn(message, meta) — the SECOND slot, not the third', async () => {
        // The one place copying either `error` seam above would break: `warn`
        // has no `Error` slot, so a `meta` passed third is silently ignored.
        const spy = vi.spyOn(ObjectLogger.prototype, 'warn');
        const log = new ObjectLogger({ level: 'warn', format: 'json' });
        await listAgainstUnlistableStore(log, MULTILINE_DRIVER);

        const call = spy.mock.calls.find((c) => String(c[0]).includes('could not be listed'));
        expect(call, 'the seam logged at warn level').toBeDefined();
        const [message, meta, third] = call as unknown as [string, Record<string, unknown>, unknown];
        expect(message).not.toContain('\n');
        expect(meta, 'meta is the SECOND argument on `warn`').toBeDefined();
        expect(meta.error).toBe(MULTILINE_DRIVER);
        expect(meta.issues).toBeUndefined();
        expect(third, '`warn` has no third parameter to put it in').toBeUndefined();
        spy.mockRestore();
    });

    it("survives `serve`'s boot-quiet filter whole — the drop this seam's level exposes it to", async () => {
        // This is the one of the three still on the filtered stream, so it is
        // the one that carries #6230's extra harm: inside the boot-quiet window
        // a shredded record loses its continuation lines OUTRIGHT rather than
        // merely arriving unattributable.
        const log = new ObjectLogger({ level: 'warn', format: 'pretty' });
        const { streams } = await listAgainstUnlistableStore(log, MULTILINE_DRIVER);

        const retained = bootFilterRetains(streams.stdout);
        expect(retained, 'nothing this seam emitted is dropped').toEqual(streams.stdout);
        // The point of surviving: the retained bytes still carry the cause. A
        // shredded record retains its first line too — and that line is exactly
        // the one with no facts on it.
        expect(retained.join('\n')).toContain('SQLITE_ERROR: no such table');
        expect(retained.join('\n')).toContain('hint: run `os migrate`');
    });

    it('still degrades to the in-memory list — the fix is to the record, not to the behaviour', async () => {
        // The invented short answer is #5186's shape and its remedy is a
        // return-contract change, outside #6299. Pinned here so the record's
        // wording and the behaviour it describes cannot drift apart.
        const { listed } = await listAgainstUnlistableStore(
            new ObjectLogger({ level: 'warn', format: 'json' }),
            MULTILINE_DRIVER,
        );
        expect(listed).toEqual([]);
    });

    it('renders a single-line driver failure in exactly the same shape', async () => {
        const log = new ObjectLogger({ level: 'warn', format: 'json' });
        const { streams } = await listAgainstUnlistableStore(log, SINGLE_LINE_DRIVER);

        const record = soleRecord(streams.stdout);
        expect(record.level).toBe('warn');
        expect(record.msg).not.toContain('\n');
        expect(record.error).toBe(SINGLE_LINE_DRIVER);
        expect(record.msg).not.toContain(SINGLE_LINE_DRIVER);
    });
});

// ── what the level split actually buys, measured ───────────────────────────

describe('#6299 — the three seams after the split: two on stderr, one on stdout', () => {
    /**
     * The stream consequence of the per-site verdicts, measured rather than
     * asserted in prose — and stated as a SIDE EFFECT, not as a justification.
     * Neither level was raised in order to leave the boot buffer; they were
     * raised because a consumed-but-undeleted suspension and a silently skipped
     * cancellation are #4632 durability losses. That they now also bypass
     * `serve`'s stdout-only quiet window is a consequence of the routing
     * (`ObjectLogger` sends `error`/`fatal` to stderr) worth pinning, because a
     * future "tidy these three back to one level" would silently undo it.
     */
    it('the two durability seams bypass the stdout boot filter; the functional one is filtered and survives', async () => {
        const fmt = { level: 'warn', format: 'pretty' } as const;

        const forget = await cancelAgainstUndeletableStore(new ObjectLogger(fmt), MULTILINE_DRIVER);
        const cancel = await cancelAgainstUnreadableStore(new ObjectLogger(fmt), MULTILINE_DRIVER);
        const list = await listAgainstUnlistableStore(new ObjectLogger(fmt), MULTILINE_DRIVER);

        // Durability seams: on stderr, which the boot-quiet window never wraps.
        expect(forget.streams.stdout, 'forgetSuspendedRun is off the filtered stream').toEqual([]);
        expect(cancel.streams.stdout, 'cancelRun is off the filtered stream').toEqual([]);
        expect(forget.streams.stderr).toHaveLength(1);
        expect(cancel.streams.stderr).toHaveLength(1);

        // Functional seam: on stdout, meets the filter, and passes it whole.
        expect(list.streams.stderr, 'listSuspendedRunsDurable stays on stdout').toEqual([]);
        expect(bootFilterRetains(list.streams.stdout)).toEqual(list.streams.stdout);

        // All three carry the driver's whole text on their single line.
        for (const line of [forget.streams.stderr[0], cancel.streams.stderr[0], list.streams.stdout[0]]) {
            expect(line).toMatch(RECORD_HEAD);
            expect(line).toContain('hint: run `os migrate`');
        }
    });
});
