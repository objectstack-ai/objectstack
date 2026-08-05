// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression: #5636 — the #3017 connector DEGRADE path must report why an
// instance degraded in a form a line-oriented log consumer can read.
//
// `degradeConnectorInstance` is the third seam of the family #5048 (flow binding)
// and #5575 (`reconcileDeclaredConnectors`'s `fail()`) already closed, and it was
// out of both of their scopes. Two of its records interpolated a FOREIGN message
// into the log MESSAGE:
//
//     ctx.logger.warn(`… could not register degraded husk for '${name}': ${(err as Error).message}`);
//     ctx.logger.error(`… retrying with backoff, attempt ${n} (#3017): ${info.reason}`);
//
// Neither text is ours. The first `err` comes out of
// `engine.registerDegradedConnector` → `ConnectorSchema.parse`, so the catch's
// own comment ("the entry's def no longer parses") names a `ZodError` — whose
// `.message` is a multi-line JSON dump opening on the single character `[`. The
// second is `ConnectorUpstreamUnavailableError.message`, constructed by a
// third-party provider factory that ADR-0097 explicitly invites people to write;
// the spec defines the error class and says nothing about its text, so an SDK's
// multi-line failure lands there verbatim.
//
// ## Why the `warn` seam is worse than #5575's, and not by the same mechanism
//
// `ObjectLogger` routes `warn` to **stdout** and `error`/`fatal` to **stderr**,
// and `serve`'s boot-quiet window wraps `process.stdout.write` only. #5575's
// seams are all `error`, so its issue text was corrected: the boot buffer never
// sees them. This seam is different and the difference is measured, not assumed:
//
//   • it is `warn` → stdout, so the buffer DOES see it;
//   • it runs at **cold boot** — `materializeDeclaredConnectors(ctx, { fatal:
//     true })` degrades instead of throwing when the upstream is unreachable —
//     which is exactly when the window is open;
//   • `BootLogCapture.offer()` retains a physical line only when
//     `classifyBootLogLine` finds a `<ts> <LEVEL>` head on it, so every
//     continuation line of an interpolated dump is DROPPED, not merely mangled.
//
// That is cloud#971's original shape. The local reproduction at the bottom of
// this file measures it (13 physical lines in, 1 retained, 12 dropped) using the
// CLI's own predicate, re-stated here rather than imported — this package must
// not depend on `@objectstack/cli`, and the predicate is the general one every
// line-based consumer keys off, the CLI's buffer being the strictest example.
//
// The `error` seam has the #5575 harm instead (file sink, `docker logs` into a
// shipper, `grep ERROR` — one record read as N unattributable fragments).
//
// ## The fix, and the one thing it deliberately does NOT change
//
// Both records keep a newline-free message and hand the cause to the logger's
// `meta` (`warn`'s second argument; `error`'s THIRD, per the `Logger` contract's
// `error(message, error?, meta?)`), rendered by `describeThrownForLog`.
//
// `degradedReason` — what `GET /connectors` shows and what a `connector_action`
// refusal quotes — still carries the provider's message VERBATIM, newlines
// included. It is read by a human through JSON, not by a line splitter, and
// reshaping it would be a separate contract change. So the call site passes both
// `reason` (that text) and `cause` (the thrown value); the tests below pin the
// separation in both directions.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LiteKernel, ObjectLogger } from '@objectstack/core';
import type { ConnectorProviderFactory } from '@objectstack/spec/integration';
import { ConnectorUpstreamUnavailableError } from '@objectstack/spec/integration';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';

afterEach(() => {
    vi.restoreAllMocks();
});

// ── fixtures ───────────────────────────────────────────────────────────────

/**
 * What an SDK-wrapping provider factory throws when its upstream is down and it
 * forwards the driver's own multi-line text. `connector-mcp` writes a single
 * line today (which is why #5636 is a `finding`), but nothing in the spec makes
 * that a rule — `ConnectorUpstreamUnavailableError`'s constructor takes whatever
 * message the factory hands it.
 */
const MULTILINE_UPSTREAM = [
    "connector 'gh_mcp' could not reach its MCP server",
    '  cause: connect ECONNREFUSED 127.0.0.1:8931',
    '  hint: is the MCP server running?',
].join('\n');

/** A provider-bound declarative entry, as `registerApp` stores it. */
function providerConnector(name: string, opts: { type?: string } = {}) {
    return {
        name,
        label: name,
        type: opts.type ?? 'api',
        provider: 'fake',
        providerConfig: {},
    };
}

/** A factory that is always down, throwing `message` with the #3017 marker. */
function downFactory(message: string): ConnectorProviderFactory {
    return () => {
        throw new ConnectorUpstreamUnavailableError(message);
    };
}

/**
 * Boot a kernel with a declared connector set and a provider factory. Boot must
 * NOT throw on an unreachable upstream — `{ fatal: true }` degrades (#3017) —
 * which is what puts this seam inside `serve`'s boot-quiet window.
 */
async function bootDegraded(declared: unknown[], factory: ConnectorProviderFactory, logger?: unknown) {
    const kernel = new LiteKernel({ logger: logger ?? { level: 'silent' } } as never);
    kernel.use(new AutomationServicePlugin());
    kernel.use({
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(ctx: any) {
            ctx.registerService('objectql', {
                registry: { listItems: (t: string) => (t === 'connector' ? declared : []) },
            });
            ctx.getService('automation').registerConnectorProvider('fake', factory);
        },
        async start() {},
    } as never);
    await kernel.bootstrap();
    return { kernel, engine: kernel.getService('automation') as AutomationEngine };
}

/** Capture everything written to one std stream while `fn` runs, split to lines. */
async function captureStream(
    which: 'stdout' | 'stderr',
    fn: () => Promise<void>,
): Promise<string[]> {
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
 * Re-stated, not imported: see the file docblock.
 */
const RECORD_HEAD = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z(?: \|)? (DEBUG|INFO|WARN|ERROR|FATAL)\b/;

const DEGRADE_PREFIX = '[Automation] connector instance';
const HUSK_PREFIX = '[Automation] could not register degraded husk';

// ── the `error` seam: the degrade announcement ─────────────────────────────

describe('#5636 — the degrade announcement is ONE record, cause in meta', () => {
    it('a multi-line upstream message never reaches the log message', async () => {
        const lines = await captureStream('stderr', async () => {
            const { kernel } = await bootDegraded(
                [providerConnector('gh_mcp')],
                downFactory(MULTILINE_UPSTREAM),
                { level: 'error', format: 'json' },
            );
            await kernel.shutdown();
        });

        const mine = lines.filter((l) => l.includes(DEGRADE_PREFIX));
        expect(mine, 'the seam announced exactly once').toHaveLength(1);
        // Pre-fix this was 3 physical lines, of which 2 carried no level head.
        expect(lines, 'one call, one physical line').toHaveLength(1);
        const record = JSON.parse(lines[0]) as {
            level: string;
            msg: string;
            error?: string;
            issues?: unknown;
        };
        expect(record.level).toBe('error');
        expect(record.msg).not.toContain('\n');
        expect(record.msg).toContain("'gh_mcp'");
        expect(record.msg).toContain("provider 'fake'");
        expect(record.msg).toContain('instance registered degraded (no actions)');
        expect(record.msg).toContain('attempt 1 (#3017)');
        // Not a validation rejection → `error`, not `issues`; and the full text
        // survives, newlines escaped by the logger's JSON.stringify.
        expect(record.issues).toBeUndefined();
        expect(record.error).toBe(MULTILINE_UPSTREAM);
    });

    it('renders as a single head-bearing line in `pretty` too', async () => {
        const lines = await captureStream('stderr', async () => {
            const { kernel } = await bootDegraded(
                [providerConnector('gh_mcp')],
                downFactory(MULTILINE_UPSTREAM),
                { level: 'error', format: 'pretty' },
            );
            await kernel.shutdown();
        });

        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(RECORD_HEAD);
        expect(lines[0]).toContain('ERROR');
        expect(lines[0]).toContain('ECONNREFUSED 127.0.0.1:8931');
        expect(lines[0]).toContain('is the MCP server running?');
    });

    it("calls error(message, undefined, meta) — the contract's third slot", async () => {
        const error = vi.spyOn(ObjectLogger.prototype, 'error');
        const { kernel } = await bootDegraded(
            [providerConnector('gh_mcp')],
            downFactory(MULTILINE_UPSTREAM),
        );

        const call = error.mock.calls.find((c) => String(c[0]).includes(DEGRADE_PREFIX));
        expect(call, 'the seam logged at error level').toBeDefined();
        const [message, errorSlot, meta] = call as [string, unknown, Record<string, unknown>];
        expect(message).not.toContain('\n');
        // The second slot stays empty on purpose: the raw error there ships its
        // stack on every retry record (#5575).
        expect(errorSlot).toBeUndefined();
        expect(meta.error).toBe(MULTILINE_UPSTREAM);
        expect(meta.issues).toBeUndefined();

        await kernel.shutdown();
    });

    it('leaves `degradedReason` verbatim — the husk field is not the log message', async () => {
        // The API-facing field keeps the provider's own text, newlines included:
        // `GET /connectors` and the `connector_action` refusal are read as JSON
        // by a human, not split by a line-oriented consumer. Moving the cause out
        // of the log MESSAGE must not reshape it.
        const { kernel, engine } = await bootDegraded(
            [providerConnector('gh_mcp')],
            downFactory(MULTILINE_UPSTREAM),
        );

        const desc = engine.getConnectorDescriptors().find((d) => d.name === 'gh_mcp');
        expect(desc?.state).toBe('degraded');
        expect(desc?.degradedReason).toBe(MULTILINE_UPSTREAM);
        expect(engine.getConnectorDegradedReason('gh_mcp')).toBe(MULTILINE_UPSTREAM);

        await kernel.shutdown();
    });
});

// ── the `warn` seam: the husk could not even be registered ─────────────────

describe('#5636 — a husk-registration rejection reports its issues, on one line', () => {
    // `buildDegradedHuskDef` copies `entry.type` through a cast, so a declared
    // `type` outside `ConnectorTypeSchema`'s enum makes `registerDegradedConnector`'s
    // `ConnectorSchema.parse` throw — the "entry's def no longer parses" case the
    // catch was written for, reached without stubbing the engine.
    const badTypeEntry = () => providerConnector('gh_mcp', { type: 'mcp_server' });

    it('the ZodError becomes structured meta, not a 13-line stdout spill', async () => {
        const lines = await captureStream('stdout', async () => {
            const { kernel } = await bootDegraded([badTypeEntry()], downFactory('upstream down'), {
                level: 'warn',
                format: 'json',
            });
            await kernel.shutdown();
        });

        const mine = lines.filter((l) => l.includes(HUSK_PREFIX));
        expect(mine, 'the husk failure was reported exactly once').toHaveLength(1);
        const record = JSON.parse(mine[0]) as {
            msg: string;
            issues?: Array<Record<string, unknown>>;
        };
        expect(record.msg).not.toContain('\n');
        expect(record.msg).toContain("'gh_mcp'");
        expect(record.msg).toContain('#3017');
        // The facts a reader came for.
        const issues = record.issues;
        expect(Array.isArray(issues)).toBe(true);
        expect(issues!.some((i) => i.path === 'type')).toBe(true);
        expect(JSON.stringify(issues)).not.toContain('REDACTED');
        // Every line on stdout still carries a level head — nothing for the boot
        // buffer to drop.
        for (const line of lines) {
            expect(classifyLine(line), line).not.toBeNull();
        }
    });

    it('calls warn(message, meta) — `warn` has no Error slot', async () => {
        // Verified against the contract rather than assumed: `Logger.warn` is
        // `warn(message, meta?)`, so the cause belongs in argument TWO here even
        // though the `error` seam above must use argument THREE.
        const warn = vi.spyOn(ObjectLogger.prototype, 'warn');
        const { kernel } = await bootDegraded([badTypeEntry()], downFactory('upstream down'));

        const call = warn.mock.calls.find((c) => String(c[0]).includes(HUSK_PREFIX));
        expect(call, 'the seam logged at warn level').toBeDefined();
        const [message, meta] = call as [string, Record<string, unknown>];
        expect(message).not.toContain('\n');
        expect(call).toHaveLength(2);
        const issues = meta.issues as Array<Record<string, unknown>>;
        expect(Array.isArray(issues)).toBe(true);
        expect(issues.some((i) => i.path === 'type')).toBe(true);

        await kernel.shutdown();
    });

    it('the retry bookkeeping survives a husk that could not register', async () => {
        // The whole reason the catch only logs: recovery is driven by
        // `degradedInstances`, which was written before the husk attempt.
        const { kernel, engine } = await bootDegraded([badTypeEntry()], downFactory('upstream down'));
        expect(engine.getRegisteredConnectors()).not.toContain('gh_mcp');
        await kernel.shutdown();
    });
});

// ── reverse verification, direction predicted before running ───────────────

/**
 * `classifyBootLogLine`'s verdict, reduced to what matters here: a line either
 * carries an `ObjectLogger` level head (retained by `BootLogCapture`) or it does
 * not (dropped by `offer()`).
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

describe('#5636 — what the interpolated rendering cost, measured', () => {
    it('the pre-fix `warn` shape loses its every fact to the boot buffer', async () => {
        // Predicted BEFORE running, and it is the plain red direction: rendering
        // the OLD shape — a multi-line cause inside the message — must produce
        // MANY physical lines of which exactly ONE classifies (the head line,
        // truncated at Zod's `[`), so a boot-quiet window retains that one and
        // drops the rest. The fixed shape must produce exactly one line that
        // classifies AND carries the facts. (A local reproduction: the seam's own
        // one-line guarantee is asserted end-to-end above.)
        const zodDump = JSON.stringify(
            [
                {
                    code: 'invalid_value',
                    values: ['saas', 'database', 'file_storage', 'message_queue', 'api', 'custom'],
                    path: ['type'],
                    message: 'Invalid option',
                },
            ],
            null,
            2,
        );
        expect(zodDump.split('\n').length, 'fixture must be multi-line').toBeGreaterThan(1);
        expect(zodDump.split('\n')[0].trim(), "…and open with Zod's `[`").toBe('[');

        const log = new ObjectLogger({ level: 'warn', format: 'pretty' });

        const before = await captureStream('stdout', async () => {
            log.warn(`[Automation] could not register degraded husk for 'gh_mcp': ${zodDump}`);
        });
        expect(before.length, 'one call, many physical lines').toBeGreaterThan(1);
        const beforeKept = before.filter((l) => classifyLine(l) !== null);
        expect(beforeKept).toHaveLength(1);
        // What the boot buffer would keep: a warning that names the instance and
        // then stops at a bracket. Every fact is on a dropped line.
        expect(beforeKept[0].trimEnd().endsWith('[')).toBe(true);
        expect(beforeKept[0]).not.toContain('Invalid option');
        expect(before.length - beforeKept.length, 'lines the buffer drops').toBeGreaterThan(1);

        const after = await captureStream('stdout', async () => {
            log.warn(`[Automation] could not register degraded husk for 'gh_mcp' (#3017).`, {
                issues: [{ code: 'invalid_value', path: 'type', message: 'Invalid option' }],
            });
        });
        expect(after).toHaveLength(1);
        expect(classifyLine(after[0])).toBe('warn');
        expect(after[0]).toContain('Invalid option');
        expect(after[0]).toContain('type');
    });

    it('the pre-fix `error` shape splits one degrade into unattributable fragments', async () => {
        // Same prediction on the stderr side, where nothing buffers: the record
        // is not dropped, it is mis-read — the continuation lines carry no level
        // and no timestamp, so a file sink stores them as their own records and a
        // `grep ERROR` returns the one line that holds no facts.
        const log = new ObjectLogger({ level: 'error', format: 'pretty' });

        const before = await captureStream('stderr', async () => {
            log.error(
                `[Automation] connector instance 'gh_mcp' (provider 'fake') upstream unavailable — ` +
                    `instance registered degraded (no actions); retrying with backoff, attempt 1 (#3017): ${MULTILINE_UPSTREAM}`,
            );
        });
        expect(before).toHaveLength(3);
        expect(before.filter((l) => classifyLine(l) !== null)).toHaveLength(1);
        expect(before[1]).not.toMatch(RECORD_HEAD);
        expect(before[1]).toContain('ECONNREFUSED');

        const after = await captureStream('stderr', async () => {
            log.error(
                `[Automation] connector instance 'gh_mcp' (provider 'fake') upstream unavailable — ` +
                    `instance registered degraded (no actions); retrying with backoff, attempt 1 (#3017).`,
                undefined,
                { error: MULTILINE_UPSTREAM },
            );
        });
        expect(after).toHaveLength(1);
        expect(after[0]).toMatch(RECORD_HEAD);
        expect(after[0]).toContain('ECONNREFUSED');
    });
});
