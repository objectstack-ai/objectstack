// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression: #5661 — the three STARTUP seams of `AutomationServicePlugin` that
// still interpolated a FOREIGN error's text into the log MESSAGE.
//
// They are the fourth instalment of the family #5048 (flow binding, PR #5572),
// #5575 (`reconcileDeclaredConnectors`'s `fail()`, PR #5639) and #5636
// (`degradeConnectorInstance`, PR #5662) closed, and were out of all three
// scopes:
//
//   1. `registerRunObject`  — `warn`,  cause from the kernel service registry;
//   2. the boot `probe()`   — `error`, cause from the DATASOURCE DRIVER;
//   3. the wait-timer re-arm — `error`, cause from whatever escapes
//      `rearmSuspendedWaitTimers`.
//
// ## Why 2 and 3 are the worst possible records to shred
//
// Unlike the flow-bind seams, these two exist *because* somebody has to read
// them. Their own comments state the consequence — "suspended runs will NOT
// survive a restart", "every wait/approval paused before this restart will hang
// indefinitely" — and they were deliberately raised to `error` by #4632 so an
// operator can find them. `ObjectLogger.write()` emits one
// `<ts> <LEVEL> <message>` record per call, so a message carrying newlines
// becomes several physical lines of which only the first has a level head:
// a file sink stores the rest as their own records, a shipper reads them as
// unattributable fragments, and `grep ERROR` returns the one line that holds no
// facts. The loudest durability warning in this plugin was the one most likely
// to arrive unreadable.
//
// Seam 1 has the *other* harm, and it is measured rather than assumed at the
// bottom of this file: `warn` goes to **stdout**, which is the stream `serve`'s
// boot-quiet window wraps, and `BootLogCapture.offer()` retains a physical line
// only when `classifyBootLogLine` finds a level head on it — so a continuation
// line there is DROPPED, not merely mangled. `registerRunObject` runs in
// `init()`, i.e. squarely inside that window.
//
// ## The fix
//
// Identical to the three prior instalments, zero new vocabulary: a static,
// newline-free message plus `describeThrownForLog(err)` in the logger's
// structured slot. Which slot depends on the level, per the `Logger` contract
// (`packages/spec/src/contracts/logger.ts`): `warn(message, meta?)` takes it
// SECOND, `error(message, error?, meta?)` takes it THIRD — the second slot
// would ship the thrown value's stack on the record (#5575).
//
// Every assertion below reads REAL BYTES off a REAL `ObjectLogger`, per the
// #5662 precedent: a spy proves what the seam *called*, not what a downstream
// line-splitter would *see*, and it was the latter that cost cloud#971 a
// release line. The spies appear only where the argument SLOT is the fact under
// test.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectLogger } from '@objectstack/core';
import { AutomationServicePlugin } from './plugin.js';
import type { SuspendedRunStoreEngine } from './suspended-run-store.js';

// ── the one injected seam, and why ─────────────────────────────────────────

/**
 * `rearmSuspendedWaitTimers` catches every failure it MODELS — the `store.list()`
 * read, each overdue `resume()`, each `job.schedule()` — and reports them on its
 * own `[wait]` records. So the plugin's `catch` around it is a net for what that
 * function did *not* model, and no fixture built out of a real store and a real
 * job service can reach it. That is a fact about the seam, not a gap in the
 * test: it is defensive code whose log record still has to be correct the day
 * something does escape.
 *
 * Rather than pretend otherwise with a fake that could never occur, the call is
 * replaced — and only that call, the rest of the module is the real one — so the
 * plugin's own `catch`, its own message and the real logger are all exercised
 * against a thrown value we choose.
 */
const rearm = vi.hoisted(() => ({ thrown: undefined as unknown }));

vi.mock('./builtin/index.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./builtin/index.js')>();
    return {
        ...actual,
        rearmSuspendedWaitTimers: async (
            ...args: Parameters<typeof actual.rearmSuspendedWaitTimers>
        ) => {
            if (rearm.thrown !== undefined) throw rearm.thrown;
            return actual.rearmSuspendedWaitTimers(...args);
        },
    };
});

afterEach(() => {
    rearm.thrown = undefined;
    vi.restoreAllMocks();
});

// ── fixtures ───────────────────────────────────────────────────────────────

/**
 * What a database driver's failure looks like when it is not one line. Postgres
 * (`error: … \n  detail: … \n  hint: …`) and better-sqlite3 wrappers both do
 * this; the in-repo drivers happen to be single-line today, which is why #5661
 * is a `finding` and not an outage report.
 */
const MULTILINE_DRIVER = [
    'SQLITE_ERROR: no such table: sys_automation_run',
    '  at Database.prepare (better-sqlite3/lib/methods/wrappers.js:5:21)',
    '  hint: run `os migrate` for this datasource, or set OS_SKIP_SCHEMA_SYNC=0',
].join('\n');

/** A job/scheduler failure with an embedded stack-shaped tail. */
const MULTILINE_JOB = [
    "job service refused to schedule 'flow-wait:run_1:pause'",
    '  cause: queue backend unreachable (ECONNREFUSED 127.0.0.1:6379)',
    '  hint: is the queue running?',
].join('\n');

/**
 * A `ZodError`-shaped rejection, duck-typed exactly as `describeThrownForLog`
 * recognizes it. `manifest.register()` parses what it is handed, and its
 * `.message` is a pretty-printed dump of `issues` whose FIRST line is the single
 * character `[`.
 */
function zodLikeRejection(): Error {
    const issues = [
        { code: 'unrecognized_keys', keys: ['defaultDatasource'], path: [], message: "Unrecognized key: 'defaultDatasource'" },
        { code: 'invalid_type', path: ['objects', 0, 'fields'], message: 'Invalid input: expected object' },
    ];
    const err = new Error(JSON.stringify(issues, null, 2)) as Error & { issues: unknown };
    err.issues = issues;
    return err;
}

/**
 * Stands in for the `sys_automation_run` table, plus the `registry` the boot flow
 * pull reads (without it, `syncFlowsFromObjectQL` emits its own — already
 * #5048-correct — `warn`, which is noise in every capture below).
 *
 * `failProbe` fails ONLY the probe-shaped read: `ObjectStoreSuspendedRunStore`
 * probes with `{ where: {}, limit: 1 }` and lists with
 * `{ where: { status: 'paused' }, limit: 1000 }`. A real missing table fails
 * both, and the second failure is reported by a DIFFERENT seam — `wait-node.ts`'s
 * `[wait] … re-arm ABORTED …`, which #5737 has since brought into this same
 * shape (one-line message, cause in meta) and pinned in
 * `builtin/wait-node-log-cause.test.ts`. So the narrowing no longer dodges a
 * shredded record, only a second seam's record: the counts below are per-seam
 * (`toHaveLength(1)`), and this keeps them measuring the seam they name.
 *
 * ## No `delete` on purpose (#4550 / #5629)
 *
 * `SuspendedRunStoreEngine` declares `delete?` optional, and this double omits
 * it. `check:engine-double-contract` flagged an earlier draft that carried a
 * bare `async delete() { return true; }`: an engine double whose `delete` does
 * not route through `assertEngineDeleteDispatch` may accept a call the real
 * `ObjectQL.delete` refuses, which is how #4434 shipped a dead REST route with
 * its suite green.
 *
 * Removing it was the right remedy here rather than pinning it, and the reason
 * is measured, not assumed — the ledger's own standard. Injecting an
 * `appendFileSync` marker as the first statement of that `delete` and running
 * this file printed it **0** times; the control, the same injection in `find`,
 * printed **11** times in the same run, so the silence is evidence and not a
 * broken probe. Nothing here deletes a suspended run: these seams exercise
 * `probe()`, `list()` and the boot flow pull only. So the method modelled
 * nothing — and its body was the second kind of looseness besides, answering
 * success while removing no row. A pin would have certified that.
 *
 * A future case that does need deletion writes a real one and
 * `check:engine-double-contract` will require the predicate then; and the store
 * itself warns when the engine has no `delete()`, which the byte-exact
 * assertions below would surface immediately.
 */
function fakeDataEngine(opts: { failProbe?: string } = {}) {
    const rows = new Map<string, any>();
    const engine: SuspendedRunStoreEngine & { rows: Map<string, any>; registry: unknown } = {
        rows,
        registry: { listItems: () => [] },
        async find(_object, options?: any) {
            const isProbe = options?.limit === 1 && Object.keys(options?.where ?? {}).length === 0;
            if (opts.failProbe && isProbe) throw new Error(opts.failProbe);
            return [];
        },
        async insert(_object, data) { rows.set(String(data.id), { ...data }); return data; },
        async update(_object, data) { rows.set(String(data.id), { ...data }); return data; },
    };
    return engine;
}

/**
 * An `objectql` service that satisfies the boot flow pull and nothing else: no
 * `find`/`insert`, so no durable store is built and the probe seam never runs.
 * Used by the seam-1 cases, whose subject is `init()`.
 */
function registryOnlyObjectql() {
    return { registry: { listItems: () => [] } };
}

/** A `manifest` service whose `register()` rejects what it is handed. */
function rejectingManifest(thrown: unknown) {
    return { register() { throw thrown; } };
}

/** A `manifest` service that accepts everything. */
function acceptingManifest() {
    const registered: any[] = [];
    return { registered, register(m: any) { registered.push(m); } };
}

/** The slice of `PluginContext` this plugin's startup path touches. */
function pluginCtx(services: Map<string, unknown>, logger: ObjectLogger): any {
    return {
        logger,
        getService(name: string) {
            if (services.has(name)) return services.get(name);
            throw new Error(`Service '${name}' not registered`);
        },
        registerService(name: string, svc: unknown) { services.set(name, svc); },
        hook() {},
        async trigger() {},
    };
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
 * Run the plugin's full `init()` + `start()` against a real `ObjectLogger`.
 *
 * `level` doubles as the noise filter: at `'warn'` the plugin's many `info`
 * lines never reach stdout, so a stdout capture contains the seam under test and
 * nothing else; at `'error'` the same holds for stderr.
 */
async function bootPlugin(opts: {
    manifest?: unknown;
    objectql?: unknown;
    level: 'warn' | 'error';
    format?: 'json' | 'pretty';
}): Promise<void> {
    const services = new Map<string, unknown>();
    if (opts.manifest) services.set('manifest', opts.manifest);
    services.set('objectql', opts.objectql ?? registryOnlyObjectql());
    const logger = new ObjectLogger({ level: opts.level, format: opts.format ?? 'json' });
    const ctx = pluginCtx(services, logger);
    const plugin = new AutomationServicePlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
}

/**
 * `ObjectLogger`'s `pretty`/`text` record head — the same predicate
 * `classifyBootLogLine` applies in `packages/cli/src/utils/boot-log-capture.ts`.
 * Re-stated rather than imported: this package must not depend on
 * `@objectstack/cli`, and the predicate is the general one every line-based
 * consumer keys off, the CLI's buffer being the strictest example.
 */
const RECORD_HEAD = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z(?: \|)? (DEBUG|INFO|WARN|ERROR|FATAL)\b/;

/**
 * `classifyBootLogLine`'s verdict, reduced to what matters here: a line either
 * carries an `ObjectLogger` level head (retained by `BootLogCapture.offer()`) or
 * it does not (dropped).
 */
function classifyLine(raw: string): string | null {
    const line = raw.replace(/\u001B\[[0-9;]*m/g, '').trim();
    if (!line) return null;
    if (line.startsWith('{')) {
        try {
            const rec = JSON.parse(line) as { level?: unknown; time?: unknown };
            return typeof rec.time === 'string' && typeof rec.level === 'string' ? String(rec.level) : null;
        } catch {
            return null;
        }
    }
    const m = RECORD_HEAD.exec(line);
    return m ? m[1].toLowerCase() : null;
}

const MANIFEST_PREFIX = '[Automation] manifest service unavailable';
const PROBE_PREFIX = '[Automation] sys_automation_run could not be read at startup';
const REARM_PREFIX = '[Automation] suspended wait-timer re-arm FAILED after restart';

// ── seam 1: registerRunObject (`warn` → stdout, inside the boot window) ─────

describe('#5661 — the manifest-unavailable warning is ONE stdout record', () => {
    it('a rejection dump becomes structured issues, never a message spill', async () => {
        const lines = await captureStream('stdout', () =>
            bootPlugin({ manifest: rejectingManifest(zodLikeRejection()), level: 'warn' }),
        );

        const mine = lines.filter((l) => l.includes(MANIFEST_PREFIX));
        expect(mine, 'reported exactly once').toHaveLength(1);
        // Pre-fix this single call produced 12 physical lines, 11 of them
        // head-less — see the reverse-verification block at the bottom.
        expect(lines, 'nothing else reached stdout at warn level').toHaveLength(1);

        const record = JSON.parse(mine[0]) as {
            level: string;
            msg: string;
            issues?: Array<Record<string, unknown>>;
            error?: string;
        };
        expect(record.level).toBe('warn');
        expect(record.msg).not.toContain('\n');
        expect(record.msg).toContain('sys_automation_run not registered yet');
        // The facts a reader came for, and the #5573 redaction trap avoided:
        // Zod names the offending keys in a field called `keys`, and `'keys'`
        // contains `'key'` — `ObjectLogger`'s substring redactor would blank it.
        expect(record.error, 'a validation rejection populates `issues`, not `error`').toBeUndefined();
        expect(record.issues?.some((i) => i.path === '(root)')).toBe(true);
        expect(record.issues?.some((i) => i.path === 'objects[0].fields')).toBe(true);
        expect(JSON.stringify(record.issues)).toContain('defaultDatasource');
        expect(JSON.stringify(record.issues)).not.toContain('REDACTED');
    });

    it('a plain multi-line rejection keeps its full text, on one line', async () => {
        const lines = await captureStream('stdout', () =>
            bootPlugin({
                manifest: rejectingManifest(new Error(MULTILINE_DRIVER)),
                level: 'warn',
                format: 'pretty',
            }),
        );

        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(RECORD_HEAD);
        expect(classifyLine(lines[0]), 'the boot buffer keeps it').toBe('warn');
        // Newlines survive as `\n` escapes inside the JSON-serialized meta, so
        // every fact is on the retained line.
        expect(lines[0]).toContain('no such table: sys_automation_run');
        expect(lines[0]).toContain('run `os migrate` for this datasource');
    });

    it('calls warn(message, meta) — `warn` has no Error slot', async () => {
        // Verified against the contract rather than assumed: `Logger.warn` is
        // `warn(message, meta?)`, so the cause belongs in argument TWO here even
        // though both `error` seams below must use argument THREE.
        const warn = vi.spyOn(ObjectLogger.prototype, 'warn');
        await bootPlugin({ manifest: rejectingManifest(zodLikeRejection()), level: 'warn' });

        const call = warn.mock.calls.find((c) => String(c[0]).includes(MANIFEST_PREFIX));
        expect(call, 'the seam logged at warn level').toBeDefined();
        expect(call).toHaveLength(2);
        const [message, meta] = call as [string, Record<string, unknown>];
        expect(message).not.toContain('\n');
        expect(Array.isArray(meta.issues)).toBe(true);
    });

    it('says nothing when the manifest service accepts the object', async () => {
        // The no-cause direction: a working composition must not gain a byte.
        const lines = await captureStream('stdout', () =>
            bootPlugin({ manifest: acceptingManifest(), level: 'warn' }),
        );
        expect(lines).toEqual([]);
    });
});

// ── seam 2: the boot probe (`error` → stderr) ──────────────────────────────

describe('#5661 — the startup probe error is ONE stderr record', () => {
    it("the driver's multi-line failure never reaches the log message", async () => {
        const lines = await captureStream('stderr', () =>
            bootPlugin({
                manifest: acceptingManifest(),
                objectql: fakeDataEngine({ failProbe: MULTILINE_DRIVER }),
                level: 'error',
            }),
        );

        const mine = lines.filter((l) => l.includes(PROBE_PREFIX));
        expect(mine, 'reported exactly once').toHaveLength(1);
        // [ADR-0126 §7.2] Deliberately NOT `expect(lines).toHaveLength(1)` any
        // more. An unreadable datasource now fails TWO independent boot probes
        // — this one and the activation ledger's (`sys_metadata_activation`) —
        // and each states its own distinct consequence, so a count over ALL of
        // stderr pins the existence of an unrelated seam rather than anything
        // about this record.
        //
        // What #5661 is actually about is that a driver's MULTI-LINE failure
        // must not become N log records of which only the first carries a level
        // head. That property is asserted directly here, and it is strictly
        // stronger than the count it replaces: every captured line must be a
        // well-formed record, so an escaped continuation fragment fails this
        // even in a boot that emits several legitimate records.
        for (const line of lines) {
            expect(classifyLine(line), `orphan continuation line escaped: ${line}`).not.toBeNull();
        }

        const record = JSON.parse(mine[0]) as { level: string; msg: string; error?: string; issues?: unknown };
        expect(record.level).toBe('error');
        expect(record.msg).not.toContain('\n');
        // #4632 demands both of these IN the record's own first line, and moving
        // the cause out must not cost either one.
        expect(record.msg, 'the consequence').toContain('suspended runs will NOT survive a restart');
        expect(record.msg, 'the fix').toContain('Check that schema sync ran for this datasource');
        // Not a validation rejection → `error`, and the whole driver text
        // survives, its newlines escaped by the logger's JSON.stringify.
        expect(record.issues).toBeUndefined();
        expect(record.error).toBe(MULTILINE_DRIVER);
    });

    it("calls error(message, undefined, meta) — the contract's third slot", async () => {
        const error = vi.spyOn(ObjectLogger.prototype, 'error');
        await bootPlugin({
            manifest: acceptingManifest(),
            objectql: fakeDataEngine({ failProbe: MULTILINE_DRIVER }),
            level: 'error',
        });

        const call = error.mock.calls.find((c) => String(c[0]).includes(PROBE_PREFIX));
        expect(call, 'the seam logged at error level').toBeDefined();
        const [message, errorSlot, meta] = call as [string, unknown, Record<string, unknown>];
        expect(message).not.toContain('\n');
        // The second slot stays empty on purpose: a raw `Error` there ships its
        // stack into the record (#5575).
        expect(errorSlot).toBeUndefined();
        expect(meta.error).toBe(MULTILINE_DRIVER);
    });

    it('a readable table produces no error bytes at all', async () => {
        const lines = await captureStream('stderr', () =>
            bootPlugin({ manifest: acceptingManifest(), objectql: fakeDataEngine(), level: 'error' }),
        );
        expect(lines).toEqual([]);
    });
});

// ── seam 3: the wait-timer re-arm (`error` → stderr) ───────────────────────

describe('#5661 — the wait-timer re-arm error is ONE stderr record', () => {
    it('the escaping cause goes to meta, the consequence stays in the message', async () => {
        rearm.thrown = new Error(MULTILINE_JOB);
        const lines = await captureStream('stderr', () =>
            bootPlugin({ manifest: acceptingManifest(), objectql: fakeDataEngine(), level: 'error' }),
        );

        const mine = lines.filter((l) => l.includes(REARM_PREFIX));
        expect(mine, 'reported exactly once').toHaveLength(1);
        expect(lines, 'one call, one physical line').toHaveLength(1);

        const record = JSON.parse(lines[0]) as { level: string; msg: string; error?: string };
        expect(record.level).toBe('error');
        expect(record.msg).not.toContain('\n');
        expect(record.msg, 'the consequence').toContain('will hang indefinitely instead of resuming');
        expect(record.msg, 'the fix').toContain('resumed manually via the automation resume API');
        // The message used to end `Cause: <text>`; it now points at the meta.
        expect(record.msg).not.toContain('ECONNREFUSED');
        expect(record.error).toBe(MULTILINE_JOB);
    });

    it("calls error(message, undefined, meta) — the contract's third slot", async () => {
        rearm.thrown = new Error(MULTILINE_JOB);
        const error = vi.spyOn(ObjectLogger.prototype, 'error');
        await bootPlugin({ manifest: acceptingManifest(), objectql: fakeDataEngine(), level: 'error' });

        const call = error.mock.calls.find((c) => String(c[0]).includes(REARM_PREFIX));
        expect(call, 'the seam logged at error level').toBeDefined();
        const [message, errorSlot, meta] = call as [string, unknown, Record<string, unknown>];
        expect(message).not.toContain('\n');
        expect(errorSlot).toBeUndefined();
        expect(meta.error).toBe(MULTILINE_JOB);
    });

    it('still reports at `error`, so check:durability-log-level keeps its seam', async () => {
        // `rearmSuspendedWaitTimers` is in `DURABILITY_CRITICAL_CALLEES`: this
        // catch must not drop below `error` and must not start rethrowing.
        rearm.thrown = new Error(MULTILINE_JOB);
        const err = vi.spyOn(ObjectLogger.prototype, 'error');
        const warn = vi.spyOn(ObjectLogger.prototype, 'warn');
        await expect(
            bootPlugin({ manifest: acceptingManifest(), objectql: fakeDataEngine(), level: 'error' }),
        ).resolves.toBeUndefined();
        expect(err.mock.calls.some((c) => String(c[0]).includes(REARM_PREFIX))).toBe(true);
        expect(warn.mock.calls.some((c) => String(c[0]).includes(REARM_PREFIX))).toBe(false);
    });

    it('a clean re-arm produces no error bytes at all', async () => {
        const lines = await captureStream('stderr', () =>
            bootPlugin({ manifest: acceptingManifest(), objectql: fakeDataEngine(), level: 'error' }),
        );
        expect(lines).toEqual([]);
    });
});

// ── reverse verification, direction predicted before running ───────────────

describe('#5661 — what the interpolated rendering cost, measured', () => {
    it('the pre-fix `warn` shape loses its every fact to the boot buffer', async () => {
        // Predicted BEFORE running, and it is the plain red direction: rendering
        // the OLD shape — the cause spliced into the message — must produce MANY
        // physical lines of which exactly ONE classifies, so a boot-quiet window
        // retains that one and drops the rest. `registerRunObject` runs in
        // `init()`, which is inside that window, and `warn` goes to the stdout
        // the window wraps.
        const dump = zodLikeRejection().message;
        expect(dump.split('\n').length, 'fixture must be multi-line').toBeGreaterThan(1);
        expect(dump.split('\n')[0].trim(), "…and open with Zod's `[`").toBe('[');

        const log = new ObjectLogger({ level: 'warn', format: 'pretty' });

        const before = await captureStream('stdout', async () => {
            log.warn(
                `[Automation] manifest service unavailable; sys_automation_run not registered yet: ${dump}`,
            );
        });
        expect(before.length, 'one call, many physical lines').toBeGreaterThan(1);
        const kept = before.filter((l) => classifyLine(l) !== null);
        expect(kept, 'exactly one line survives the buffer').toHaveLength(1);
        expect(kept[0].trimEnd().endsWith('['), 'and it stops at the bracket').toBe(true);
        expect(kept[0]).not.toContain('defaultDatasource');
        expect(before.length - kept.length, 'lines the buffer drops').toBeGreaterThan(1);

        const after = await captureStream('stdout', async () => {
            log.warn('[Automation] manifest service unavailable; sys_automation_run not registered yet.', {
                issues: [{ code: 'unrecognized_keys', path: '(root)', unrecognized: ['defaultDatasource'] }],
            });
        });
        expect(after).toHaveLength(1);
        expect(classifyLine(after[0])).toBe('warn');
        expect(after[0]).toContain('defaultDatasource');
    });

    it('the pre-fix `error` shapes split one durability alarm into fragments', async () => {
        // Same prediction on the stderr side, where nothing buffers: the record
        // is not dropped, it is MIS-READ. The continuation lines carry no level
        // and no timestamp, so a file sink stores them as their own records and a
        // `grep ERROR` returns the one line that holds no facts — which for these
        // two seams is the line an operator is grepping for in the first place.
        const log = new ObjectLogger({ level: 'error', format: 'pretty' });

        const beforeProbe = await captureStream('stderr', async () => {
            log.error(
                `[Automation] sys_automation_run could not be read at startup — if this persists, suspended runs will NOT ` +
                    `survive a restart. Check that schema sync ran for this datasource: ${MULTILINE_DRIVER}`,
            );
        });
        expect(beforeProbe, 'three physical lines from one call').toHaveLength(3);
        expect(beforeProbe.filter((l) => classifyLine(l) !== null)).toHaveLength(1);
        expect(beforeProbe[1]).not.toMatch(RECORD_HEAD);
        expect(beforeProbe[1]).toContain('better-sqlite3');

        const afterProbe = await captureStream('stderr', async () => {
            log.error(
                `[Automation] sys_automation_run could not be read at startup — if this persists, suspended runs will NOT ` +
                    `survive a restart. Check that schema sync ran for this datasource; the driver's own failure is in this record's meta.`,
                undefined,
                { error: MULTILINE_DRIVER },
            );
        });
        expect(afterProbe).toHaveLength(1);
        expect(afterProbe[0]).toMatch(RECORD_HEAD);
        expect(afterProbe[0]).toContain('better-sqlite3');

        const beforeRearm = await captureStream('stderr', async () => {
            log.error(`[Automation] suspended wait-timer re-arm FAILED after restart. Cause: ${MULTILINE_JOB}`);
        });
        expect(beforeRearm).toHaveLength(3);
        expect(beforeRearm.filter((l) => classifyLine(l) !== null)).toHaveLength(1);
        expect(beforeRearm[2]).toContain('is the queue running?');
        expect(beforeRearm[2]).not.toMatch(RECORD_HEAD);
    });
});
