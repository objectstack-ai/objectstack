// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression: #5660 — `AutomationEngine.registerDegradedConnector`'s own `warn`
// must not interpolate the provider's `reason` into its log message.
//
// This is the FOURTH seam of the family #5048 (flow binding), #5575
// (`reconcileDeclaredConnectors`'s `fail()`) and #5636 (`degradeConnectorInstance`'s
// two records) closed, and it lives in a different file, in a different method,
// with a different contract — hence its own issue and its own test file.
//
// Two properties make it the one most worth pinning, and both are about ORDER,
// not severity:
//
//   • It fires FIRST. `degradeConnectorInstance` calls
//     `engine.registerDegradedConnector(husk, info.reason, 'declarative')` and
//     only then logs its own records, so this `warn` precedes both of #5636's.
//   • It fires on the DEFAULT branch. #5636's `warn` is in a `catch` — reached
//     only when the husk itself fails to parse. This one is on that `try`
//     SUCCEEDING, i.e. on every first degrade of every instance.
//
// So after #5636 the common cold-boot degrade still spilled a multi-line
// provider message onto stdout.
//
// ## The downstream, same mechanism as #5636 (which measured it)
//
// `ObjectLogger` routes `warn` to **stdout**; `serve`'s boot-quiet window wraps
// `process.stdout.write` only; a cold boot reaches this seam inside that window
// because `materializeDeclaredConnectors(ctx, { fatal: true })` DEGRADES rather
// than throwing when an upstream is unreachable. `BootLogCapture.offer()` keeps
// a physical line only when `classifyBootLogLine` finds a `<ts> <LEVEL>` head on
// it, so every continuation line of an interpolated message is DROPPED — not
// merely mangled. cloud#971's original shape.
//
// ## Reachability (why the issue is a `finding`)
//
// Every `ConnectorUpstreamUnavailableError` message under `packages/connectors/*`
// is single-line text we wrote. But the class takes whatever message a factory
// hands it, and ADR-0097 explicitly invites third parties to write provider
// factories; the spec constrains the `code`, never the text. The first factory
// that forwards an SDK's multi-line failure lands here.
//
// ## What this change deliberately does NOT touch
//
// `reason` — stored as the husk's `degradedReason`, surfaced by `GET /connectors`
// and quoted by a `connector_action` refusal — stays VERBATIM, newlines included.
// It is read by a human through JSON, not split by a line-oriented consumer.
// #5636 made the same call one layer up; the tests below pin it from both sides,
// so a future "let's normalize the reason too" cannot pass unnoticed.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LiteKernel, ObjectLogger } from '@objectstack/core';
import type { Connector, ConnectorProviderFactory } from '@objectstack/spec/integration';
import { ConnectorSchema, ConnectorUpstreamUnavailableError } from '@objectstack/spec/integration';
import { AutomationServicePlugin } from './plugin.js';
import { AutomationEngine } from './engine.js';

afterEach(() => {
    vi.restoreAllMocks();
});

// ── fixtures ───────────────────────────────────────────────────────────────

/**
 * What an SDK-wrapping provider factory throws when its upstream is down and it
 * forwards the driver's own multi-line text.
 */
const MULTILINE_UPSTREAM = [
    "connector 'gh_mcp' could not reach its MCP server",
    '  cause: connect ECONNREFUSED 127.0.0.1:8931',
    '  hint: is the MCP server running?',
].join('\n');

/** The two facts that live on the CONTINUATION lines of the old shape. */
const CAUSE_LINE_FACT = 'ECONNREFUSED 127.0.0.1:8931';
const HINT_LINE_FACT = 'is the MCP server running?';

/** A provider-bound declarative entry, as `registerApp` stores it. */
function providerConnector(name: string) {
    return { name, label: name, type: 'api', provider: 'fake', providerConfig: {} };
}

/** A factory that is always down, throwing the #3017 marker error. */
function downFactory(message: string, cause?: unknown): ConnectorProviderFactory {
    return () => {
        throw new ConnectorUpstreamUnavailableError(message, { cause });
    };
}

/**
 * The action-less husk `buildDegradedHuskDef` produces, for the direct-call
 * tests below (which exercise the engine method without a plugin around it).
 */
function huskDef(name: string): Connector {
    return {
        name,
        label: name,
        type: 'api',
        status: 'error',
        enabled: true,
        authentication: { type: 'none' },
        connectionTimeoutMs: 30000,
        requestTimeoutMs: 30000,
        actions: [],
    } as Connector;
}

/**
 * Boot a kernel with a declared connector set and a provider factory. Boot must
 * NOT throw on an unreachable upstream — `{ fatal: true }` degrades (#3017) —
 * which is exactly what puts this seam inside `serve`'s boot-quiet window.
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
    fn: () => Promise<void> | void,
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
 * Re-stated rather than imported: this package must not depend on
 * `@objectstack/cli`, and the predicate is the general one every line-based
 * consumer keys off, the CLI's boot buffer being the strictest example.
 */
const RECORD_HEAD = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z(?: \|)? (DEBUG|INFO|WARN|ERROR|FATAL)\b/;

/** `classifyBootLogLine`'s verdict, reduced to retained-or-dropped. */
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

const REGISTER_PREFIX = 'Connector registered DEGRADED';

interface DegradeRecord {
    level: string;
    msg: string;
    degradedReason?: unknown;
    error?: unknown;
    issues?: Array<Record<string, unknown>>;
}

// ── the seam, end to end through a cold boot ───────────────────────────────

describe('#5660 — the degrade REGISTRATION is one record, cause in meta', () => {
    it('a multi-line provider reason never reaches the log message', async () => {
        const lines = await captureStream('stdout', async () => {
            const { kernel } = await bootDegraded(
                [providerConnector('gh_mcp')],
                downFactory(MULTILINE_UPSTREAM),
                { level: 'warn', format: 'json' },
            );
            await kernel.shutdown();
        });

        const mine = lines.filter((l) => l.includes(REGISTER_PREFIX));
        expect(mine, 'the registration announced itself exactly once').toHaveLength(1);
        const record = JSON.parse(mine[0]) as DegradeRecord;

        expect(record.level).toBe('warn');
        // Pre-fix this message carried the reason's three lines, so the record
        // became three physical lines of which two had no level head.
        expect(record.msg).not.toContain('\n');
        expect(record.msg).toContain('gh_mcp');
        expect(record.msg).toContain('origin: declarative');
        // Self-sufficient without the reason: what the state costs and what
        // happens next, so the message alone is a usable record.
        expect(record.msg).toContain('no actions and no handlers');
        expect(record.msg).toContain('#3017');
        // …and none of the foreign text is in it.
        expect(record.msg).not.toContain(CAUSE_LINE_FACT);
        expect(record.msg).not.toContain(HINT_LINE_FACT);

        // The facts, in fields a log query can filter on. `degradedReason` is
        // what the registration STORED; `error` is the thrown value's own
        // rendering (`describeThrownForLog`, not a validation rejection here).
        expect(record.degradedReason).toBe(MULTILINE_UPSTREAM);
        expect(record.error).toBe(MULTILINE_UPSTREAM);
        expect(record.issues).toBeUndefined();

        // Nothing anywhere on stdout for the boot buffer to drop.
        for (const line of lines) {
            expect(classifyLine(line), line).not.toBeNull();
        }
    });

    it('renders as a single head-bearing line in `pretty` too', async () => {
        // `pretty` is what the CLI gets (the kernel builds the logger from a
        // bare `{ level }`), so it is the format the boot buffer actually reads.
        const lines = await captureStream('stdout', async () => {
            const { kernel } = await bootDegraded(
                [providerConnector('gh_mcp')],
                downFactory(MULTILINE_UPSTREAM),
                { level: 'warn', format: 'pretty' },
            );
            await kernel.shutdown();
        });

        const mine = lines.filter((l) => l.includes(REGISTER_PREFIX));
        expect(mine).toHaveLength(1);
        expect(mine[0]).toMatch(RECORD_HEAD);
        expect(mine[0]).toContain('WARN');
        // The cause survives on that one line — newlines escaped by the meta's
        // JSON.stringify, which is the whole point of moving it out of `msg`.
        expect(mine[0]).toContain(CAUSE_LINE_FACT);
        expect(mine[0]).toContain(HINT_LINE_FACT);
        for (const line of lines) {
            expect(classifyLine(line), line).not.toBeNull();
        }
    });

    it('calls warn(message, meta) — `warn` has no Error slot', async () => {
        // Checked against the `Logger` contract rather than assumed:
        // `warn(message, meta?)` has no `Error` parameter (only `error`/`fatal`
        // do), so the cause belongs in argument TWO here.
        const warn = vi.spyOn(ObjectLogger.prototype, 'warn');
        const { kernel } = await bootDegraded(
            [providerConnector('gh_mcp')],
            downFactory(MULTILINE_UPSTREAM),
        );

        const call = warn.mock.calls.find((c) => String(c[0]).includes(REGISTER_PREFIX));
        expect(call, 'the seam logged at warn level').toBeDefined();
        expect(call).toHaveLength(2);
        const [message, meta] = call as [string, Record<string, unknown>];
        expect(message).not.toContain('\n');
        expect(meta.degradedReason).toBe(MULTILINE_UPSTREAM);
        expect(meta.error).toBe(MULTILINE_UPSTREAM);

        await kernel.shutdown();
    });

    it('leaves the API-facing `degradedReason` verbatim, newlines included', async () => {
        // The other direction of the same contract: moving the cause out of the
        // log MESSAGE must not reshape what `GET /connectors` shows or what a
        // `connector_action` refusal quotes.
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

    it("the error's own nested `cause` is carried, not yet rendered", async () => {
        // Honest scope statement, pinned so nobody reads more into A-route than
        // it delivers. `ConnectorUpstreamUnavailableError` takes a `cause` (the
        // underlying connect error) and forwarding the THROWN VALUE is what
        // makes rendering it possible at all — but `describeThrownForLog` reads
        // `.message` / `.issues` only, so the nested cause does not appear in
        // the record today. Widening that is a change to the shared helper,
        // used by four seams; it is not this seam's call to make.
        const warn = vi.spyOn(ObjectLogger.prototype, 'warn');
        const { kernel } = await bootDegraded(
            [providerConnector('gh_mcp')],
            downFactory('upstream down', new Error('connect ECONNREFUSED 127.0.0.1:8931')),
        );

        const call = warn.mock.calls.find((c) => String(c[0]).includes(REGISTER_PREFIX));
        const [, meta] = call as [string, Record<string, unknown>];
        expect(meta.error).toBe('upstream down');
        expect(JSON.stringify(meta)).not.toContain('ECONNREFUSED');

        await kernel.shutdown();
    });
});

// ── the optional parameter, from both sides ────────────────────────────────

describe('#5660 — `cause` is optional and the record stays useful without it', () => {
    it('a two-argument call still reports the reason, in meta', async () => {
        // Non-breaking by construction: `cause` sits after the defaulted
        // `origin`, so every pre-existing call shape still compiles — this test
        // IS one (def + reason only). The record must still carry the fact an
        // operator came for, so `degradedReason` is unconditional.
        const engine = new AutomationEngine(new ObjectLogger({ level: 'warn', format: 'json' }));

        const lines = await captureStream('stdout', () => {
            engine.registerDegradedConnector(huskDef('gh_mcp'), MULTILINE_UPSTREAM);
        });

        expect(lines).toHaveLength(1);
        const record = JSON.parse(lines[0]) as DegradeRecord;
        expect(record.msg).not.toContain('\n');
        expect(record.msg).toContain('origin: declarative');
        expect(record.degradedReason).toBe(MULTILINE_UPSTREAM);
        // No thrown value was supplied, so no rendering of one is invented.
        expect(record.error).toBeUndefined();
        expect(record.issues).toBeUndefined();
        // The husk registered, reason verbatim.
        expect(engine.getConnectorDegradedReason('gh_mcp')).toBe(MULTILINE_UPSTREAM);
    });

    it('a validation rejection as `cause` renders as `issues`, on one line', async () => {
        // The other branch of `describeThrownForLog`, reachable by any future
        // caller whose failure is a schema rejection: a `ZodError.message` is a
        // multi-line JSON dump opening on a bare `[`, so this is the shape that
        // cost cloud#971 an rc line. It must stay one physical line, and the
        // rejected key names must survive `ObjectLogger`'s substring redactor
        // (#5573 — which is why the flattened field is `unrecognized`, not
        // `keys`).
        const rejected = ConnectorSchema.safeParse({ name: 'gh_mcp', nope: true });
        expect(rejected.success, 'fixture must actually be rejected').toBe(false);
        const zodError = (rejected as { error: unknown }).error;
        expect(String((zodError as Error).message)).toContain('\n');

        const engine = new AutomationEngine(new ObjectLogger({ level: 'warn', format: 'json' }));
        const lines = await captureStream('stdout', () => {
            engine.registerDegradedConnector(huskDef('gh_mcp'), 'husk def rejected', 'declarative', zodError);
        });

        expect(lines).toHaveLength(1);
        const record = JSON.parse(lines[0]) as DegradeRecord;
        expect(record.msg).not.toContain('\n');
        expect(record.degradedReason).toBe('husk def rejected');
        expect(Array.isArray(record.issues)).toBe(true);
        expect(record.issues!.length).toBeGreaterThan(0);
        expect(record.error).toBeUndefined();
        expect(JSON.stringify(record.issues)).not.toContain('REDACTED');
    });
});

// ── reverse verification, direction predicted before running ───────────────

describe('#5660 — what the interpolated rendering cost, measured', () => {
    it('the pre-fix shape puts the cause and the hint on lines the buffer drops', async () => {
        // Predicted BEFORE running, and it is the plain red direction — but the
        // claim is NARROWER than #5636's, deliberately, because the payload is
        // different. A ZodError dump opens on a bare `[`, so there the ONE
        // retained line held no facts at all. Here the reason's FIRST line is
        // ordinary prose and does survive on the head line; what is lost is
        // every line after it — the `cause:` and `hint:` lines, i.e. the address
        // to connect to and the thing to check. So: OLD → 3 physical lines, 1
        // classifies, 2 dropped, and the survivor names the failure without
        // saying anything actionable. NEW → 1 line, classifies, carries both.
        // Reporting "every fact is lost" here would have been the tidier story
        // and the wrong one.
        const log = new ObjectLogger({ level: 'warn', format: 'pretty' });

        const before = await captureStream('stdout', () => {
            log.warn(`Connector registered DEGRADED: gh_mcp (origin: declarative) — ${MULTILINE_UPSTREAM}`);
        });
        expect(before, 'one call, three physical lines').toHaveLength(3);
        const beforeKept = before.filter((l) => classifyLine(l) !== null);
        expect(beforeKept).toHaveLength(1);
        expect(beforeKept[0]).toContain('could not reach its MCP server');
        expect(beforeKept[0]).not.toContain(CAUSE_LINE_FACT);
        expect(beforeKept[0]).not.toContain(HINT_LINE_FACT);
        // The dropped lines are where the actionable detail was.
        const beforeDropped = before.filter((l) => classifyLine(l) === null);
        expect(beforeDropped).toHaveLength(2);
        expect(beforeDropped.join('\n')).toContain(CAUSE_LINE_FACT);
        expect(beforeDropped.join('\n')).toContain(HINT_LINE_FACT);

        const after = await captureStream('stdout', () => {
            log.warn(
                'Connector registered DEGRADED: gh_mcp (origin: declarative) — no actions and no handlers ' +
                    'until its upstream is reachable; a connector_action dispatching to it fails with the stored ' +
                    'reason, and the materializer retries with backoff (#3017).',
                { degradedReason: MULTILINE_UPSTREAM, error: MULTILINE_UPSTREAM },
            );
        });
        expect(after).toHaveLength(1);
        expect(classifyLine(after[0])).toBe('warn');
        expect(after[0]).toContain(CAUSE_LINE_FACT);
        expect(after[0]).toContain(HINT_LINE_FACT);
    });
});
