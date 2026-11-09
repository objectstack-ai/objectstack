// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, epic child G1] The REST `/actions` door reads D5's address:
 * `POST /actions/:ns/:object/:action[/:recordId]`, `/actions/:ns/global/:action`
 * and the same under `_env`. An addressed path resolves through the qualifier
 * alone, by the resolution the MCP `run_action` bridge's qualified call reads
 * (`resolveActionByName` with its qualifier, G2), and dispatches the holder's
 * handler.
 *
 * The objectName fallback (carry-in from G2's review): an addressed call on an
 * object reaches the declaration bound to that object first and the
 * holder's object-less one after — what the bare REST path reaches, narrowed
 * to the holder — on BOTH doors. The MCP bare arm stays as it was.
 *
 * Driven through the real `HttpDispatcher`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@objectstack/metadata';
import { assertEngineFindOnePredicate } from '@objectstack/objectql';
import { HttpDispatcher } from '../http-dispatcher.js';

const CRM = 'com.crm.pkg';
const HR = 'com.hr.pkg';

function dispatcherWith(objects: any[], standalone: any[], namespaceOf: Record<string, string> = { [CRM]: 'crm', [HR]: 'hr' }) {
    const ran: Array<{ obj: string; key: string; packageId?: string }> = [];
    const ql: any = {
        getSchema: (n: string) => objects.find((o) => o.name === n),
        registry: {
            getObject: (n: string) => objects.find((o) => o.name === n),
            getItem: () => undefined,
            getNamespaceOwners: (ns: string) => Object.keys(namespaceOf).filter((id) => namespaceOf[id] === ns),
            getPackage: (id: string) => (namespaceOf[id] ? { manifest: { id, namespace: namespaceOf[id] } } : undefined),
        },
        find: vi.fn(async () => [{ id: 'r1' }]),
        findOne: vi.fn(async (object: string, query?: any) => { assertEngineFindOnePredicate(object, query); return { id: 'r1' }; }),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        executeAction: vi.fn(async (obj: string, key: string, _ctx: any, opts?: { packageId?: string }) => {
            ran.push({ obj, key, ...(opts?.packageId !== undefined ? { packageId: opts.packageId } : {}) });
            return { ran: opts?.packageId ?? 'unqualified' };
        }),
        listRegisteredActions: () => [
            ...standalone.map((a) => ({ objectName: a.objectName ?? 'global', actionName: a.name, package: a._packageId })),
            ...objects.flatMap((o) => (o.actions ?? []).map((a: any) => ({ objectName: o.name, actionName: a.name, package: a._packageId }))),
        ],
    };
    const metadata: any = {
        listObjects: vi.fn(async () => objects),
        getObject: vi.fn(async (n: string) => objects.find((o) => o.name === n)),
        load: vi.fn(async () => null),
        loadMany: vi.fn(async (t: string) => (t === 'action' ? standalone : [])),
        // The bare door's metadata-plane read: the first standalone row of the name.
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
    const kernel: any = { context: { getService: (n: string) => services[n] ?? null } };
    const dispatcher = new HttpDispatcher(kernel) as any;
    const ctx = () => ({ request: {}, environmentId: 'platform', executionContext: { userId: 'u1', systemPermissions: [] } });
    const post = async (path: string) => {
        const answered = await dispatcher.handleActions(path, 'POST', {}, ctx());
        const response = answered?.response as { status?: number; body?: any };
        return { status: response?.status ?? 200, body: response?.body };
    };
    const declined = async (path: string) => (await dispatcher.handleActions(path, 'POST', {}, ctx()))?.handled === false;
    const bridge = dispatcher.buildMcpBridge(ctx());
    return { post, declined, bridge, ran };
}

const act = (name: string, pkg: string | undefined, extra: Record<string, unknown> = {}) => ({
    name,
    label: name,
    type: 'script',
    body: { language: 'js', source: 'return 1' },
    ai: { exposed: true, description: `${pkg ?? 'env'} ${name}` },
    ...(pkg ? { _packageId: pkg } : {}),
    ...extra,
});
const codeOf = (answer: { body?: any }) => answer.body?.error?.code ?? answer.body?.code;
const messageOf = (answer: { body?: any }) => String(answer.body?.error?.message ?? answer.body?.error ?? answer.body?.message ?? '');

async function refusalOf(p: Promise<unknown>): Promise<any> {
    try {
        await p;
    } catch (err) {
        return err;
    }
    throw new Error('expected a refusal');
}

beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('POST /actions/:ns/... — an installed namespace names its package exactly', () => {
    const pair = () => dispatcherWith([], [act('send_digest', CRM), act('send_digest', HR)]);

    it('each holder of a two-holder object-less name is run by its namespace, with its own handler', async () => {
        const { post, ran } = pair();
        const hr = await post('/hr/global/send_digest');
        expect(hr.status, JSON.stringify(hr.body)).toBe(200);
        const crm = await post('/crm/global/send_digest');
        expect(crm.status, JSON.stringify(crm.body)).toBe(200);
        expect(ran).toEqual([
            { obj: 'global', key: 'send_digest', packageId: HR },
            { obj: 'global', key: 'send_digest', packageId: CRM },
        ]);
    });

    it('a namespace whose package declares no such action: 404 naming the namespace, nothing run', async () => {
        const { post, ran } = dispatcherWith([], [act('send_digest', CRM)]);
        const answer = await post('/hr/global/send_digest');
        expect(answer.status).toBe(404);
        expect(messageOf(answer)).toContain("namespace 'hr'");
        expect(ran).toEqual([]);
    });

    it('a namespace two packages co-own, both declaring the name: 409 naming both, nothing run', async () => {
        const { post, ran } = dispatcherWith([], [act('send_digest', CRM), act('send_digest', HR)], { [CRM]: 'crm', [HR]: 'crm' });
        const answer = await post('/crm/global/send_digest');
        expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(answer.body?.error?.details?.candidates ?? answer.body?.details?.candidates).toEqual([
            { kind: 'package', packageId: CRM },
            { kind: 'package', packageId: HR },
        ]);
        expect(ran).toEqual([]);
    });

    it('an object-bound action of the namespace, with a record id', async () => {
        const lead = { name: 'lead', fields: { name: { type: 'text' } }, actions: [] };
        const { post, ran } = dispatcherWith([lead], [act('qualify', CRM, { objectName: 'lead' })]);
        const answer = await post('/crm/lead/qualify/r1');
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(ran).toEqual([{ obj: 'lead', key: 'qualify', packageId: CRM }]);
    });

    it('the activation write has no addressed form: 404, nothing written', async () => {
        const { post, ran } = pair();
        const answer = await post('/crm/_activation/global/send_digest');
        expect(answer.status).toBe(404);
        expect(ran).toEqual([]);
    });

    it('CONTROL — a first segment that is no installed namespace reads as the bare path, as before', async () => {
        const { post, ran } = dispatcherWith([], [act('send_digest', CRM)]);
        const bare = await post('/global/send_digest');
        expect(bare.status, JSON.stringify(bare.body)).toBe(200);
        expect(ran).toEqual([{ obj: 'global', key: 'send_digest' }]);
        expect((await post('/ops/global/send_digest')).status).toBe(404);
    });
});

describe('POST /actions/_env/... — the environment named exactly', () => {
    it('the environment\'s own action runs, naming no package', async () => {
        const { post, ran } = dispatcherWith([], [act('ping', undefined), act('ping', CRM)]);
        const answer = await post('/_env/global/ping');
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(ran).toEqual([{ obj: 'global', key: 'ping' }]);
    });

    it('a name only packages declare: 404 naming the environment, nothing run', async () => {
        const { post, ran } = dispatcherWith([], [act('send_digest', CRM)]);
        const answer = await post('/_env/global/send_digest');
        expect(answer.status).toBe(404);
        expect(messageOf(answer)).toContain('in the environment');
        expect(ran).toEqual([]);
    });
});

describe('a four-segment path whose first segment is no address is no route', () => {
    it('declined (`handled: false`), never served by the bare grammar: a literal, or no installed namespace', async () => {
        const { declined, ran } = dispatcherWith([], [act('close', CRM, { objectName: 'task' })]);
        for (const path of ['/task/close/rec_1/extra', '/_activation/task/close/extra', '/global/task/close/extra']) {
            expect(await declined(path), path).toBe(true);
        }
        expect(ran).toEqual([]);
    });

    it('CONTROL — an addressed four-segment path is served', async () => {
        const { declined } = dispatcherWith([], [act('close', CRM, { objectName: 'task' })]);
        expect(await declined('/crm/task/close/r1')).toBe(false);
    });
});

describe('carry-in: an addressed call on an object falls back to the holder\'s object-less declaration, on both doors', () => {
    const lead = { name: 'lead', fields: { name: { type: 'text' } }, actions: [] };
    const fixture = () => dispatcherWith([lead], [act('log_call', CRM)]);

    it('REST: /actions/crm/lead/log_call runs crm\'s object-less action — what the bare /actions/lead/log_call reaches', async () => {
        const { post, ran } = fixture();
        const bare = await post('/lead/log_call');
        expect(bare.status, JSON.stringify(bare.body)).toBe(200);
        const addressed = await post('/crm/lead/log_call');
        expect(addressed.status, JSON.stringify(addressed.body)).toBe(200);
        expect(ran.map((r) => r.packageId)).toEqual([undefined, CRM]);
    });

    it('MCP: run_action(log_call, { namespace: crm, objectName: lead }) reaches the same declaration', async () => {
        const { bridge, ran } = fixture();
        const out = await bridge.runAction('log_call', { namespace: 'crm', objectName: 'lead' });
        expect(out.ok).toBe(true);
        expect(ran.map((r) => r.packageId)).toEqual([CRM]);
    });

    it('CONTROL — MCP bare run_action(log_call, { objectName: lead }) answers as it did: not found', async () => {
        const { bridge, ran } = fixture();
        const err = await refusalOf(bridge.runAction('log_call', { objectName: 'lead' }));
        expect(String(err.message)).toContain("not found on object 'lead'");
        expect(ran).toEqual([]);
    });

    it('an object-bound declaration of the holder wins over its object-less one', async () => {
        const { post, ran } = dispatcherWith([lead], [act('log_call', CRM), act('log_call', CRM, { objectName: 'lead', label: 'bound' })]);
        const addressed = await post('/crm/lead/log_call');
        expect(addressed.status, JSON.stringify(addressed.body)).toBe(200);
        expect(ran).toEqual([{ obj: 'lead', key: 'log_call', packageId: CRM }]);
    });
});
