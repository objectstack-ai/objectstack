// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Rule: a credential part the connector metadata read withholds never comes
// back in any other text the platform stores, serves or logs. A provider's
// failure text is rewritten by the read's own redactor where it enters the
// platform (./connector-read-withheld-text.ts), so every reader of it — the
// husk's `degradedReason`, a `connector_action` refusal, the log records, the
// boot's failure, a call's failure, an upstream's refusal words — reads the
// rewritten text. Controls: a text with no URL, and a URL with no credential
// part, come back unchanged.
//
// Every credential below is an obviously-fake placeholder, and every assertion
// on one is its absence from what a reader received.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LiteKernel, ObjectLogger } from '@objectstack/core';
import { getMetadataTypeRedactor } from '@objectstack/spec/kernel';
import { ConnectorUpstreamUnavailableError, type Connector, type ConnectorProviderFactory } from '@objectstack/spec/integration';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';
import { CONNECTOR_TEXT_WITHHELD, connectorReadWithheldText } from './connector-read-withheld-text.js';

const PLACEHOLDERS = {
    password: 'TEST_PLACEHOLDER_URL_PASSWORD',
    query: 'TEST_PLACEHOLDER_URL_QUERY',
    header: 'TEST_PLACEHOLDER_HEADER_VALUE',
    param: 'TEST_PLACEHOLDER_PARAM_KEY',
    resolved: 'TEST_PLACEHOLDER_RESOLVED_VALUE',
} as const;
const ALL = Object.values(PLACEHOLDERS);

/** A stored spec URL carrying both credential parts the read withholds: a userinfo and a credential query pair. */
const CREDENTIAL_URL = `http://svc:${PLACEHOLDERS.password}@127.0.0.1:9/openapi.json?token=${PLACEHOLDERS.query}&v=3`;
/** The same URL as the metadata read serves it. */
const SERVED_URL = 'http://127.0.0.1:9/openapi.json?v=3';
/** A URL with no credential part. */
const PLAIN_URL = 'http://127.0.0.1:9/openapi.json?v=3';

/** Every string a value holds, an `Error`'s message, stack and cause included. */
function textOf(value: unknown): string {
    return JSON.stringify(value ?? null, (_key, v) =>
        v instanceof Error
            ? { name: v.name, message: v.message, stack: v.stack, cause: (v as { cause?: unknown }).cause }
            : v,
    );
}
const holdsAPlaceholder = (value: unknown): boolean => {
    const text = typeof value === 'string' ? value : textOf(value);
    return ALL.some((p) => text.includes(p));
};

function entry(name: string, providerConfig: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return { name, label: name, type: 'api', provider: 'fake', providerConfig, ...extra };
}

/** A factory that fetches `providerConfig.spec` the way the openapi provider does, so the failure text is undici's own. */
function specFetchingFactory(opts: { asUrlObject?: boolean } = {}): ConnectorProviderFactory {
    return async (ctx) => {
        const spec = String(ctx.providerConfig.spec);
        try {
            await fetch(opts.asUrlObject ? new URL(spec) : spec);
        } catch (err) {
            throw new ConnectorUpstreamUnavailableError(
                `fake provider: connector '${ctx.name}' could not reach spec URL '${spec}': ${(err as Error).message}`,
                { cause: err },
            );
        }
        throw new Error(`fake provider: connector '${ctx.name}' expected the spec fetch to fail`);
    };
}

/** A factory that materializes one `request` action answered by `handler`. */
function materializingFactory(handler: (input: Record<string, unknown>) => Promise<Record<string, unknown>>): ConnectorProviderFactory {
    return (ctx) => ({
        def: {
            name: ctx.name,
            label: ctx.label,
            type: 'api',
            authentication: { type: 'none' },
            actions: [{ key: 'request', label: 'Request' }],
        } as unknown as Connector,
        handlers: { request: handler },
    });
}

async function boot(declared: unknown[], factory: ConnectorProviderFactory) {
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
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

/** Every argument every logger method received while `fn` ran. */
async function loggedDuring(fn: () => Promise<void>): Promise<unknown[][]> {
    const spies = (['debug', 'info', 'warn', 'error', 'fatal'] as const).map((level) => vi.spyOn(ObjectLogger.prototype, level));
    try {
        await fn();
        return spies.flatMap((s) => s.mock.calls as unknown[][]);
    } finally {
        for (const s of spies) s.mockRestore();
    }
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('a connector failure text carries no credential part the connector metadata read withholds', () => {
    describe('the rewrite judges by the metadata read itself', () => {
        it('a stored URL in a text becomes the form the metadata read serves', () => {
            const stored = entry('spec_url', { spec: CREDENTIAL_URL });
            const served = getMetadataTypeRedactor('connector')!(stored).item as { providerConfig: { spec: string } };
            expect(served.providerConfig.spec, 'the read itself serves this form').toBe(SERVED_URL);

            const rewrite = connectorReadWithheldText(stored);
            expect(rewrite(`could not reach spec URL '${CREDENTIAL_URL}': refused`)).toBe(
                `could not reach spec URL '${SERVED_URL}': refused`,
            );
        });

        it('a URL a parser re-rendered is judged by the same read', () => {
            const stored = entry('spec_url', {
                spec: `HTTP://svc:${PLACEHOLDERS.password}@Spec.Example.INVALID?token=${PLACEHOLDERS.query}`,
            });
            const href = new URL(String(stored.providerConfig.spec)).href;
            expect(href, 'the parser form is not the stored string').not.toBe(stored.providerConfig.spec);

            const out = connectorReadWithheldText(stored)(`Request cannot be constructed from a URL that includes credentials: ${href}`);
            expect(holdsAPlaceholder(out)).toBe(false);
            expect(out).toBe('Request cannot be constructed from a URL that includes credentials: http://spec.example.invalid/');
        });

        it("a URL carrying the instance's own api-key paramName loses that parameter", () => {
            const stored = entry('param_key', { baseUrl: 'https://api.example.invalid/v1' }, {
                auth: { type: 'api-key', credentialRef: 'PARAM_KEY_REF', paramName: 'k_custom' },
            });
            const out = connectorReadWithheldText(stored)(
                `GET https://api.example.invalid/v1/items?k_custom=${PLACEHOLDERS.param}&page=2 answered 500`,
            );
            expect(out).toBe('GET https://api.example.invalid/v1/items?page=2 answered 500');
        });

        it('a value of a map the read withholds whole is withheld from the text', () => {
            const stored = entry('header_map', {
                baseUrl: 'https://api.example.invalid',
                headers: { Authorization: `Bearer ${PLACEHOLDERS.header}` },
            });
            const out = connectorReadWithheldText(stored)(`upstream rejected header 'Bearer ${PLACEHOLDERS.header}'`);
            expect(out).toBe(`upstream rejected header '${CONNECTOR_TEXT_WITHHELD}'`);
        });

        it('a text with no URL, and a URL with no credential part, come back unchanged', () => {
            const rewrite = connectorReadWithheldText(entry('spec_url', { spec: CREDENTIAL_URL }));
            const noUrl = "fake provider: connector 'spec_url' answered 503 — retry later? maybe@noon";
            expect(rewrite(noUrl)).toBe(noUrl);
            const plain = `could not reach spec URL '${PLAIN_URL}#frag': connect ECONNREFUSED 127.0.0.1:9`;
            expect(rewrite(plain)).toBe(plain);
            expect(connectorReadWithheldText(entry('plain', { spec: PLAIN_URL }))(plain)).toBe(plain);
        });
    });

    describe('every reader of a materialization failure reads the rewritten text', () => {
        it('degradedReason, the connector_action refusal reason and every log record hold no credential part', async () => {
            let engine!: AutomationEngine;
            let kernel!: LiteKernel;
            const logged = await loggedDuring(async () => {
                ({ kernel, engine } = await boot([entry('spec_down', { spec: CREDENTIAL_URL })], specFetchingFactory()));
            });

            const descriptor = engine.getConnectorDescriptors().find((d) => d.name === 'spec_down');
            expect(descriptor?.state).toBe('degraded');
            expect(descriptor?.degradedReason).toContain(`could not reach spec URL '${SERVED_URL}'`);
            expect(holdsAPlaceholder(descriptor)).toBe(false);
            expect(holdsAPlaceholder(engine.getConnectorDegradedReason('spec_down'))).toBe(false);

            const records = logged.filter((args) => textOf(args).includes('spec_down'));
            expect(records.length, 'the degrade was logged').toBeGreaterThan(0);
            expect(holdsAPlaceholder(logged)).toBe(false);
            await kernel.shutdown();
        });

        it('a URL a provider re-rendered before it failed holds no credential part either', async () => {
            const stored = entry('spec_href', { spec: CREDENTIAL_URL.replace('http://', 'HTTP://') });
            const { kernel, engine } = await boot([stored], specFetchingFactory({ asUrlObject: true }));
            const reason = engine.getConnectorDegradedReason('spec_href');
            expect(reason).toContain('Request cannot be constructed from a URL that includes credentials');
            expect(holdsAPlaceholder(reason)).toBe(false);
            await kernel.shutdown();
        });

        it('a URL with no credential part stays in the degraded reason as stored', async () => {
            const { kernel, engine } = await boot([entry('spec_plain', { spec: PLAIN_URL })], specFetchingFactory());
            expect(engine.getConnectorDegradedReason('spec_plain')).toContain(`could not reach spec URL '${PLAIN_URL}'`);
            await kernel.shutdown();
        });

        it("a configuration fault that fails the boot names the instance and holds no credential part", async () => {
            const factory: ConnectorProviderFactory = (ctx) => {
                throw new Error(`fake provider: connector '${ctx.name}' failed to fetch spec '${String(ctx.providerConfig.spec)}' (HTTP 401).`);
            };
            let failure: unknown;
            const logged = await loggedDuring(async () => {
                failure = await boot([entry('spec_fatal', { spec: CREDENTIAL_URL })], factory).then(
                    () => undefined,
                    (err: unknown) => err,
                );
            });
            expect(failure, 'the boot fails on a configuration fault').toBeInstanceOf(Error);
            expect(textOf(failure)).toContain('spec_fatal');
            expect(textOf(failure)).toContain(SERVED_URL);
            expect(holdsAPlaceholder(failure)).toBe(false);
            expect(holdsAPlaceholder(logged)).toBe(false);
        });
    });

    describe("a call's failure reads the rewritten text", () => {
        it('a thrown failure holds no credential part and keeps its code and status', async () => {
            const thrown = Object.assign(
                new Error(`request to ${new URL(CREDENTIAL_URL).href} failed`),
                { code: 'UPSTREAM_FAILED', status: 502 },
            );
            const { kernel, engine } = await boot(
                [entry('call_fails', { baseUrl: CREDENTIAL_URL })],
                materializingFactory(async () => {
                    throw thrown;
                }),
            );
            const handler = engine.resolveConnectorAction('call_fails', 'request');
            expect(handler, 'the instance materialized').toBeTypeOf('function');
            const failure = (await handler!({}, {} as never).then(() => undefined, (err: unknown) => err)) as
                { message?: string; code?: unknown; status?: unknown } | undefined;
            expect(failure?.message).toBe(`request to ${SERVED_URL} failed`);
            expect(failure?.code).toBe('UPSTREAM_FAILED');
            expect(failure?.status).toBe(502);
            expect(holdsAPlaceholder(failure)).toBe(false);
            await kernel.shutdown();
        });

        it('a failure with no credential part is the thrown value itself', async () => {
            const thrown = new Error(`request to ${PLAIN_URL} failed`);
            const { kernel, engine } = await boot(
                [entry('call_plain', { baseUrl: PLAIN_URL })],
                materializingFactory(async () => {
                    throw thrown;
                }),
            );
            const failure = await engine.resolveConnectorAction('call_plain', 'request')!({}, {} as never).then(
                () => undefined,
                (err: unknown) => err,
            );
            expect(failure).toBe(thrown);
            await kernel.shutdown();
        });

        it("an upstream's refusal words are stored without a credential part", async () => {
            const REF = 'CONNECTOR_READ_WITHHELD_TEXT_TEST_REF';
            const previous = process.env[REF];
            process.env[REF] = PLACEHOLDERS.resolved;
            try {
                const { kernel, engine } = await boot(
                    [entry('call_refused', { baseUrl: CREDENTIAL_URL }, { auth: { type: 'bearer', credentialRef: REF } })],
                    materializingFactory(async () => ({
                        status: 401,
                        ok: false,
                        body: { message: `token refused for ${CREDENTIAL_URL}` },
                    })),
                );
                await engine.resolveConnectorAction('call_refused', 'request')!({}, {} as never);
                const reason = engine.getConnectorDegradedReason('call_refused');
                expect(reason, 'the refusal degraded the instance').toContain(SERVED_URL);
                expect(holdsAPlaceholder(reason)).toBe(false);
                await kernel.shutdown();
            } finally {
                if (previous === undefined) delete process.env[REF];
                else process.env[REF] = previous;
            }
        });
    });
});
