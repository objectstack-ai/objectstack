// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A server that lists only the tools a credential may use, against an
 * `include` that names one it hides.
 *
 * Some MCP servers filter `tools/list` by the credential they are sent:
 * GitHub's hides each tool a classic token's scopes do not cover, and its
 * answer says nothing about what it hid. So when `providerConfig.include`
 * names a tool the listing does not carry, the instance cannot tell a
 * credential short of scopes from a declaration naming a tool the server
 * never had. When the handshake carried the instance's credential the
 * refusal takes the credential's path, as a 401 / 403 does: the instance is
 * degraded naming both causes, a stored credential is marked `rejected`, and
 * the boot does not fail. Without a credential it stays the configuration
 * fault it was, fatal at boot.
 *
 * The fake server below answers by the bearer token it was sent; the
 * credential store is the real one, on ObjectQL over SQLite. Values are
 * obvious dummies.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysSecret } from '@objectstack/platform-objects';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import type { CryptoContext, CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';
import type { ConnectorCredentialHandle, ConnectorProviderContext } from '@objectstack/spec/integration';
import { isConnectorCredentialRejected, isConnectorUpstreamUnavailable } from '@objectstack/spec/integration';
import type { McpClientLike, McpToolDescriptor, McpTransport } from './mcp-connector.js';
import { ConnectorMcpPlugin } from './connector-mcp-plugin.js';
import { createMcpProviderFactory } from './mcp-provider.js';

const REF = 'DUMMY_VENDOR_MCP_TOKEN';
/** Its scopes cover only `whoami`. */
const NARROW_TOKEN = 'dummy-narrow-token-aaaa-0001';
/** Its scopes cover every tool. */
const WIDE_TOKEN = 'dummy-wide-token-bbbb-0002';
const URL = 'https://mcp.vendor.example/mcp';
const INCLUDE = ['search_invoices', 'read_invoice'];
const ADMIN = { userId: 'usr_admin_scope' } as never;
const SYSTEM = { isSystem: true } as const;

const TOOLS: McpToolDescriptor[] = [
    { name: 'whoami', description: 'The token owner' },
    { name: 'search_invoices', description: 'Search invoices', inputSchema: { type: 'object' } },
    { name: 'read_invoice', description: 'Read one invoice', inputSchema: { type: 'object' } },
    { name: 'void_invoice', description: 'Void an invoice', inputSchema: { type: 'object' } },
];

/**
 * A fake MCP server that lists only the tools the bearer token it was sent may
 * use — `scopes` maps a token to its tool names. A request with no token, or
 * an unknown one, sees `anonymous` (every tool by default). Records each
 * connection and close.
 */
function scopedServer(scopes: Record<string, string[]>, anonymous: string[] = TOOLS.map((t) => t.name)) {
    const state = { connects: [] as McpTransport[], closed: 0 };
    const tokenOf = (t: McpTransport) =>
        t.kind === 'http' ? t.headers?.Authorization?.replace(/^Bearer /, '') : undefined;
    const clientFactory = async (transport: McpTransport): Promise<McpClientLike> => {
        state.connects.push(transport);
        const token = tokenOf(transport);
        const allowed = (token !== undefined ? scopes[token] : undefined) ?? anonymous;
        return {
            listTools: async () => TOOLS.filter((t) => allowed.includes(t.name)),
            callTool: async (name) => ({ content: [{ type: 'text', text: `${name} answered` }] }),
            close: async () => { state.closed += 1; },
        };
    };
    return { clientFactory, state, scopes };
}

function ctx(partial: Partial<ConnectorProviderContext>): ConnectorProviderContext {
    return {
        name: 'vendor_mcp',
        label: 'Vendor',
        type: 'api',
        providerConfig: { transport: { kind: 'http', url: URL }, include: INCLUDE },
        ...partial,
    };
}

async function thrownBy(run: () => unknown): Promise<unknown> {
    return Promise.resolve()
        .then(run)
        .then(
            () => { throw new Error('expected a refusal'); },
            (e: unknown) => e,
        );
}

describe('mcp provider: an include the server does not list for the credential it was sent', () => {
    it('is a credential refusal (403) naming both causes, the missing tools and the listed ones, and closes the client', async () => {
        const server = scopedServer({ [NARROW_TOKEN]: ['whoami'] });
        const factory = createMcpProviderFactory({ clientFactory: server.clientFactory });
        const err = await thrownBy(() => factory(ctx({ auth: { type: 'bearer', token: NARROW_TOKEN } })));

        expect(err).toBeInstanceOf(Error);
        expect(isConnectorCredentialRejected(err)).toBe(true);
        expect(isConnectorUpstreamUnavailable(err)).toBe(false);
        expect((err as { status?: unknown }).status).toBe(403);
        const message = (err as Error).message;
        expect(message).toMatch(
            /^connector-mcp provider: connector 'vendor_mcp' providerConfig\.include names 'search_invoices', 'read_invoice', which the MCP server does not list for the credential this instance sent\./,
        );
        // Both causes, and what to fix for each.
        expect(message).toContain('the credential lacks the scopes or permissions these tools need — fix the credential');
        expect(message).toContain('the declaration names a tool this server does not have — fix providerConfig.include');
        expect(message).toContain("For this credential, the server lists 1 tool(s): 'whoami'.");
        expect(message.includes(NARROW_TOKEN)).toBe(false);
        expect(server.state.connects).toHaveLength(1);
        expect(server.state.closed).toBe(1);
    });

    it.each([
        ['an http instance with no auth', {}],
        ['an http instance whose api-key rides a query parameter (never sent on the transport)', {
            auth: { type: 'api-key', key: NARROW_TOKEN, headerName: 'X-API-Key', paramName: 'key' } as const,
        }],
    ])('control: %s keeps the plain configuration fault', async (_shape, partial) => {
        const server = scopedServer({});
        const factory = createMcpProviderFactory({ clientFactory: server.clientFactory });
        const err = await thrownBy(() =>
            factory(ctx({ ...partial, providerConfig: { transport: { kind: 'http', url: URL }, include: ['nope'] } })),
        );
        expect(err).toBeInstanceOf(Error);
        expect(isConnectorCredentialRejected(err)).toBe(false);
        expect(isConnectorUpstreamUnavailable(err)).toBe(false);
        expect((err as Error).message).toMatch(
            /^connector-mcp provider: connector 'vendor_mcp' providerConfig\.include names 'nope', which the MCP server does not list\. Each entry must be the name of a tool from the server's tools\/list; the server lists 4 tool\(s\)/,
        );
        expect(server.state.closed).toBe(1);
    });

    it('control: a credential written into transport.headers is part of the declaration — the plain fault, even when it filtered the list', async () => {
        const server = scopedServer({ [NARROW_TOKEN]: ['whoami'] });
        const factory = createMcpProviderFactory({ clientFactory: server.clientFactory });
        const err = await thrownBy(() =>
            factory(ctx({
                providerConfig: {
                    transport: { kind: 'http', url: URL, headers: { Authorization: `Bearer ${NARROW_TOKEN}` } },
                    include: INCLUDE,
                },
            })),
        );
        expect(isConnectorCredentialRejected(err)).toBe(false);
        expect(isConnectorUpstreamUnavailable(err)).toBe(false);
        expect((err as Error).message).toContain(
            "providerConfig.include names 'search_invoices', 'read_invoice', which the MCP server does not list. Each entry",
        );
        expect((err as Error).message).toContain("the server lists 1 tool(s): 'whoami'.");
    });

    it('control: a stdio instance with resolved auth keeps the plain fault — auth is not sent to a stdio server', async () => {
        const server = scopedServer({});
        const factory = createMcpProviderFactory({ clientFactory: server.clientFactory, declarativeStdio: true });
        const err = await thrownBy(() =>
            factory(ctx({
                auth: { type: 'bearer', token: NARROW_TOKEN },
                providerConfig: { transport: { kind: 'stdio', command: 'vendor-mcp' }, include: ['nope'] },
            })),
        );
        expect(isConnectorCredentialRejected(err)).toBe(false);
        expect((err as Error).message).toContain("providerConfig.include names 'nope', which the MCP server does not list.");
    });

    it('an oauth2 instance (a credential handle) keeps the plain fault: its token is borrowed per request, not the instance auth', async () => {
        // The listing is answered for the borrowed token, but the credential
        // path's hold and mark are keyed to the instance's credentialRef row
        // (an oauth2 instance's client secret), so the provider does not
        // route this case there. See the comment on `credentialSent`.
        const server = scopedServer({}, ['whoami']);
        const handle: ConnectorCredentialHandle = {
            connector: 'vendor_mcp',
            async get() { return { auth: { type: 'bearer', token: NARROW_TOKEN } }; },
            async refresh() { return { auth: { type: 'bearer', token: NARROW_TOKEN } }; },
        };
        const factory = createMcpProviderFactory({ clientFactory: server.clientFactory });
        const err = await thrownBy(() => factory(ctx({ credentialHandle: handle })));
        expect(isConnectorCredentialRejected(err)).toBe(false);
        expect(isConnectorUpstreamUnavailable(err)).toBe(false);
        expect((err as Error).message).toMatch(
            /^connector-mcp provider: connector 'vendor_mcp' providerConfig\.include names 'search_invoices', 'read_invoice', which the MCP server does not list\. Each entry/,
        );
        // The discovery session was opened through the borrowing fetch, with no static header.
        const [discovery] = server.state.connects;
        expect(discovery.kind === 'http' && typeof discovery.fetch).toBe('function');
        expect(discovery.kind === 'http' && discovery.headers?.Authorization).toBeFalsy();
        expect(server.state.closed).toBe(1);
    });

    it('control: a credential whose listing carries every entry materializes exactly those tools, proven', async () => {
        const server = scopedServer({ [WIDE_TOKEN]: TOOLS.map((t) => t.name) });
        const mat = await createMcpProviderFactory({ clientFactory: server.clientFactory })(
            ctx({ auth: { type: 'bearer', token: WIDE_TOKEN } }),
        );
        expect(Object.keys(mat.handlers).sort()).toEqual(['read_invoice', 'search_invoices']);
        expect(mat.credentialVerified).toBe(true);
        expect(server.state.closed).toBe(0);
    });
});

// ── Through the materializer: the boot, the credential door, the listing ────

/** Reversible stand-in cipher — the store's seam is the engine's, not the cipher's. */
function fakeCrypto(): ICryptoProvider {
    let n = 0;
    return {
        async encrypt(plain: string, _ctx: CryptoContext): Promise<CryptoHandle> {
            n += 1;
            return { id: `sec_${n}`, kmsKeyId: 'test', alg: 'test-rev', version: 1, ciphertext: [...plain].reverse().join('') };
        },
        async decrypt(handle: CryptoHandle): Promise<string> {
            return [...handle.ciphertext].reverse().join('');
        },
        async rotateKey(handle: CryptoHandle): Promise<CryptoHandle> {
            return { ...handle, version: handle.version + 1 };
        },
        digest: (plain: string) => `d:${plain.length}`,
        keyedDigest: async (plain: string) => `k:${plain.length}`,
    };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const kernels: LiteKernel[] = [];
const engines: ObjectQL[] = [];
const envKeys: string[] = [];
afterEach(async () => {
    for (const k of kernels.splice(0)) await k.shutdown().catch(() => {});
    for (const e of engines.splice(0)) {
        try { await (e as unknown as { destroy?: () => Promise<void> }).destroy?.(); } catch { /* noop */ }
    }
    for (const key of envKeys.splice(0)) delete process.env[key];
    vi.restoreAllMocks();
});

/** Everything the process prints while a test runs: the kernel logger (JSON) and any console call. */
function captureOutput(): { text: () => string } {
    const chunks: string[] = [];
    const keep = ((c: string | Uint8Array) => { chunks.push(String(c)); return true; }) as never;
    vi.spyOn(process.stdout, 'write').mockImplementation(keep);
    vi.spyOn(process.stderr, 'write').mockImplementation(keep);
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { chunks.push(args.map(String).join(' ')); });
    }
    return { text: () => chunks.join('\n') };
}

function declared(withAuth = true) {
    return {
        name: 'vendor_mcp',
        label: 'Vendor MCP',
        type: 'api',
        provider: 'mcp',
        providerConfig: { transport: { kind: 'http', url: URL }, include: INCLUDE },
        ...(withAuth ? { auth: { type: 'bearer', credentialRef: REF } } : {}),
        _packageId: 'com.example.vendor',
    };
}

/**
 * The automation service, the real `mcp` provider over `server`, and the real
 * credential store on ObjectQL over in-memory SQLite. The harness stands in
 * for the ObjectQL plugin (hence its name, which the automation plugin orders
 * itself after): it serves the declared entries, the data engine, and a
 * `manifest` service that registers the objects the automation plugin
 * contributes — the credential store's among them.
 */
async function boot(entries: unknown[], server: ReturnType<typeof scopedServer>) {
    const ql = new ObjectQL();
    engines.push(ql);
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.connect();
    ql.registerDriver(driver, true);
    await ql.init();
    const registry = (ql as unknown as { registry: { registerObject(o: unknown, pkg: string): void } }).registry;
    registry.registerObject(SysSecret, 'test');
    ql.setCryptoProvider(fakeCrypto());

    const kernel = new LiteKernel({ logger: { level: 'debug', format: 'json' } } as never);
    kernels.push(kernel);
    let captured: { trigger(event: string): Promise<void> } | undefined;
    kernel.use({
        name: 'com.objectstack.engine.objectql',
        type: 'standard',
        version: '1.0.0',
        async init(c: { registerService(name: string, service: unknown): void }) {
            captured = c as never;
            c.registerService('objectql', { registry: { listItems: (t: string) => (t === 'connector' ? entries : []) } });
            c.registerService('data', ql);
            c.registerService('manifest', {
                register(m: { objects?: unknown[] }) {
                    for (const o of m.objects ?? []) registry.registerObject(o, 'test');
                },
            });
        },
        // Every plugin has inited — the automation plugin's objects are registered.
        async start() { await ql.syncSchemas(); },
    } as never);
    kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory', credentialResolver: () => undefined }));
    kernel.use(new ConnectorMcpPlugin({ clientFactory: server.clientFactory }));
    await kernel.bootstrap();
    await flush();
    const engine = kernel.getService('automation') as AutomationEngine;
    const descriptor = () => engine.getConnectorDescriptors().find((d) => d.name === 'vendor_mcp');
    /** A soft reconcile with nothing changed — the `metadata:reloaded` path. */
    const reload = async () => {
        await captured!.trigger('metadata:reloaded');
        await flush();
    };
    return { engine, ql, kernel, descriptor, reload };
}

describe('the materializer: a credential whose scopes hide an included tool degrades the instance, never the boot', () => {
    it('environment credential: the boot does not fail; degraded, listed `rejected`; recovers once the scopes cover the tools', async () => {
        process.env[REF] = NARROW_TOKEN;
        envKeys.push(REF);
        const out = captureOutput();
        const server = scopedServer({ [NARROW_TOKEN]: ['whoami'] });
        const { engine, descriptor, reload } = await boot([declared()], server);

        expect(descriptor()).toMatchObject({ state: 'degraded', actions: [] });
        const reason = engine.getConnectorDegradedReason('vendor_mcp');
        expect(reason).toContain(
            "providerConfig.include names 'search_invoices', 'read_invoice', which the MCP server does not list for the credential this instance sent.",
        );
        // A value the door does not hold is retried on the backoff, not held.
        expect(engine.getConnectorDegradedHold('vendor_mcp')).toBeUndefined();
        const [listed] = await engine.listConnectorCredentialRefs();
        expect(listed).toMatchObject({ ref: REF, status: 'rejected', source: 'env' });
        expect(engine.resolveConnectorAction('vendor_mcp', 'search_invoices')).toBeUndefined();

        // The administrator widens the token's scopes where it was issued;
        // the value is unchanged. The next attempt (a reconcile here, the
        // backoff timer in a running server) lists the tools.
        server.scopes[NARROW_TOKEN] = TOOLS.map((t) => t.name);
        await reload();
        expect(descriptor()).toMatchObject({ state: 'ready' });
        expect(descriptor()!.actions.map((a) => a.key).sort()).toEqual(['read_invoice', 'search_invoices']);
        expect((await engine.listConnectorCredentialRefs())[0]).toMatchObject({ status: 'set', source: 'env' });

        expect(out.text().includes(NARROW_TOKEN)).toBe(false);
        expect(out.text()).not.toContain('Fix its declaration');
    });

    it('stored credential: degraded with the credential reason and the row `rejected`; held; a better-scoped value recovers it, no restart', async () => {
        const out = captureOutput();
        const server = scopedServer({ [NARROW_TOKEN]: ['whoami'], [WIDE_TOKEN]: TOOLS.map((t) => t.name) });
        const { engine, ql, descriptor, reload } = await boot([declared()], server);
        // Nothing set yet: degraded naming the reference, nothing dialled.
        expect(engine.getConnectorDegradedReason('vendor_mcp')).toContain(`credential '${REF}'`);
        expect(server.state.connects).toHaveLength(0);

        const entry = await engine.setConnectorCredential({ ref: REF, value: NARROW_TOKEN, context: ADMIN });
        const reason = engine.getConnectorDegradedReason('vendor_mcp');
        expect(reason).toContain(
            "providerConfig.include names 'search_invoices', 'read_invoice', which the MCP server does not list for the credential this instance sent.",
        );
        expect(reason).toContain('fix the credential, then set it again');
        expect(entry).toMatchObject({ ref: REF, status: 'rejected', source: 'object', statusReason: reason });
        expect(entry.connectors[0]).toMatchObject({ name: 'vendor_mcp', state: 'degraded', degradedReason: reason });
        // Held on the stored value: setting it again is what re-attempts it.
        expect(engine.getConnectorDegradedHold('vendor_mcp')).toEqual({ kind: 'credential', ref: REF });
        const dialled = server.state.connects.length;
        await reload();
        expect(server.state.connects).toHaveLength(dialled);
        // The row itself, as the engine reads it.
        const rows = (await ql.find('sys_connector_credential', { context: SYSTEM } as never)) as Array<Record<string, unknown>>;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ ref: REF, status: 'rejected', status_reason: reason });

        // A value whose scopes cover the tools: ready, those tools only, the row back to `set`.
        const recovered = await engine.setConnectorCredential({ ref: REF, value: WIDE_TOKEN, context: ADMIN });
        expect(descriptor()).toMatchObject({ state: 'ready' });
        expect(descriptor()!.actions.map((a) => a.key).sort()).toEqual(['read_invoice', 'search_invoices']);
        expect(recovered).toMatchObject({ status: 'set', source: 'object' });
        expect(recovered.lastVerifiedAt).toEqual(expect.any(String));

        const text = out.text();
        expect(text.includes(NARROW_TOKEN) || text.includes(WIDE_TOKEN)).toBe(false);
        expect(text).not.toContain('Fix its declaration');
    });

    it('control: an instance with no credential and an include the server does not list still fails the boot', async () => {
        captureOutput();
        const server = scopedServer({}, ['whoami']);
        const kernelBoot = await Promise.resolve(boot([declared(false)], server)).then(() => undefined, (e: unknown) => e);
        expect(kernelBoot).toBeInstanceOf(Error);
        const message = (kernelBoot as Error).message;
        expect(message).toContain("failed to materialize connector instance 'vendor_mcp' via provider 'mcp'");
        expect(message).toContain("providerConfig.include names 'search_invoices', 'read_invoice', which the MCP server does not list.");
        expect(message).not.toContain('for the credential this instance sent');
    });
});
