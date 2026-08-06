// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression: #5048 — a flow that fails to bind must report WHY, on the line
// that carries the level prefix.
//
// The three `registerFlow` seams in AutomationServicePlugin (boot pull,
// `metadata:reloaded` re-sync, `kernel:ready` cold-boot bind) plus the
// `getMetaItems('flow')` read all rendered their failure by interpolating
// `err.message` into a single-line `logger.warn`. `registerFlow` parses with
// `FlowSchema`, which #4001 closed — an unrecognized key THROWS — and a
// ZodError's `.message` is a pretty-printed JSON dump of its issue array whose
// first line is the single character `[`.
//
// `ObjectLogger` writes one `<ts> <LEVEL> <msg>` record per call, so a message
// carrying newlines spills onto lines with no level prefix, and `serve`'s
// boot-diagnostic buffer (packages/cli/src/utils/boot-log-capture.ts) keeps a
// line only when `classifyBootLogLine` finds that prefix. Every continuation
// line was therefore dropped: 24 warnings that named 24 flows and then said
// `[`. That unreadability is what let cloud#971 survive a whole rc.1 line.
//
// These tests pin both halves of the fix: the seams hand the facts to the
// logger's `meta` argument (asserted on the call), and the resulting record
// occupies ONE physical line with the offending key name still in it (asserted
// on real rendered output — which is also what catches `ObjectLogger`'s
// substring redactor eating a field called `keys`).
//
// Scope note (#5575): the boot-buffer half of the mechanism above is specific to
// these `warn` seams — `ObjectLogger` routes `warn` to stdout, which is what
// `serve`'s boot-quiet window wraps. The connector reconcile seam reports at
// `error` (stderr, never buffered) and is pinned in ./connector-fail-cause.test.ts
// against the consumers it actually has. The helper this file exercises is shared
// by both, hence its name.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LiteKernel, ObjectLogger, createLogger } from '@objectstack/core';
import { FlowSchema } from '@objectstack/spec/automation';
import { AutomationEngine } from './engine.js';
import { AutomationServicePlugin } from './plugin.js';
import {
    describeThrownForLog,
    formatIssuePath,
    MAX_LOGGED_CAUSE_ISSUES,
} from './thrown-cause-diagnostics.js';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** Fire 'metadata:reloaded' the way MetadataPlugin / a Studio publish does. */
const reload = (kernel: LiteKernel) => (kernel as any).context.trigger('metadata:reloaded', {});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── fixtures ───────────────────────────────────────────────────────────────

/**
 * A flow the closed `FlowSchema` (#4001) rejects: `visibleIf` sits at NODE
 * level, a sibling of `id`/`type`, so it is an `unrecognized_keys` issue with a
 * non-empty path (`nodes[0]`). The same mistake inside `config` would be caught
 * later by #4277's descriptor check (a plain Error), which is the other branch
 * covered below — so the placement here is deliberate, not incidental.
 */
function flowWithUnknownNodeKey(name: string) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            {
                id: 'start',
                type: 'start',
                label: 'Start',
                visibleIf: 'status == "done"',
                config: { objectName: 'task', triggerType: 'record-after-update' },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    };
}

/** A well-formed flow, for the seams that must still bind. */
function goodFlow(name: string) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            {
                id: 'start',
                type: 'start',
                label: 'Start',
                config: { objectName: 'task', triggerType: 'record-after-update' },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    };
}

/** The protocol's flattened flow view, in the `{ items: [...] }` envelope. */
function fakeProtocolService(flows: () => unknown[], opts: { throwOnRead?: Error } = {}) {
    return {
        async getMetaItems(q: { type: string }) {
            if (opts.throwOnRead) throw opts.throwOnRead;
            return { items: q.type === 'flow' ? flows() : [] };
        },
    };
}

async function bootKernel(
    flows: () => unknown[],
    opts: { throwOnRead?: Error } = {},
): Promise<LiteKernel> {
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    kernel.use(new AutomationServicePlugin());
    kernel.use({
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: [] as string[],
        async init(ctx: any) {
            ctx.registerService('protocol', fakeProtocolService(flows, opts));
        },
        async start() {},
    } as never);
    await kernel.bootstrap();
    return kernel;
}

/** Every `logger.warn` whose message starts with `prefix`. */
function warnsMatching(spy: { mock: { calls: unknown[][] } }, prefix: string): unknown[][] {
    return spy.mock.calls.filter((c: unknown[]) => String(c[0]).startsWith(prefix));
}

// ── the seams ──────────────────────────────────────────────────────────────

describe('flow-bind failures report their Zod issues structurally (#5048)', () => {
    it('cold-boot bind: the message is newline-free and the issues ride in meta', async () => {
        const warn = vi.spyOn(ObjectLogger.prototype, 'warn');
        const kernel = await bootKernel(() => [flowWithUnknownNodeKey('campaign_enrollment')]);
        await flush();

        const calls = warnsMatching(warn, '[Automation] cold-boot flow bind: failed to register');
        expect(calls.length, 'the cold-boot seam warned exactly once').toBe(1);
        const [message, meta] = calls[0] as [string, Record<string, unknown>];

        // Half one: the first argument is a single line. Pre-fix it ended in
        // `: [` and the rest of the dump followed on prefix-less lines the boot
        // capture drops.
        expect(message).not.toContain('\n');

        // Half two: the facts are present, and complete.
        expect(meta).toBeTypeOf('object');
        expect(meta.flow).toBe('campaign_enrollment');
        expect(meta.error, 'a validation rejection reports `issues`, not `error`').toBeUndefined();
        const issues = meta.issues as Array<Record<string, unknown>>;
        expect(Array.isArray(issues)).toBe(true);
        expect(issues.length).toBeGreaterThanOrEqual(1);
        const unrecognized = issues.find((i) => i.code === 'unrecognized_keys');
        expect(unrecognized, 'the unrecognized_keys issue survived').toBeDefined();
        expect(unrecognized!.unrecognized).toEqual(['visibleIf']);
        expect(unrecognized!.path).toBe('nodes[0]');
        expect(String(unrecognized!.message)).toContain('visibleIf');

        await kernel.shutdown();
    });

    it('re-sync (metadata:reloaded): same shape at the second seam', async () => {
        const warn = vi.spyOn(ObjectLogger.prototype, 'warn');
        let served: unknown[] = [goodFlow('nightly_digest')];
        const kernel = await bootKernel(() => served);
        await flush();
        warn.mockClear();

        // A Studio publish / dev reload now serves a flow the schema rejects.
        served = [flowWithUnknownNodeKey('nightly_digest')];
        await reload(kernel);
        await flush();

        const calls = warnsMatching(warn, '[Automation] flow re-sync: failed to register');
        expect(calls.length, 're-sync warned once for the rejected flow').toBe(1);
        const [message, meta] = calls[0] as [string, Record<string, unknown>];
        expect(message).not.toContain('\n');
        expect(meta.flow).toBe('nightly_digest');
        expect((meta.issues as unknown[])?.length).toBeGreaterThanOrEqual(1);

        await kernel.shutdown();
    });

    it('a NON-Zod registration failure falls back to the `error` string, with no `issues`', async () => {
        const warn = vi.spyOn(ObjectLogger.prototype, 'warn');
        let served: unknown[] = [goodFlow('escalate_case')];
        const kernel = await bootKernel(() => served);
        await flush();

        // Not every registerFlow rejection is a ZodError: #4277's descriptor
        // check and the DAG/expression validators throw plain Errors, and those
        // must still be reported — as a string, not as a phantom empty `issues`.
        const engine = kernel.getService<AutomationEngine>('automation');
        vi.spyOn(engine, 'registerFlow').mockImplementation(() => {
            throw new Error('Node "start": config key `visibleIf` is not declared by its descriptor');
        });
        warn.mockClear();

        served = [goodFlow('escalate_case')];
        await reload(kernel);
        await flush();

        const calls = warnsMatching(warn, '[Automation] flow re-sync: failed to register');
        expect(calls.length).toBe(1);
        const [message, meta] = calls[0] as [string, Record<string, unknown>];
        expect(message).not.toContain('\n');
        expect(meta.flow).toBe('escalate_case');
        expect(meta.issues).toBeUndefined();
        expect(meta.error).toContain('visibleIf');

        await kernel.shutdown();
    });

    it('a failed getMetaItems read reports its cause in meta too', async () => {
        const warn = vi.spyOn(ObjectLogger.prototype, 'warn');
        const kernel = await bootKernel(() => [], { throwOnRead: new Error('protocol offline') });
        await flush();

        const calls = warnsMatching(warn, '[Automation] flow read from protocol failed');
        expect(calls.length).toBeGreaterThanOrEqual(1);
        const [message, meta] = calls[0] as [string, Record<string, unknown>];
        expect(message).not.toContain('\n');
        expect((meta as { error?: string }).error).toBe('protocol offline');

        await kernel.shutdown();
    });

    it('a well-formed flow still binds and warns about nothing', async () => {
        const warn = vi.spyOn(ObjectLogger.prototype, 'warn');
        const kernel = await bootKernel(() => [goodFlow('notify_on_done')]);
        await flush();

        expect(warnsMatching(warn, '[Automation] cold-boot flow bind: failed to register')).toHaveLength(0);
        const engine = kernel.getService<AutomationEngine>('automation');
        expect(await engine.getFlow('notify_on_done')).not.toBeNull();

        await kernel.shutdown();
    });
});

// ── the rendered record ────────────────────────────────────────────────────

describe('the rendered warning is ONE line that still names the key (#5048)', () => {
    /** Capture what `ObjectLogger` actually writes to stdout. */
    function captureStdout(fn: (log: ObjectLogger) => void): string[] {
        const chunks: string[] = [];
        const spy = vi
            .spyOn(process.stdout, 'write')
            .mockImplementation(((c: string | Uint8Array) => {
                chunks.push(String(c));
                return true;
            }) as never);
        try {
            fn(createLogger({ level: 'warn', format: 'json' }));
        } finally {
            spy.mockRestore();
        }
        return chunks.join('').split('\n').filter(Boolean);
    }

    it('renders on one physical line, with the offending key name intact', () => {
        // A real FlowSchema rejection — not a hand-written issue array — so the
        // assertion tracks whatever Zod actually produces.
        let thrown: unknown;
        try {
            FlowSchema.parse(flowWithUnknownNodeKey('campaign_enrollment'));
        } catch (err) {
            thrown = err;
        }
        expect(thrown, 'FlowSchema must reject the fixture — otherwise this test proves nothing').toBeDefined();
        // The defect's fingerprint: the string form is multi-line and opens with `[`.
        expect(String((thrown as Error).message).split('\n').length).toBeGreaterThan(1);
        expect(String((thrown as Error).message).split('\n')[0].trim()).toBe('[');

        const lines = captureStdout((log) => {
            log.warn('[Automation] cold-boot flow bind: failed to register flow', {
                flow: 'campaign_enrollment',
                ...describeThrownForLog(thrown),
            });
        });

        expect(lines, 'one warn call must render as exactly one line').toHaveLength(1);
        const record = JSON.parse(lines[0]) as Record<string, unknown>;
        expect(record.msg).toBe('[Automation] cold-boot flow bind: failed to register flow');
        expect(record.flow).toBe('campaign_enrollment');
        // The whole point: the reader can see WHICH key, WHERE.
        expect(lines[0]).toContain('visibleIf');
        expect(lines[0]).toContain('nodes[0]');
        // And nothing was eaten by the redactor on the way out.
        expect(lines[0]).not.toContain('REDACTED');
    });

    it("a verbatim Zod `keys` field is no longer eaten by the redactor (#5573 re-judged this pin)", () => {
        // RE-JUDGED, by the maintainer's ruling on #5573. Until then
        // `ObjectLogger` redacted by SUBSTRING and its default list contains
        // `key`, which `keys` contains — so this same meta rendered
        // `"keys":"***REDACTED***"` and this test pinned that, as the evidence
        // for naming the field `unrecognized` here. Redaction now matches on
        // camelCase/snake_case WORD boundaries: `key` matches `apiKey`/`api_key`,
        // not `keys`. So the verdict flips, and it flips onto a positive
        // assertion — the key name is present in the output, not merely
        // un-redacted-because-empty.
        //
        // NB the module docblock of `thrown-cause-diagnostics.ts` still
        // describes the substring rule in its first bullet; that sentence is
        // superseded here. The SECOND reason it gives for re-shaping is
        // untouched and still load-bearing: a raw Zod issue can carry the whole
        // rejected `input`, and a log record must stay bounded. That is why
        // this helper keeps flattening issues rather than forwarding them.
        const lines = captureStdout((log) => {
            log.warn('verbatim', {
                issues: [{ code: 'unrecognized_keys', keys: ['visibleIf'], path: ['nodes', 0] }],
            });
        });
        expect(lines).toHaveLength(1);
        expect(lines[0]).not.toContain('REDACTED');
        expect(lines[0]).toContain('visibleIf');
        // The whole field survives, not just the name fragment.
        const record = JSON.parse(lines[0]) as { issues?: unknown };
        expect(record.issues).toEqual([{ code: 'unrecognized_keys', keys: ['visibleIf'], path: ['nodes', 0] }]);
    });

    it('a multi-line NON-Zod message still occupies one line (JSON escapes the newlines)', () => {
        const lines = captureStdout((log) => {
            log.warn('[Automation] flow re-sync: failed to register flow', {
                flow: 'f',
                ...describeThrownForLog(new Error('line one\nline two\nline three')),
            });
        });
        expect(lines).toHaveLength(1);
        const record = JSON.parse(lines[0]) as { error?: string };
        expect(record.error).toBe('line one\nline two\nline three');
    });
});

// ── the helper ─────────────────────────────────────────────────────────────

describe('describeThrownForLog / formatIssuePath', () => {
    it('formats paths with array indices, and names the root explicitly', () => {
        expect(formatIssuePath([])).toBe('(root)');
        expect(formatIssuePath(undefined)).toBe('(root)');
        expect(formatIssuePath(['nodes', 0])).toBe('nodes[0]');
        expect(formatIssuePath(['nodes', 2, 'config', 'objectName'])).toBe('nodes[2].config.objectName');
        expect(formatIssuePath([0, 'a'])).toBe('[0].a');
    });

    it('reports `issues` for a ZodError-shaped throw and `error` for anything else', () => {
        const zodish = { issues: [{ code: 'invalid_type', path: ['version'], message: 'expected number' }] };
        expect(describeThrownForLog(zodish)).toEqual({
            issues: [{ code: 'invalid_type', path: 'version', message: 'expected number' }],
        });

        expect(describeThrownForLog(new Error('boom'))).toEqual({ error: 'boom' });
        expect(describeThrownForLog('a bare string')).toEqual({ error: 'a bare string' });
        expect(describeThrownForLog(undefined)).toEqual({ error: 'undefined' });
    });

    it('caps the issue list and DECLARES the cap instead of truncating silently', () => {
        const many = {
            issues: Array.from({ length: MAX_LOGGED_CAUSE_ISSUES + 7 }, (_, i) => ({
                code: 'unrecognized_keys',
                keys: [`k${i}`],
                path: ['nodes', i],
                message: `Unrecognized key: "k${i}"`,
            })),
        };
        const meta = describeThrownForLog(many);
        expect(meta.issues).toHaveLength(MAX_LOGGED_CAUSE_ISSUES);
        expect(meta.issueCount).toBe(MAX_LOGGED_CAUSE_ISSUES + 7);
        // Under the cap the count is omitted — no noise when nothing was dropped.
        expect(describeThrownForLog({ issues: many.issues.slice(0, 3) }).issueCount).toBeUndefined();
    });

    it('an empty issues array is still a validation rejection, not an `error` string', () => {
        // A ZodError with zero issues should not fall through to the string
        // branch and re-render as `"error":"[]"` — the shape decides.
        expect(describeThrownForLog({ issues: [], message: '[]' })).toEqual({ issues: [] });
    });
});
