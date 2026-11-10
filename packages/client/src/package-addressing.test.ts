// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, epic #31527 child G3] The SDK's by-name calls take an optional
 * namespace: `automation.*`, `actions.invoke` / `invokeGlobal` and
 * `meta.getItem`, on the unscoped client and on the scoped twins.
 *
 * Four things are pinned, each in its own block:
 *
 *  1. **Without a namespace every call is byte-for-byte what it was.** The
 *     bare URLs below are literals, measured on the base commit before the
 *     namespace existed (the PR body carries that run).
 *  2. **With one, the call builds the qualified path of D5's grammar**, and
 *     each such path is one a server ledger declares.
 *  3. **A (namespace, name) pair the router cannot read as an address is
 *     refused before any request** (`400 VALIDATION_ERROR`, zero requests), and
 *     the two sub-resource sets the refusal reads are held equal to the
 *     server's own.
 *  4. **Against the real doors, a `409` surfaces with its candidates** and a
 *     qualified call reaches its holder. Only the socket is stubbed: `fetch`
 *     hands the request to the real `HttpDispatcher` in-process and returns
 *     the producer's own body.
 *
 * ⚠️ `@objectstack/runtime`, `@objectstack/objectql` and `@objectstack/spec`
 * resolve through their BUILT `dist/` here (`KNOWN_UNALIASED_TEST_IMPORTS` in
 * `scripts/check-test-source-alias.mjs`); rebuild them before trusting a run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpDispatcher } from '@objectstack/runtime';
import { SchemaRegistry, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { META_ITEM_SUBRESOURCE_SEGMENTS as SERVER_META_ITEM_SUBRESOURCE_SEGMENTS, ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ROUTE_LEDGER } from '../../runtime/src/route-ledger';
import { REST_ROUTE_LEDGER } from '../../rest/src/rest-route-ledger';
import { ObjectStackClient } from './index';
import { AUTOMATION_FLOW_SUBRESOURCE_SEGMENTS, META_ITEM_SUBRESOURCE_SEGMENTS } from './package-address';

const BASE = 'http://localhost:9';
const CRM = 'com.acme.crm';
const HR = 'com.acme.hr';

// ---------------------------------------------------------------------------
// A recording client: every request it would send, and a permissive answer.
// ---------------------------------------------------------------------------

interface Sent { method: string; url: string; body?: unknown }

function recordingClient() {
    const sent: Sent[] = [];
    const client = new ObjectStackClient({
        baseUrl: BASE,
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
            sent.push({
                method: (init?.method ?? 'GET').toUpperCase(),
                url: String(input),
                ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
            });
            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({ success: true, data: {} }),
                text: async () => '{}',
            } as unknown as Response;
        }) as typeof fetch,
    });
    return { client, sent, scoped: client.environment('env_1') };
}

type Client = ReturnType<typeof recordingClient>;
type Address = { namespace?: string } | undefined;

/**
 * Every by-name method, driven with an optional address. `bare` is the URL the
 * base commit sent (measured there, see the header); `qualified` the one the
 * same call sends under the namespace `crm`.
 */
const CALLS: Array<{
    name: string;
    method: string;
    call: (c: Client, address: Address) => Promise<unknown>;
    bare: string;
    qualified: string;
}> = [
    { name: 'automation.trigger', method: 'POST', call: (c, a) => c.client.automation.trigger('flow_a', {}, a),
        bare: '/api/v1/automation/trigger/flow_a', qualified: '/api/v1/automation/trigger/crm/flow_a' },
    { name: 'automation.get', method: 'GET', call: (c, a) => c.client.automation.get('flow_a', a),
        bare: '/api/v1/automation/flow_a', qualified: '/api/v1/automation/crm/flow_a' },
    { name: 'automation.update', method: 'PUT', call: (c, a) => c.client.automation.update('flow_a', {}, a),
        bare: '/api/v1/automation/flow_a', qualified: '/api/v1/automation/crm/flow_a' },
    { name: 'automation.delete', method: 'DELETE', call: (c, a) => c.client.automation.delete('flow_a', a),
        bare: '/api/v1/automation/flow_a', qualified: '/api/v1/automation/crm/flow_a' },
    { name: 'automation.toggle', method: 'POST', call: (c, a) => c.client.automation.toggle('flow_a', true, a),
        bare: '/api/v1/automation/flow_a/toggle', qualified: '/api/v1/automation/crm/flow_a/toggle' },
    { name: 'automation.clone', method: 'POST', call: (c, a) => c.client.automation.clone('flow_a', { name: 'flow_b' } as never, a),
        bare: '/api/v1/automation/flow_a/clone', qualified: '/api/v1/automation/crm/flow_a/clone' },
    { name: 'automation.runs.list', method: 'GET', call: (c, a) => c.client.automation.runs.list('flow_a', { limit: 5, ...a }),
        bare: '/api/v1/automation/flow_a/runs?limit=5', qualified: '/api/v1/automation/crm/flow_a/runs?limit=5' },
    { name: 'automation.runs.get', method: 'GET', call: (c, a) => c.client.automation.runs.get('flow_a', 'run_1', a),
        bare: '/api/v1/automation/flow_a/runs/run_1', qualified: '/api/v1/automation/crm/flow_a/runs/run_1' },
    { name: 'automation.getFlow', method: 'GET', call: (c, a) => c.client.automation.getFlow('flow_a', a),
        bare: '/api/v1/automation/flow_a', qualified: '/api/v1/automation/crm/flow_a' },
    { name: 'automation.execute', method: 'POST', call: (c, a) => c.client.automation.execute('flow_a', { params: {} }, a),
        bare: '/api/v1/automation/flow_a/trigger', qualified: '/api/v1/automation/crm/flow_a/trigger' },
    { name: 'automation.listRuns', method: 'GET', call: (c, a) => c.client.automation.listRuns('flow_a', { limit: 5, status: 'failed', ...a }),
        bare: '/api/v1/automation/flow_a/runs?limit=5&status=failed', qualified: '/api/v1/automation/crm/flow_a/runs?limit=5&status=failed' },
    { name: 'automation.getRun', method: 'GET', call: (c, a) => c.client.automation.getRun('flow_a', 'run_1', a),
        bare: '/api/v1/automation/flow_a/runs/run_1', qualified: '/api/v1/automation/crm/flow_a/runs/run_1' },
    { name: 'automation.resume', method: 'POST', call: (c, a) => c.client.automation.resume('flow_a', 'run_1', { inputs: {} }, a),
        bare: '/api/v1/automation/flow_a/runs/run_1/resume', qualified: '/api/v1/automation/crm/flow_a/runs/run_1/resume' },
    { name: 'automation.getScreen', method: 'GET', call: (c, a) => c.client.automation.getScreen('flow_a', 'run_1', a),
        bare: '/api/v1/automation/flow_a/runs/run_1/screen', qualified: '/api/v1/automation/crm/flow_a/runs/run_1/screen' },
    { name: 'actions.invoke', method: 'POST', call: (c, a) => c.client.actions.invoke('crm_lead', 'convert', { recordId: 'r1', ...a }),
        bare: '/api/v1/actions/crm_lead/convert', qualified: '/api/v1/actions/crm/crm_lead/convert' },
    { name: 'actions.invokeGlobal', method: 'POST', call: (c, a) => c.client.actions.invokeGlobal('ping', { ...a }),
        bare: '/api/v1/actions/global/ping', qualified: '/api/v1/actions/crm/global/ping' },
    { name: 'meta.getItem', method: 'GET', call: (c, a) => c.client.meta.getItem('page', 'home', { ...a }),
        bare: '/api/v1/meta/page/home', qualified: '/api/v1/meta/page/crm/home' },
    { name: 'scoped meta.getItem', method: 'GET', call: (c, a) => c.scoped.meta.getItem('page', 'home', { ...a }),
        bare: '/api/v1/environments/env_1/meta/page/home', qualified: '/api/v1/environments/env_1/meta/page/crm/home' },
    { name: 'scoped automation.getFlow', method: 'GET', call: (c, a) => c.scoped.automation.getFlow('flow_a', a),
        bare: '/api/v1/environments/env_1/automation/flow_a', qualified: '/api/v1/environments/env_1/automation/crm/flow_a' },
    { name: 'scoped automation.execute', method: 'POST', call: (c, a) => c.scoped.automation.execute('flow_a', {}, a),
        bare: '/api/v1/environments/env_1/automation/flow_a/trigger', qualified: '/api/v1/environments/env_1/automation/crm/flow_a/trigger' },
    { name: 'scoped automation.listRuns', method: 'GET', call: (c, a) => c.scoped.automation.listRuns('flow_a', { limit: 5, ...a }),
        bare: '/api/v1/environments/env_1/automation/flow_a/runs?limit=5', qualified: '/api/v1/environments/env_1/automation/crm/flow_a/runs?limit=5' },
    { name: 'scoped automation.getRun', method: 'GET', call: (c, a) => c.scoped.automation.getRun('flow_a', 'run_1', a),
        bare: '/api/v1/environments/env_1/automation/flow_a/runs/run_1', qualified: '/api/v1/environments/env_1/automation/crm/flow_a/runs/run_1' },
    { name: 'scoped automation.resume', method: 'POST', call: (c, a) => c.scoped.automation.resume('flow_a', 'run_1', {}, a),
        bare: '/api/v1/environments/env_1/automation/flow_a/runs/run_1/resume', qualified: '/api/v1/environments/env_1/automation/crm/flow_a/runs/run_1/resume' },
    { name: 'scoped automation.getScreen', method: 'GET', call: (c, a) => c.scoped.automation.getScreen('flow_a', 'run_1', a),
        bare: '/api/v1/environments/env_1/automation/flow_a/runs/run_1/screen', qualified: '/api/v1/environments/env_1/automation/crm/flow_a/runs/run_1/screen' },
];

async function sentBy(call: (c: Client) => Promise<unknown>): Promise<Sent[]> {
    const c = recordingClient();
    await call(c);
    return c.sent;
}

describe('1. without a namespace, every by-name call sends what it sent before', () => {
    for (const row of CALLS) {
        it(row.name, async () => {
            const omitted = await sentBy((c) => row.call(c, undefined));
            expect(omitted.map((s) => `${s.method} ${s.url}`)).toEqual([`${row.method} ${BASE}${row.bare}`]);
            // An explicitly absent namespace is the same call.
            expect(await sentBy((c) => row.call(c, { namespace: undefined }))).toEqual(omitted);
        });
    }

    it('`packageId` alone keeps reading `?package=` on the bare path', async () => {
        const sent = await sentBy((c) => c.client.meta.getItem('page', 'home', { packageId: CRM }));
        expect(sent.map((s) => s.url)).toEqual([`${BASE}/api/v1/meta/page/home?package=${CRM}`]);
    });
});

// [#32310, ADR-0150 D3] The caller arm: the reader's package, from which the
// server resolves the name (its own item, else the unique holder in its
// declared closure plus `sys`). The client builds the parameter and nothing
// else; the door judges it (`400` beside `?package=` or a namespace, or on a
// type other than `dataset`).
describe('1b. `callerPackage` builds `?callerPackage=` on the bare path (ADR-0150 D3)', () => {
    it('meta.getItem, unscoped and scoped', async () => {
        expect((await sentBy((c) => c.client.meta.getItem('dataset', 'pipeline', { callerPackage: CRM }))).map((s) => s.url))
            .toEqual([`${BASE}/api/v1/meta/dataset/pipeline?callerPackage=${CRM}`]);
        expect((await sentBy((c) => c.scoped.meta.getItem('dataset', 'pipeline', { callerPackage: CRM }))).map((s) => s.url))
            .toEqual([`${BASE}/api/v1/environments/env_1/meta/dataset/pipeline?callerPackage=${CRM}`]);
    });

    it('analytics.queryDataset sends it on the query door, the body unchanged', async () => {
        const payload = { datasetName: 'pipeline', selection: { measures: ['revenue'] } };
        const sent = await sentBy((c) => c.client.analytics.queryDataset(payload, { callerPackage: CRM }));
        expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([`POST ${BASE}/api/v1/analytics/dataset/query?callerPackage=${CRM}`]);
    });

    it('CONTROL: omitted, both calls send what they sent before', async () => {
        expect((await sentBy((c) => c.client.meta.getItem('dataset', 'pipeline'))).map((s) => s.url))
            .toEqual([`${BASE}/api/v1/meta/dataset/pipeline`]);
        const sent = await sentBy((c) => c.client.analytics.queryDataset({ datasetName: 'pipeline', selection: { measures: ['revenue'] } }));
        expect(sent.map((s) => s.url)).toEqual([`${BASE}/api/v1/analytics/dataset/query`]);
    });
});

// ---------------------------------------------------------------------------
// 2. The qualified path
// ---------------------------------------------------------------------------

/** The ledger rows (dispatcher and REST), as matchers over `VERB /api/v1/…`. */
const LEDGER_PATTERNS = [
    ...ROUTE_LEDGER.map((r) => ({ route: r.route, prefix: '/api/v1' })),
    ...REST_ROUTE_LEDGER.map((r) => ({ route: r.route, prefix: '' })),
].map(({ route, prefix }) => {
    const verb = route.slice(0, route.indexOf(' '));
    const path = (prefix + route.slice(route.indexOf(' ') + 1)).split('?')[0];
    const source = path.split('/').map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/');
    return { route, verb, re: new RegExp(`^${source}$`), scoped: new RegExp(`^${source.replace('^/api/v1', '/api/v1/environments/[^/]+')}$`.replace('^/api/v1', '^/api/v1/environments/[^/]+')) };
});

function ledgerRowFor(method: string, url: string): string | undefined {
    const path = new URL(url).pathname;
    const scopedPath = path.replace(/^\/api\/v1\/environments\/[^/]+/, '/api/v1');
    return LEDGER_PATTERNS.find((p) => p.verb === method && p.route.includes(':ns') && p.re.test(scopedPath))?.route;
}

describe('2. with a namespace, each call builds the qualified path a server ledger declares', () => {
    for (const row of CALLS) {
        it(row.name, async () => {
            const sent = await sentBy((c) => row.call(c, { namespace: 'crm' }));
            expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([`${row.method} ${BASE}${row.qualified}`]);
            expect(ledgerRowFor(row.method, sent[0].url), `no ':ns' ledger row serves ${row.method} ${row.qualified}`).toBeDefined();
        });
    }

    it('`_env` names the environment\'s own item on every door', async () => {
        const env = { namespace: '_env' };
        const sent = [
            ...(await sentBy((c) => c.client.automation.execute('flow_a', {}, env))),
            ...(await sentBy((c) => c.client.automation.trigger('flow_a', {}, env))),
            ...(await sentBy((c) => c.client.actions.invoke('crm_lead', 'convert', env))),
            ...(await sentBy((c) => c.client.meta.getItem('page', 'home', env))),
        ];
        expect(sent.map((s) => new URL(s.url).pathname)).toEqual([
            '/api/v1/automation/_env/flow_a/trigger',
            '/api/v1/automation/trigger/_env/flow_a',
            '/api/v1/actions/_env/crm_lead/convert',
            '/api/v1/meta/page/_env/home',
        ]);
    });

    it('a flow named like a sub-resource is still addressed under `_env`, where the door reads it as a name', async () => {
        const sent = await sentBy((c) => c.client.automation.getFlow('runs', { namespace: '_env' }));
        expect(sent.map((s) => new URL(s.url).pathname)).toEqual(['/api/v1/automation/_env/runs']);
    });

    it('the action body still carries the record id and params, unchanged by the address', async () => {
        const sent = await sentBy((c) => c.client.actions.invoke('crm_lead', 'convert', { recordId: 'r1', params: { a: 1 }, namespace: 'crm' }));
        expect(sent[0].body).toEqual({ recordId: 'r1', params: { a: 1 } });
    });
});

// ---------------------------------------------------------------------------
// 3. The pairs that have no qualified path
// ---------------------------------------------------------------------------

async function refusalOf(p: Promise<unknown>): Promise<any> {
    return p.then(() => { throw new Error('expected a refusal'); }, (e) => e);
}

describe('3. a (namespace, name) pair the router cannot read as an address is refused before any request', () => {
    const throwing: Array<[string, (c: Client) => Promise<unknown>]> = [
        ['a malformed namespace (upper case)', (c) => c.client.automation.execute('flow_a', {}, { namespace: 'Crm' })],
        ['a malformed namespace (one character)', (c) => c.client.meta.getItem('page', 'home', { namespace: 'c' })],
        ['a malformed namespace (empty)', (c) => c.client.automation.getFlow('flow_a', { namespace: '' })],
        ['a malformed namespace (longer than 20)', (c) => c.client.meta.getItem('page', 'home', { namespace: 'crm_lead_conversion_x' })],
        ['a namespace spelling an /automation literal', (c) => c.client.automation.execute('flow_a', {}, { namespace: 'trigger' })],
        ['a namespace spelling another /automation literal', (c) => c.client.automation.getFlow('flow_a', { namespace: 'hooks' })],
        ['a flow named like a sub-resource, under a namespace', (c) => c.client.automation.getFlow('runs', { namespace: 'crm' })],
        ['a flow named like a sub-resource, on the run list', (c) => c.client.automation.listRuns('toggle', { namespace: 'crm' })],
        ['a flow named like a door literal, under `_env`', (c) => c.client.automation.execute('hooks', {}, { namespace: '_env' })],
        ['an item named like a /meta sub-resource', (c) => c.client.meta.getItem('app', 'history', { namespace: 'crm' })],
        ['an item named like a /meta sub-resource, under `_env`', (c) => c.client.meta.getItem('page', 'tree', { namespace: '_env' })],
        ['the scoped twin, a flow named like a sub-resource', (c) => c.scoped.automation.getRun('clone', 'run_1', { namespace: 'crm' })],
        ['the scoped twin, an item named like a /meta sub-resource', (c) => c.scoped.meta.getItem('app', 'audit', { namespace: 'crm' })],
    ];
    for (const [label, call] of throwing) {
        it(label, async () => {
            const c = recordingClient();
            const err = await refusalOf(call(c));
            expect([err.code, err.httpStatus]).toEqual(['VALIDATION_ERROR', 400]);
            expect(c.sent).toEqual([]);
        });
    }

    it('`actions.invoke` never throws: `global` as a namespace is `success: false`, and nothing is sent', async () => {
        const c = recordingClient();
        const result = await c.client.actions.invoke('crm_lead', 'convert', { namespace: 'global' });
        expect(result.success).toBe(false);
        expect(result.candidates).toBeUndefined();
        expect(c.sent).toEqual([]);
        expect((await c.client.actions.invokeGlobal('ping', { namespace: 'Bad' })).success).toBe(false);
        expect(c.sent).toEqual([]);
    });

    it('CONTROL — a name that is no sub-resource, under the same namespace, is sent', async () => {
        const sent = await sentBy((c) => c.client.automation.getFlow('runs_digest', { namespace: 'crm' }));
        expect(sent.map((s) => new URL(s.url).pathname)).toEqual(['/api/v1/automation/crm/runs_digest']);
    });

    it('the /meta sub-resource set is the metadata protocol\'s own', () => {
        expect([...META_ITEM_SUBRESOURCE_SEGMENTS].sort()).toEqual([...SERVER_META_ITEM_SUBRESOURCE_SEGMENTS].sort());
    });

    it('the flow sub-resource set is exactly the segments the runtime ledger serves after `/automation/:name`', () => {
        const served = new Set<string>();
        for (const row of ROUTE_LEDGER) {
            const match = /^\/automation\/:name\/([^/:]+)/.exec(row.route.slice(row.route.indexOf(' ') + 1).split('?')[0]);
            if (match) served.add(match[1]);
        }
        expect([...served].sort()).toEqual([...AUTOMATION_FLOW_SUBRESOURCE_SEGMENTS].sort());
    });
});

// ---------------------------------------------------------------------------
// 4. The real doors
// ---------------------------------------------------------------------------

/** A client whose `fetch` hands every request to `dispatcher` in-process. */
function producerBackedClient(dispatcher: any, executionContext: Record<string, unknown>) {
    const wire: { last: any } = { last: undefined };
    const fetchImpl = async (url: string, init: RequestInit = {}): Promise<any> => {
        const parsed = new URL(String(url));
        const method = (init.method ?? 'GET').toUpperCase();
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        const query = Object.fromEntries(parsed.searchParams);
        const context: any = { request: {}, environmentId: 'platform', executionContext };
        const path = parsed.pathname;
        let answered: any;
        if (path.startsWith('/api/v1/automation')) {
            answered = await dispatcher.handleAutomation(path.slice('/api/v1/automation'.length), method, body ?? {}, context, query);
        } else if (path.startsWith('/api/v1/actions')) {
            answered = await dispatcher.handleActions(path.slice('/api/v1/actions'.length), method, body ?? {}, context);
        } else if (path.startsWith('/api/v1/meta')) {
            answered = await dispatcher.handleMetadata(path.slice('/api/v1/meta'.length), context, method, body, query);
        }
        expect(answered?.handled, `the dispatcher must serve ${method} ${path}`).toBe(true);
        const status = answered.response?.status ?? 200;
        wire.last = answered.response?.body;
        return {
            ok: status >= 200 && status < 300,
            status,
            statusText: String(status),
            headers: new Headers(),
            json: async () => answered.response?.body,
        };
    };
    return { client: new ObjectStackClient({ baseUrl: BASE, fetch: fetchImpl as any }), wire };
}

/** The ObjectQL registry double the `/automation` door's address reads (the runtime's own suite's shape). */
function automationDoor(holders: Record<string, string[]>, namespaces: Record<string, string>) {
    const holderTable = new Map(Object.entries(holders));
    const holdersOf = (type: string, name: string) => holderTable.get(`${type}:${name}`) ?? [];
    const registry = {
        getNamespaceOwners: (ns: string) => Object.keys(namespaces).filter((id) => namespaces[id] === ns),
        packageScopedHoldersOf: holdersOf,
        getPackageScopedItem: (type: string, name: string, packageId: string) =>
            (holdersOf(type, name).includes(packageId) ? { name, _packageId: packageId } : undefined),
        getEnvironmentScopedItem: () => undefined,
        getPackage: (id: string) => (namespaces[id] ? { manifest: { id, namespace: namespaces[id] } } : undefined),
    };
    const automation = {
        handlerReady: true,
        getFlow: vi.fn(async (name: string) => ({ name })),
        execute: vi.fn(async () => ({ success: true, output: {} })),
        listRunsPage: vi.fn(async () => ({ runs: [] as unknown[], hasMore: false })),
        getFlowRuntimeStates: vi.fn(() => []),
    };
    const services: Record<string, unknown> = { automation, objectql: { registry } };
    const resolve = (name: string) => services[name];
    const dispatcher = new HttpDispatcher({ getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } } as never);
    return { dispatcher, automation };
}

describe('4a. the /automation door: a 409 rejects with every candidate, an address reaches its holder', () => {
    const ADMIN = { userId: 'u1', systemPermissions: ['manage_metadata'] };

    it('a namespace whose package holds no such flow, while another does: rejected 409, both nothing run and the holder named', async () => {
        const { dispatcher, automation } = automationDoor({ 'flow:send_digest': [CRM] }, { [CRM]: 'crm', [HR]: 'hr' });
        const { client } = producerBackedClient(dispatcher, ADMIN);
        const err = await refusalOf(client.automation.execute('send_digest', {}, { namespace: 'hr' }));
        expect([err.httpStatus, err.code]).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(err.details?.candidates).toEqual([{ kind: 'package', packageId: CRM }]);
        expect(automation.execute).not.toHaveBeenCalled();
    });

    it('a bare name two packages hold: rejected 409 naming both, on the run and on the read', async () => {
        const { dispatcher, automation } = automationDoor({ 'flow:send_digest': [CRM, HR] }, { [CRM]: 'crm', [HR]: 'hr' });
        const { client } = producerBackedClient(dispatcher, ADMIN);
        for (const p of [client.automation.execute('send_digest', {}), client.automation.getFlow('send_digest')]) {
            const err = await refusalOf(p);
            expect([err.httpStatus, err.code]).toEqual([409, 'RESOURCE_CONFLICT']);
            expect(err.details?.candidates).toEqual([{ kind: 'package', packageId: CRM }, { kind: 'package', packageId: HR }]);
        }
        expect(automation.execute).not.toHaveBeenCalled();
    });

    it('CONTROL — the namespace\'s one holder: the qualified run and read reach it', async () => {
        const { dispatcher, automation } = automationDoor({ 'flow:send_digest': [CRM] }, { [CRM]: 'crm', [HR]: 'hr' });
        const { client } = producerBackedClient(dispatcher, ADMIN);
        await client.automation.execute('send_digest', {}, { namespace: 'crm' });
        await client.automation.trigger('send_digest', {}, { namespace: 'crm' });
        expect((await client.automation.getFlow('send_digest', { namespace: 'crm' })).name).toBe('send_digest');
        expect(automation.execute.mock.calls.map((c: any[]) => c[0])).toEqual(['send_digest', 'send_digest']);
    });
});

/** The `/actions` door over an ObjectQL double holding `standalone` action declarations (the runtime's own suite's shape). */
function actionsDoor(standalone: any[], namespaces: Record<string, string>) {
    const ran: Array<{ obj: string; key: string; packageId?: string }> = [];
    const ql: any = {
        getSchema: () => undefined,
        registry: {
            getObject: () => undefined,
            getItem: () => undefined,
            getNamespaceOwners: (ns: string) => Object.keys(namespaces).filter((id) => namespaces[id] === ns),
            getPackage: (id: string) => (namespaces[id] ? { manifest: { id, namespace: namespaces[id] } } : undefined),
        },
        find: vi.fn(async () => []),
        findOne: vi.fn(async (object: string, query?: any) => { assertEngineFindOnePredicate(object, query); return null; }),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        executeAction: vi.fn(async (obj: string, key: string, _ctx: any, opts?: { packageId?: string }) => {
            ran.push({ obj, key, ...(opts?.packageId !== undefined ? { packageId: opts.packageId } : {}) });
            return { ran: opts?.packageId ?? 'unqualified' };
        }),
        listRegisteredActions: () => standalone.map((a) => ({ objectName: 'global', actionName: a.name, package: a._packageId })),
    };
    const metadata: any = {
        listObjects: vi.fn(async () => []),
        getObject: vi.fn(async () => undefined),
        load: vi.fn(async () => null),
        loadMany: vi.fn(async (t: string) => (t === 'action' ? standalone : [])),
        loadDiagnosed: vi.fn(async (_t: string, name: string) => ({
            data: standalone.find((a) => a.name === name) ?? null, degraded: false, errors: [],
        })),
    };
    const services: Record<string, unknown> = {
        objectql: ql,
        data: ql,
        metadata,
        audit: { recordActionInvocation: vi.fn(async () => {}) },
        auth: { api: { getSession: async () => ({ user: { id: 'u1' } }) } },
        automation: { execute: vi.fn(async () => ({ success: true })) },
    };
    const dispatcher = new HttpDispatcher({ context: { getService: (n: string) => services[n] ?? null } } as never);
    return { dispatcher, ran };
}

const action = (name: string, pkg: string) => ({
    name, label: name, type: 'script', body: { language: 'js', source: 'return 1' }, _packageId: pkg,
});

describe('4b. the /actions door: `invoke` keeps every candidate of a 409 on its result, an address runs its holder', () => {
    const USER = { userId: 'u1', systemPermissions: [] };

    beforeEach(() => {
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('a namespace two packages co-own, both declaring the name: `success: false` with both candidates, nothing run', async () => {
        const { dispatcher, ran } = actionsDoor([action('send_digest', CRM), action('send_digest', HR)], { [CRM]: 'crm', [HR]: 'crm' });
        const { client, wire } = producerBackedClient(dispatcher, USER);
        const result = await client.actions.invokeGlobal('send_digest', { namespace: 'crm' });
        expect(wire.last?.error?.code, JSON.stringify(wire.last)).toBe('RESOURCE_CONFLICT');
        expect(result.success).toBe(false);
        expect(result.candidates).toEqual([{ kind: 'package', packageId: CRM }, { kind: 'package', packageId: HR }]);
        expect(ran).toEqual([]);
    });

    it('CONTROL — each holder of a two-holder name is run by its namespace, with its own handler', async () => {
        const { dispatcher, ran } = actionsDoor([action('send_digest', CRM), action('send_digest', HR)], { [CRM]: 'crm', [HR]: 'hr' });
        const { client } = producerBackedClient(dispatcher, USER);
        const hr = await client.actions.invokeGlobal('send_digest', { namespace: 'hr' });
        const crm = await client.actions.invoke('global', 'send_digest', { namespace: 'crm' });
        expect([hr.success, crm.success]).toEqual([true, true]);
        expect(hr.candidates).toBeUndefined();
        expect(ran).toEqual([
            { obj: 'global', key: 'send_digest', packageId: HR },
            { obj: 'global', key: 'send_digest', packageId: CRM },
        ]);
    });

    it('CONTROL — a failure that is no address refusal carries no candidates', async () => {
        const { dispatcher } = actionsDoor([action('send_digest', CRM)], { [CRM]: 'crm', [HR]: 'hr' });
        const { client, wire } = producerBackedClient(dispatcher, USER);
        const result = await client.actions.invokeGlobal('send_digest', { namespace: 'hr' });
        expect(wire.last?.error?.code, JSON.stringify(wire.last)).not.toBe('RESOURCE_CONFLICT');
        expect(result.success).toBe(false);
        expect(result.candidates).toBeUndefined();
    });
});

describe('4c. the /meta door: a qualified read reaches its holder, and a 409 rejects naming every holder', () => {
    const A = 'com.acme.alpha';
    const B = 'com.acme.beta';
    const C = 'com.acme.gamma';
    const ADMIN = { userId: 'u1', systemPermissions: ['manage_metadata'] };

    function metaDoor() {
        const registry = new SchemaRegistry({ multiTenant: false });
        for (const id of [A, B, C]) {
            registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop()! } as never, 'code');
        }
        const ship = (type: string, name: string, packageId: string) =>
            registry.registerItem(type, { name, label: `${packageId.split('.').pop()} ${type}` }, 'name' as never, packageId);
        const engine = {
            registry,
            find: vi.fn().mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue(null),
            insert: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            count: vi.fn().mockResolvedValue(0),
            aggregate: vi.fn().mockResolvedValue([]),
        };
        const protocol = new ObjectStackProtocolImplementation(engine as never);
        const services: Record<string, unknown> = { protocol, objectql: engine };
        const resolve = (name: string) => services[name] ?? null;
        const dispatcher = new HttpDispatcher({ getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } } as never);
        return { dispatcher, ship };
    }

    it('each holder of a two-holder name is read by its namespace', async () => {
        const { dispatcher, ship } = metaDoor();
        ship('page', 'home', A);
        ship('page', 'home', B);
        const { client } = producerBackedClient(dispatcher, ADMIN);
        expect(((await client.meta.getItem('page', 'home', { namespace: 'alpha' })).item as { label?: string } | undefined)?.label).toBe('alpha page');
        expect(((await client.meta.getItem('page', 'home', { namespace: 'beta' })).item as { label?: string } | undefined)?.label).toBe('beta page');
    });

    it('a namespace that holds nothing of a name another package holds: rejected 409, the message naming the holder', async () => {
        const { dispatcher, ship } = metaDoor();
        ship('page', 'home', A);
        const { client } = producerBackedClient(dispatcher, ADMIN);
        const err = await refusalOf(client.meta.getItem('page', 'home', { namespace: 'gamma' }));
        expect([err.httpStatus, err.code]).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(err.message).toContain(`package "${A}"`);
        // [#32201] …and its holders, structured, where the SDK reads them.
        expect(err.details?.candidates).toEqual([{ kind: 'package', packageId: A }]);
        // CONTROL — the bare read of the same one-holder name is served.
        expect(((await client.meta.getItem('page', 'home')).item as { label?: string } | undefined)?.label).toBe('alpha page');
    });

    it('a bare read of a name two packages hold: rejected 409, the message naming both', async () => {
        const { dispatcher, ship } = metaDoor();
        ship('page', 'home', A);
        ship('page', 'home', B);
        const { client } = producerBackedClient(dispatcher, ADMIN);
        const err = await refusalOf(client.meta.getItem('page', 'home'));
        expect([err.httpStatus, err.code]).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(err.message).toContain(`package "${A}"`);
        expect(err.message).toContain(`package "${B}"`);
        expect(err.details?.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
    });

    it('both qualifiers on one read are refused by the door, never one picked', async () => {
        const { dispatcher, ship } = metaDoor();
        ship('page', 'home', A);
        const { client } = producerBackedClient(dispatcher, ADMIN);
        const err = await refusalOf(client.meta.getItem('page', 'home', { namespace: 'alpha', packageId: B }));
        expect([err.httpStatus, err.code]).toEqual([400, 'VALIDATION_ERROR']);
    });
});
