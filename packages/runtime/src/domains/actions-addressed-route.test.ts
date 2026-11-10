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
    const subjects: Array<{ obj: string; record?: any; recordId?: string }> = [];
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
        executeAction: vi.fn(async (obj: string, key: string, actionCtx: any, opts?: { packageId?: string }) => {
            ran.push({ obj, key, ...(opts?.packageId !== undefined ? { packageId: opts.packageId } : {}) });
            subjects.push({ obj, record: actionCtx?.record, recordId: actionCtx?.recordId });
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
    // What a catch-all host (`createHonoApp`) does with any `/api/v1/*` path:
    // hand it to `dispatch()` and answer what comes back.
    const dispatch = async (path: string) => {
        const answered = await dispatcher.dispatch('POST', path, {}, {}, { request: new Request(`http://host/api/v1${path}`, { method: 'POST' }) }, '/api/v1');
        return { handled: answered?.handled, status: answered?.response?.status, body: answered?.response?.body as any };
    };
    const bridge = dispatcher.buildMcpBridge(ctx());
    return { post, declined, dispatch, bridge, ran, subjects, ql };
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

describe('an addressed path is two or three segments after its qualifier', () => {
    it('one segment is no shape of it: the door\'s shape 404, nothing run', async () => {
        const { post, ran } = dispatcherWith([], [act('log_call', CRM)]);
        const answer = await post('/crm/log_call');
        expect(answer.status).toBe(404);
        expect(messageOf(answer)).toContain('/actions/:ns/:object/:action[/:recordId]');
        expect(ran).toEqual([]);
    });

    it('CONTROL — the object-less call spelled as published, /actions/:ns/global/:action, is served', async () => {
        const { post, ran } = dispatcherWith([], [act('log_call', CRM)]);
        const answer = await post('/crm/global/log_call');
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(ran).toEqual([{ obj: 'global', key: 'log_call', packageId: CRM }]);
    });

    it('more than three are declined, as the bare arm declines them, nothing run', async () => {
        const { declined, ran } = dispatcherWith([], [act('close', CRM, { objectName: 'task' })]);
        expect(await declined('/crm/task/close/r1/extra')).toBe(true);
        expect(await declined('/_env/task/close/r1/extra')).toBe(true);
        expect(ran).toEqual([]);
    });

    it('CONTROL — three segments after the qualifier are served', async () => {
        const task = { name: 'task', fields: { name: { type: 'text' } }, actions: [] };
        const { post, ran } = dispatcherWith([task], [act('close', CRM, { objectName: 'task' })]);
        const answer = await post('/crm/task/close/r1');
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(ran).toEqual([{ obj: 'task', key: 'close', packageId: CRM }]);
    });
});

describe('a four-segment path whose first segment is no address is no route', () => {
    it('declined (`handled: false`), never served by the bare grammar: a literal, or no installed namespace', async () => {
        const { declined, ran } = dispatcherWith([], [act('close', CRM, { objectName: 'task' })]);
        // (A deeper `_activation` path is declined by its own door, behind its
        // gates: `action-activation-posture-gate.test.ts`.)
        for (const path of ['/task/close/rec_1/extra', '/global/task/close/extra', '/sales/task/close/extra']) {
            expect(await declined(path), path).toBe(true);
        }
        expect(ran).toEqual([]);
    });

    it('CONTROL — an addressed four-segment path is served', async () => {
        const { declined } = dispatcherWith([], [act('close', CRM, { objectName: 'task' })]);
        expect(await declined('/crm/task/close/r1')).toBe(false);
    });

    it('on a catch-all host it is declined at `dispatch()` — the seam `createHonoApp` hands every path — nothing run; on base the call RAN with the tail ignored', async () => {
        // `createHonoApp` answers a declined dispatch with its own 404
        // (`toResponse`'s last line, `RESOURCE_NOT_FOUND` "Not Found"); a
        // mounted host answers the dispatcher's `ROUTE_NOT_FOUND` (the
        // every-verb integration and the dogfood door pin it). Both 404.
        const task = { name: 'task', fields: { name: { type: 'text' } }, actions: [] };
        const { dispatch, ran } = dispatcherWith([task], [act('close', CRM, { objectName: 'task' })]);
        for (const path of ['/actions/task/close/rec_1/extra', '/actions/crm/task/close/rec_1/extra']) {
            expect((await dispatch(path)).handled, path).toBe(false);
        }
        expect(ran).toEqual([]);
    });

    it('CONTROL — the same host serves the three-segment bare call', async () => {
        const task = { name: 'task', fields: { name: { type: 'text' } }, actions: [] };
        const { dispatch, ran } = dispatcherWith([task], [act('close', CRM, { objectName: 'task' })]);
        const answer = await dispatch('/actions/task/close/r1');
        expect(answer.status ?? 200, JSON.stringify(answer.body)).toBe(200);
        expect(ran).toEqual([{ obj: 'task', key: 'close' }]);
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

    it('the same CALL on both doors, with a record id: the subject object is the caller\'s, and its record is loaded and handed on', async () => {
        const rest = fixture();
        const viaRest = await rest.post('/crm/lead/log_call/r1');
        expect(viaRest.status, JSON.stringify(viaRest.body)).toBe(200);
        const mcp = fixture();
        const viaMcp = await mcp.bridge.runAction('log_call', { namespace: 'crm', objectName: 'lead', recordId: 'r1' });
        expect(viaMcp.ok, JSON.stringify(viaMcp)).toBe(true);
        for (const door of [rest, mcp]) {
            expect(door.ran).toEqual([{ obj: 'lead', key: 'log_call', packageId: CRM }]);
            expect(door.subjects).toHaveLength(1);
            expect(door.subjects[0]?.obj).toBe('lead');
            expect(door.subjects[0]?.record).toEqual({ id: 'r1' });
        }
        // The record was read from the caller's object on both doors.
        const readFrom = (ql: any) => [...ql.find.mock.calls, ...ql.findOne.mock.calls].map((c: any[]) => c[0]);
        for (const door of [rest, mcp]) {
            expect(readFrom(door.ql)).toContain('lead');
            expect(readFrom(door.ql)).not.toContain('global');
        }
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

describe('a package\'s standalone action bound to another package\'s object that embeds the same name: each address reaches its own', () => {
    // crm's `lead` embeds `convert` (the object is crm's; the embedded row
    // carries no stamp of its own), and hr ships a standalone `convert` bound
    // to `lead`. The collector keeps both: the key is (package, object, name).
    const lead = () => ({ name: 'lead', _packageId: CRM, fields: { name: { type: 'text' } }, actions: [act('convert', undefined)] });
    const pair = (hrExtra: Record<string, unknown> = {}) =>
        dispatcherWith([lead()], [act('convert', HR, { objectName: 'lead', ...hrExtra })]);

    it('REST: /actions/crm/lead/convert runs crm\'s, /actions/hr/lead/convert runs hr\'s', async () => {
        const { post, ran } = pair();
        const crm = await post('/crm/lead/convert/r1');
        expect(crm.status, JSON.stringify(crm.body)).toBe(200);
        const hr = await post('/hr/lead/convert/r1');
        expect(hr.status, JSON.stringify(hr.body)).toBe(200);
        expect(ran).toEqual([
            { obj: 'lead', key: 'convert', packageId: CRM },
            { obj: 'lead', key: 'convert', packageId: HR },
        ]);
    });

    it('MCP: run_action(convert, { namespace, objectName: lead }) reaches each package\'s declaration', async () => {
        const { bridge, ran } = pair();
        expect((await bridge.runAction('convert', { namespace: 'crm', objectName: 'lead', recordId: 'r1' })).ok).toBe(true);
        expect((await bridge.runAction('convert', { namespace: 'hr', objectName: 'lead', recordId: 'r1' })).ok).toBe(true);
        expect(ran).toEqual([
            { obj: 'lead', key: 'convert', packageId: CRM },
            { obj: 'lead', key: 'convert', packageId: HR },
        ]);
    });

    it('the address reaches hr\'s DECLARATION, not only its handler: hr\'s own gate judges the hr call, crm\'s call is not gated by it', async () => {
        const { post, bridge, ran } = pair({ requiredPermissions: ['hr_admin'] });
        expect((await post('/hr/lead/convert/r1')).status).toBe(403);
        expect((await refusalOf(bridge.runAction('convert', { namespace: 'hr', objectName: 'lead', recordId: 'r1' }))).status).toBe(403);
        expect((await post('/crm/lead/convert/r1')).status).toBe(200);
        expect(ran).toEqual([{ obj: 'lead', key: 'convert', packageId: CRM }]);
    });

    it('list_actions lists both, each under its own namespace', async () => {
        const { bridge } = pair();
        const listed = ((await bridge.listActions()) as any[]).filter((a) => a.name === 'convert');
        expect(listed.map((a) => [a.objectName, a.namespace]).sort()).toEqual([['lead', 'crm'], ['lead', 'hr']]);
    });

    it('the bare call keeps its answer, the object\'s own (crm\'s), on REST and MCP: no pick by package, no refusal — the no-package refusal of an object-bound pair is the action family\'s own card (ADR-0150 child B, epic ruling record 6729825528); flip these when it lands', async () => {
        // hr's declaration is gated and the caller holds nothing: had a bare
        // door read hr's, it would answer 403.
        const { post, bridge, ran } = pair({ requiredPermissions: ['hr_admin'] });
        const rest = await post('/lead/convert/r1');
        expect(rest.status, JSON.stringify(rest.body)).toBe(200);
        expect((await bridge.runAction('convert', { objectName: 'lead', recordId: 'r1' })).ok).toBe(true);
        expect((await bridge.runAction('convert', {})).ok).toBe(true);
        expect(ran).toEqual([
            { obj: 'lead', key: 'convert' },
            { obj: 'lead', key: 'convert' },
            { obj: 'lead', key: 'convert' },
        ]);
    });

    it('CONTROL — one package holding both an embedded and a standalone `convert` on its object: the embedded one wins, listed once', async () => {
        const { post, bridge, ran } = dispatcherWith(
            [lead()],
            [act('convert', CRM, { objectName: 'lead', requiredPermissions: ['crm_admin'] })],
        );
        // The standalone duplicate is gated; the embedded one is not. The
        // address answers 200, so it read the embedded declaration.
        const answer = await post('/crm/lead/convert/r1');
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect((await bridge.runAction('convert', { namespace: 'crm', objectName: 'lead', recordId: 'r1' })).ok).toBe(true);
        expect(ran).toEqual([
            { obj: 'lead', key: 'convert', packageId: CRM },
            { obj: 'lead', key: 'convert', packageId: CRM },
        ]);
    });

    it('CONTROL — the same holder\'s standalone duplicate is no row of its own: list_actions lists `convert` once', async () => {
        // Ungated, so the listing's permission filter cannot hide a second row.
        const { bridge } = dispatcherWith([lead()], [act('convert', CRM, { objectName: 'lead' })]);
        const listed = ((await bridge.listActions()) as any[]).filter((a) => a.name === 'convert');
        expect(listed.map((a) => [a.objectName, a.namespace])).toEqual([['lead', 'crm']]);
    });
});
