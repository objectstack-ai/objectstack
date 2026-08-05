// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression: #5575 — the declarative connector reconcile must report WHY an
// instance failed, in a form a log consumer can actually read.
//
// `reconcileDeclaredConnectors`'s `fail()` has two paths (ADR-0097): at boot it
// throws (fatal), and after `metadata:reloaded` — a Studio publish, an `os dev`
// recompile — it logs and keeps the old connector serving (soft). Two of its call
// sites interpolated a FOREIGN `err.message` into that log message:
//
//     fail((err as Error).message);                                   // auth resolution
//     fail(`… '${name}' via provider '${provider}': ${err.message} …`) // factory throw
//
// Neither message is ours: the credential resolver is host-supplied
// (`AutomationServicePluginOptions.credentialResolver`) and a provider factory is
// third-party code ADR-0097 explicitly invites. The first one that validates its
// `providerConfig` with a strict Zod schema throws a `ZodError`, whose `.message`
// is a multi-line JSON dump of the issue array — first line `[`. `ObjectLogger`
// emits one `<ts> <LEVEL> <msg>` record per call, so such a message spills onto
// physical lines carrying no level head, and every line-oriented consumer of the
// runtime's stderr (the file sink, `docker logs`/journald into a shipper, a
// `grep ERROR`) reads those as garbage records — one diagnostic becomes N
// unattributable fragments. Same class as #5048 at the flow-bind seams, same
// #4632 principle: a mangled diagnostic costs more than no diagnostic.
//
// NOT the same mechanism, though, and the difference is pinned below: `warn`
// goes to stdout, which `serve`'s boot-quiet window wraps and filters; `error`
// goes to stderr, which nothing in the CLI buffers. #5575's issue text credited
// the boot buffer for this seam's harm — it never sees it. The line-orientation
// of the *consumers* is the harm, and that is what these tests assert.
//
// The fix: `fail(msg, cause)` — a newline-free message, and the cause handed to
// the `Logger` contract's THIRD argument (`error(message, error?, meta?)`) as
// structured fields. That slot was itself dropped by `ObjectLogger` until this
// change (see packages/core/src/logger.ts), so the end-to-end tests here run a
// REAL logger and read its real bytes rather than trusting a spy.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LiteKernel, ObjectLogger } from '@objectstack/core';
import { FlowSchema } from '@objectstack/spec/automation';
import type {
    Connector,
    ConnectorProviderFactory,
} from '@objectstack/spec/integration';
import { AutomationServicePlugin, type CredentialResolver } from './plugin.js';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => {
    vi.restoreAllMocks();
});

// ── fixtures ───────────────────────────────────────────────────────────────

/** A provider-bound declarative connector entry — the shape registerApp stores. */
function providerConnector(
    name: string,
    opts: { provider?: string; providerConfig?: Record<string, unknown>; auth?: unknown } = {},
) {
    return {
        name,
        label: name,
        type: 'api',
        provider: opts.provider ?? 'fake',
        providerConfig: opts.providerConfig ?? {},
        ...(opts.auth ? { auth: opts.auth } : {}),
    };
}

/** A factory that materializes a trivial one-action connector. */
const okFactory: ConnectorProviderFactory = (ctx) => ({
    def: {
        name: ctx.name,
        label: ctx.label,
        type: 'api',
        authentication: { type: 'none' },
        actions: [{ key: 'ping', label: 'Ping' }],
    } as unknown as Connector,
    handlers: { ping: async () => ({ ok: true }) },
});

/**
 * A genuine `ZodError` carrying an `unrecognized_keys` issue — what a
 * third-party provider factory throws when it validates `providerConfig` with a
 * strict schema.
 *
 * No such factory ships in this repo today (openapi / mcp / rest / slack do no
 * Zod parsing — which is precisely why #5575 is a `finding` and not a bug), so
 * the fixture borrows a strict schema the repo DOES have (`FlowSchema`, closed by
 * #4001) purely as a producer of a real rejection. Real matters: `issues` is
 * duck-typed at the seam exactly because a ZodError may come from a foreign
 * `zod` instance, and a hand-written issue array would not exercise that.
 */
function realZodRejection(): unknown {
    try {
        FlowSchema.parse({
            name: 'probe',
            label: 'probe',
            type: 'autolaunched',
            nodes: [
                {
                    id: 'start',
                    type: 'start',
                    label: 'Start',
                    visibleIf: 'status == "done"', // not a node-level key
                    config: { objectName: 'task', triggerType: 'record-after-update' },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'end' }],
        });
    } catch (err) {
        return err;
    }
    throw new Error('fixture is stale: FlowSchema no longer rejects a node-level `visibleIf`');
}

/**
 * Boot a kernel whose declared connector set can be swapped and re-reconciled by
 * firing `metadata:reloaded` — the ADR-0097 F1 soft path. `logger` is passed
 * straight to the kernel so a test can read the runtime's REAL rendered records.
 */
async function bootReloadable(opts: {
    initial: unknown[];
    factory?: ConnectorProviderFactory;
    credentialResolver?: CredentialResolver;
    logger?: { level: string; format?: string };
}) {
    const state = { declared: opts.initial };
    let captured: any;
    const kernel = new LiteKernel({ logger: opts.logger ?? { level: 'silent' } } as never);
    kernel.use(new AutomationServicePlugin({ credentialResolver: opts.credentialResolver }));
    kernel.use({
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(ctx: any) {
            captured = ctx;
            ctx.registerService('objectql', {
                registry: { listItems: (type: string) => (type === 'connector' ? state.declared : []) },
            });
            if (opts.factory) ctx.getService('automation').registerConnectorProvider('fake', opts.factory);
        },
        async start() {},
    } as never);
    await kernel.bootstrap();
    await flush();
    return {
        kernel,
        engine: kernel.getService('automation') as { getRegisteredConnectors(): string[] },
        reload: async (next: unknown[]) => {
            state.declared = next;
            await captured.trigger('metadata:reloaded');
            await flush();
        },
    };
}

/** Capture everything written to stderr while `fn` runs. */
async function captureStderr(fn: () => Promise<void>): Promise<string[]> {
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(((c: string | Uint8Array) => {
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
 * `ObjectLogger`'s `pretty`/`text` record head, as the CLI's own boot classifier
 * matches it (`packages/cli/src/utils/boot-log-capture.ts`). Re-stated here
 * rather than imported: this package must not depend on the CLI, and the
 * predicate is the general one — every line-based log consumer keys off this
 * head, the CLI's buffer being only the strictest example.
 */
const RECORD_HEAD = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z(?: \|)? (DEBUG|INFO|WARN|ERROR|FATAL)\b/;

const MATERIALIZE_PREFIX = '[Automation] failed to materialize connector instance';
const AUTH_PREFIX = '[Automation] connector instance';

// ── the soft path, end to end through a real logger ─────────────────────────

describe('#5575 — a soft-path connector failure renders as ONE readable record', () => {
    it('a factory ZodError becomes one stderr line whose issues survive', async () => {
        const rejection = realZodRejection();
        // Two passes: boot materializes `billing`, then the reload re-materializes
        // it (changed providerConfig) with a factory that now rejects.
        let failNext = false;
        const factory: ConnectorProviderFactory = (ctx) => {
            if (failNext) throw rejection;
            return okFactory(ctx) as never;
        };
        const { kernel, engine, reload } = await bootReloadable({
            initial: [providerConnector('billing')],
            factory,
            logger: { level: 'error', format: 'pretty' },
        });
        expect(engine.getRegisteredConnectors()).toContain('billing');

        failNext = true;
        const lines = await captureStderr(async () => {
            await reload([providerConnector('billing', { providerConfig: { baseUrl: 'https://new' } })]);
        });

        const mine = lines.filter((l) => l.includes(MATERIALIZE_PREFIX));
        expect(mine, 'the seam reported exactly once').toHaveLength(1);
        // ONE physical line: pre-fix the ZodError dump followed on ~10 more lines,
        // and `lines` here would hold them all.
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(RECORD_HEAD);
        expect(lines[0]).toContain('ERROR');
        // The facts a reader came for, still present and still queryable.
        expect(lines[0]).toContain('unrecognized_keys');
        expect(lines[0]).toContain('visibleIf');
        expect(lines[0]).toContain('nodes[0]');
        // `keys` would have been eaten by ObjectLogger's substring redactor;
        // the field is named `unrecognized` for exactly that reason (#5573).
        expect(lines[0]).not.toContain('REDACTED');
        // And the old connector is still serving — the soft path's other half.
        expect(engine.getRegisteredConnectors()).toContain('billing');

        await kernel.shutdown();
    });

    it('a multi-line host-resolver failure lands in `error`, newlines escaped', async () => {
        // `credentialResolver` is host-supplied: a secrets service can throw
        // anything, including a multi-line SDK error.
        const resolver: CredentialResolver = () => {
            throw new Error('vault: request failed\n  status: 503\n  hint: check the sidecar');
        };
        const { kernel, reload } = await bootReloadable({
            initial: [],
            factory: okFactory,
            credentialResolver: resolver,
            logger: { level: 'error', format: 'json' },
        });

        const lines = await captureStderr(async () => {
            await reload([
                providerConnector('billing', { auth: { type: 'bearer', credentialRef: 'VAULT_TOKEN' } }),
            ]);
        });

        expect(lines, 'one call, one physical line — JSON escapes the newlines').toHaveLength(1);
        const record = JSON.parse(lines[0]) as { msg: string; error?: string; issues?: unknown };
        expect(record.msg.startsWith(AUTH_PREFIX)).toBe(true);
        expect(record.msg).not.toContain('\n');
        expect(record.msg).toContain("'billing'");
        expect(record.issues, 'not a validation rejection').toBeUndefined();
        expect(record.error).toBe('vault: request failed\n  status: 503\n  hint: check the sidecar');

        await kernel.shutdown();
    });

    it('a causeless reconcile problem logs the message alone — no phantom `error`', async () => {
        // The three causeless reports (duplicate name, §4 conflict, unknown
        // provider) must render exactly as before the change: `describeThrownForLog`
        // is only consulted when a cause exists, so no `"error":"undefined"`.
        const { kernel, reload } = await bootReloadable({
            initial: [],
            factory: okFactory,
            logger: { level: 'error', format: 'json' },
        });

        const lines = await captureStderr(async () => {
            await reload([providerConnector('ghost', { provider: 'nonexistent' })]);
        });

        expect(lines).toHaveLength(1);
        const record = JSON.parse(lines[0]) as Record<string, unknown>;
        expect(String(record.msg)).toContain("declares provider 'nonexistent'");
        expect(Object.keys(record).sort()).toEqual(['level', 'msg', 'time']);

        await kernel.shutdown();
    });
});

// ── what the seam hands the logger ─────────────────────────────────────────

describe('#5575 — the cause travels in the contract meta slot, not the message', () => {
    it('calls error(message, undefined, meta) with a newline-free message', async () => {
        const error = vi.spyOn(ObjectLogger.prototype, 'error');
        const rejection = realZodRejection();
        let failNext = false;
        const factory: ConnectorProviderFactory = (ctx) => {
            if (failNext) throw rejection;
            return okFactory(ctx) as never;
        };
        const { kernel, reload } = await bootReloadable({
            initial: [providerConnector('billing')],
            factory,
        });

        failNext = true;
        error.mockClear();
        await reload([providerConnector('billing', { providerConfig: { baseUrl: 'https://new' } })]);

        const call = error.mock.calls.find((c) => String(c[0]).includes(MATERIALIZE_PREFIX));
        expect(call, 'the seam logged at error level').toBeDefined();
        const [message, errorSlot, meta] = call as [string, unknown, Record<string, unknown>];

        expect(message).not.toContain('\n');
        expect(message).toContain("'billing'");
        expect(message).toContain("provider 'fake'");
        expect(message).toContain('ADR-0097');
        // The second slot stays empty on purpose: handing the raw error there
        // ships its stack and the whole multi-line dump on every record.
        expect(errorSlot).toBeUndefined();
        const issues = meta.issues as Array<Record<string, unknown>>;
        expect(Array.isArray(issues)).toBe(true);
        const unrecognized = issues.find((i) => i.code === 'unrecognized_keys');
        expect(unrecognized!.unrecognized).toEqual(['visibleIf']);
        expect(unrecognized!.path).toBe('nodes[0]');
        expect(meta.error, 'a validation rejection reports `issues`, not `error`').toBeUndefined();

        await kernel.shutdown();
    });
});

// ── the fatal path keeps the cause in its message ──────────────────────────

describe('#5575 — boot (fatal) still carries the cause text, not structured meta', () => {
    /** Boot once, non-reloadable: a throw in start() rejects bootstrap(). */
    async function bootFatal(declared: unknown[], opts: {
        factory?: ConnectorProviderFactory;
        credentialResolver?: CredentialResolver;
    }) {
        const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
        kernel.use(new AutomationServicePlugin({ credentialResolver: opts.credentialResolver }));
        kernel.use({
            name: 'test.harness',
            type: 'standard' as const,
            version: '1.0.0',
            dependencies: ['com.objectstack.service-automation'],
            async init(ctx: any) {
                ctx.registerService('objectql', {
                    registry: { listItems: (t: string) => (t === 'connector' ? declared : []) },
                });
                if (opts.factory) ctx.getService('automation').registerConnectorProvider('fake', opts.factory);
            },
            async start() {},
        } as never);
        await kernel.bootstrap();
        await flush();
        return kernel;
    }

    it('appends the factory failure to the thrown message', async () => {
        const factory: ConnectorProviderFactory = () => {
            throw new Error('providerConfig.baseUrl is required');
        };
        await expect(bootFatal([providerConnector('billing')], { factory })).rejects.toThrow(
            /failed to materialize connector instance 'billing' via provider 'fake' \(ADR-0097\)\. cause: providerConfig\.baseUrl is required/,
        );
    });

    it('appends the auth failure, whose own text still names the credentialRef', async () => {
        await expect(
            bootFatal([providerConnector('billing', { auth: { type: 'bearer', credentialRef: 'MISSING' } })], {
                factory: okFactory,
                credentialResolver: () => undefined,
            }),
        ).rejects.toThrow(/auth resolution failed \(ADR-0097 §3\)\. cause: .*credentialRef 'MISSING' did not resolve/s);
    });

    it('keeps a multi-line ZodError dump intact on the fatal path', async () => {
        // Deliberately the OPPOSITE treatment from the soft path: a throw is not
        // a log record — the kernel's failure channel prints it verbatim — so
        // flattening it would lose detail a terminal renders fine.
        const rejection = realZodRejection();
        const factory: ConnectorProviderFactory = () => {
            throw rejection;
        };
        const err = await bootFatal([providerConnector('billing')], { factory }).then(
            () => null,
            (e: Error) => e,
        );
        expect(err, 'boot must fail loudly').not.toBeNull();
        expect(String(err!.message).split('\n').length).toBeGreaterThan(1);
        expect(err!.message).toContain('visibleIf');
    });
});

// ── reverse verification: why the message must not carry the cause ──────────

describe('#5575 — the pre-fix rendering, reproduced to show what it cost', () => {
    it('an interpolated multi-line cause leaves lines that no consumer can attribute', async () => {
        // Direction predicted before running: rendering the OLD shape — the cause
        // interpolated into the message — must produce MORE THAN ONE physical
        // line, of which only the first matches RECORD_HEAD. The fixed shape
        // produces exactly one, which matches. (This is a local reproduction, not
        // a revert of the seam: the seam's own one-line guarantee is asserted
        // end-to-end above.)
        const rejection = realZodRejection();
        const causeText = (rejection as Error).message;
        expect(causeText.split('\n').length, 'fixture must be multi-line').toBeGreaterThan(1);
        expect(causeText.split('\n')[0].trim(), "…and open with Zod's `[`").toBe('[');

        const log = new ObjectLogger({ level: 'error', format: 'pretty' });

        const before = await captureStderr(async () => {
            log.error(
                `[Automation] failed to materialize connector instance 'billing' via provider 'fake': ${causeText} (ADR-0097).`,
            );
        });
        expect(before.length).toBeGreaterThan(1);
        expect(before.filter((l) => RECORD_HEAD.test(l))).toHaveLength(1);
        // The line carrying the level head ends at Zod's opening bracket: every
        // fact is on a line a consumer either drops or mis-reads.
        expect(before[0].trimEnd().endsWith('[')).toBe(true);

        const after = await captureStderr(async () => {
            log.error(
                `[Automation] failed to materialize connector instance 'billing' via provider 'fake' (ADR-0097).`,
                undefined,
                { issues: [{ code: 'unrecognized_keys', path: 'nodes[0]', unrecognized: ['visibleIf'] }] },
            );
        });
        expect(after).toHaveLength(1);
        expect(after[0]).toMatch(RECORD_HEAD);
        expect(after[0]).toContain('visibleIf');
    });
});
