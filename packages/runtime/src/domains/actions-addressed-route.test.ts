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
import { MetadataManager, DatabaseLoader } from '@objectstack/metadata';
import { assertEngineFindOnePredicate } from '@objectstack/objectql';
import { HttpDispatcher } from '../http-dispatcher.js';

const CRM = 'com.crm.pkg';
const HR = 'com.hr.pkg';

function dispatcherWith(
    objects: any[],
    standalone: any[],
    namespaceOf: Record<string, string> = { [CRM]: 'crm', [HR]: 'hr' },
    /** Further kernel services (a `security` service, for the field-visibility pins). */
    extra: Record<string, unknown> = {},
) {
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
        ...extra,
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

    it('CONTROL — MCP bare run_action(log_call, { objectName: lead }) is refused as the REST door refuses it: 404, no declaration', async () => {
        const { bridge, ran } = fixture();
        const err = await refusalOf(bridge.runAction('log_call', { objectName: 'lead' }));
        // [#31923] C3: the REST door's undeclared 404 (was the bridge's own
        // uncoded "not found on object" sentence).
        expect(err.status).toBe(404);
        expect(String(err.message)).toContain("Action 'log_call' on 'lead' has no declaration");
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

    it('[#31697] the bare call is refused on REST and MCP, 409 naming both packages — no pick by package, never the object\'s own by listing order (epic ruling record 6729825528, letter A)', async () => {
        // hr's declaration is gated and the caller holds nothing: the refusal
        // is the ambiguity's, judged before either declaration's gate.
        const { post, bridge, ran } = pair({ requiredPermissions: ['hr_admin'] });
        const rest = await post('/lead/convert/r1');
        expect(rest.status, JSON.stringify(rest.body)).toBe(409);
        expect(codeOf(rest)).toBe('RESOURCE_CONFLICT');
        expect(messageOf(rest)).toContain(CRM);
        expect(messageOf(rest)).toContain(HR);
        for (const input of [{ objectName: 'lead', recordId: 'r1' }, {}]) {
            const err = await refusalOf(bridge.runAction('convert', input));
            expect(err.status ?? err.httpStatus, JSON.stringify(input)).toBe(409);
            expect(String(err.message)).toContain(CRM);
            expect(String(err.message)).toContain(HR);
        }
        expect(ran).toEqual([]);
        // Each address still reaches its own (the qualified doors, above).
        expect((await post('/crm/lead/convert/r1')).status).toBe(200);
        expect(ran).toEqual([{ obj: 'lead', key: 'convert', packageId: CRM }]);
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

/**
 * [#31697, epic obligation record 6742974046 (G2)] A declaration with no
 * package is the ENVIRONMENT's only when the environment's own store holds it
 * (an active `sys_metadata` row bound to no package); any other — code the
 * host or a plugin registered with no package — is the PLATFORM's: alone it
 * answers, beside a package holder the bare call is refused naming both. The
 * row's source decides, never a byte of its definition (seat ruling, option b).
 */
describe('[#31697] an owner-less declaration beside a package holder: the platform\'s, unless the environment\'s store holds it', () => {
    const storeHolding = (names: string[]) => vi.fn(async (object: string, query?: any) =>
        object === 'sys_metadata' && query?.where?.type === 'action'
            ? names.map((name) => ({ name, type: 'action', state: 'active', package_id: null }))
            : object === 'sys_metadata' ? [] : [{ id: 'r1' }]);

    it('host code beside a package: the bare call is refused on REST and MCP, naming the package and the platform; the package\'s address reaches its own', async () => {
        const { post, bridge, ran, ql } = dispatcherWith([], [act('send_digest', CRM), act('send_digest', undefined)]);
        ql.find = storeHolding([]);
        const rest = await post('/global/send_digest');
        expect(rest.status, JSON.stringify(rest.body)).toBe(409);
        expect(codeOf(rest)).toBe('RESOURCE_CONFLICT');
        expect(messageOf(rest)).toContain(CRM);
        expect(messageOf(rest)).toContain('the platform');
        const mcp = await refusalOf(bridge.runAction('send_digest', {}));
        expect(mcp.status ?? mcp.httpStatus).toBe(409);
        expect(String(mcp.message)).toContain(CRM);
        expect(String(mcp.message)).toContain('the platform');
        expect(ran).toEqual([]);
        expect((await post('/crm/global/send_digest')).status).toBe(200);
        expect(ran).toEqual([{ obj: 'global', key: 'send_digest', packageId: CRM }]);
    });

    it('the definition\'s bytes never make a host row the environment\'s: `_provenance: \'org\'` on it changes nothing', async () => {
        const { post, bridge, ran, ql } = dispatcherWith([], [act('send_digest', CRM), act('send_digest', undefined, { _provenance: 'org' })]);
        ql.find = storeHolding([]);
        expect((await post('/global/send_digest')).status).toBe(409);
        expect((await refusalOf(bridge.runAction('send_digest', {}))).status).toBe(409);
        expect(ran).toEqual([]);
    });

    it('CONTROL — the environment\'s store holds the owner-less name: the environment\'s item answers the bare call first, on REST and MCP (ADR-0150 D3)', async () => {
        const { post, bridge, ran, ql } = dispatcherWith([], [act('send_digest', CRM), act('send_digest', undefined)]);
        ql.find = storeHolding(['send_digest']);
        const rest = await post('/global/send_digest');
        expect(rest.status, JSON.stringify(rest.body)).toBe(200);
        expect((await bridge.runAction('send_digest', {})).ok).toBe(true);
        expect(ran).toEqual([{ obj: 'global', key: 'send_digest' }, { obj: 'global', key: 'send_digest' }]);
    });

    it('CONTROL — the platform alone answers the bare call', async () => {
        const { post, bridge, ran, ql } = dispatcherWith([], [act('send_digest', undefined)]);
        ql.find = storeHolding([]);
        expect((await post('/global/send_digest')).status).toBe(200);
        expect((await bridge.runAction('send_digest', {})).ok).toBe(true);
        expect(ran).toEqual([{ obj: 'global', key: 'send_digest' }, { obj: 'global', key: 'send_digest' }]);
    });
});

/**
 * [#31697, review 6762242732 F1; epic record 6762108144] The bare door fails
 * CLOSED. A capability that is absent judges nothing; a listing that THROWS
 * once it is there answers `degraded` (503) — never the rungs, which would
 * serve the object's own declaration while the two-holder refusal is skipped.
 */
describe('[#31697] the bare door\'s holder rule when the listing read throws', () => {
    const lead = () => ({ name: 'lead', _packageId: CRM, fields: { name: { type: 'text' } }, actions: [act('convert', undefined)] });
    const throwing = () => ({ getMetaItems: vi.fn(async () => { throw new Error('sys_metadata unreachable'); }) });

    it('the protocol\'s merged listing throws, two packages on one object: 503, nothing run — not the object\'s own', async () => {
        const { post, ran } = dispatcherWith([lead()], [act('convert', HR, { objectName: 'lead' })], undefined, { protocol: throwing() });
        const rest = await post('/lead/convert/r1');
        expect(rest.status, JSON.stringify(rest.body)).toBe(503);
        expect(messageOf(rest)).toContain('sys_metadata unreachable');
        expect(ran).toEqual([]);
    });

    it('the metadata service\'s listing throws (no protocol): 503, nothing run', async () => {
        const { post, ran } = dispatcherWith([lead()], [act('convert', HR, { objectName: 'lead' })], undefined, {
            metadata: { listObjects: vi.fn(async () => { throw new Error('metadata plane down'); }), loadMany: vi.fn(async () => []) },
        });
        const rest = await post('/lead/convert/r1');
        expect(rest.status, JSON.stringify(rest.body)).toBe(503);
        expect(ran).toEqual([]);
    });

    it('CONTROL — no listing capability at all (no protocol, a metadata service with no list verb): the rungs answer as before', async () => {
        const { post, ran } = dispatcherWith([lead()], [], undefined, {
            metadata: { loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })) },
        });
        const rest = await post('/lead/convert/r1');
        expect(rest.status, JSON.stringify(rest.body)).toBe(200);
        expect(ran).toEqual([{ obj: 'lead', key: 'convert' }]);
    });
});

/**
 * [#31697, review 6762242732 F2] The bare REST door serves the declaration
 * the holder rule chose — the one MCP's bare `run_action` runs — never the
 * object's own by rung precedence. A package's embedded `convert` on `lead`
 * and the environment's own stored `convert` bound to `lead`: the
 * environment's answers first (ADR-0150 D3) on both doors; on base, both
 * doors answered the embedded one (declared in the changeset).
 */
describe('[#31697] an object-bound pair of a package\'s and the environment\'s: both bare doors serve the environment\'s', () => {
    const lead = () => ({ name: 'lead', _packageId: CRM, fields: { name: { type: 'text' } }, actions: [act('convert', undefined)] });
    const storeHolding = (keys: Array<[string, string]>) => vi.fn(async (object: string, query?: any) =>
        object === 'sys_metadata' && query?.where?.type === 'action'
            ? keys.map(([objectName, name]) => ({ name, type: 'action', state: 'active', package_id: null, metadata: { name, objectName } }))
            : object === 'sys_metadata' ? [] : [{ id: 'r1' }]);

    it('the environment\'s declaration (gated) judges the bare call on REST and on MCP alike', async () => {
        const { post, bridge, ran, ql } = dispatcherWith([lead()], [act('convert', undefined, { objectName: 'lead', requiredPermissions: ['env_admin'] })]);
        ql.find = storeHolding([['lead', 'convert']]);
        expect((await post('/lead/convert/r1')).status).toBe(403);
        expect((await refusalOf(bridge.runAction('convert', { objectName: 'lead', recordId: 'r1' }))).status).toBe(403);
        expect(ran).toEqual([]);
    });

    it('[review F5] a package-less row the store holds on ANOTHER object does not make this one the environment\'s: it is the platform\'s, and on an object-bound key that keeps today\'s answer, the object\'s own', async () => {
        const { post, bridge, ran, ql } = dispatcherWith([lead()], [act('convert', undefined, { objectName: 'lead', requiredPermissions: ['env_admin'] })]);
        ql.find = storeHolding([['account', 'convert']]);
        expect((await post('/lead/convert/r1')).status).toBe(200);
        expect((await bridge.runAction('convert', { objectName: 'lead', recordId: 'r1' })).ok).toBe(true);
        expect(ran).toEqual([{ obj: 'lead', key: 'convert' }, { obj: 'lead', key: 'convert' }]);
    });
});

/**
 * [#31697, epic ruling record 6762267053 item 1] The doors refuse exactly the
 * two declared cases: two packages on one key, and — on the OBJECT-LESS key
 * only — a package beside the platform (host code or a plugin). The platform
 * beside ONE package on an object-bound key is not refused: today's answer,
 * the first declaration, stands.
 */
describe('[#31697] the platform beside one package on an object-bound key is not refused', () => {
    it('host code\'s standalone `convert` on crm\'s `lead`: the bare call answers crm\'s own on REST and MCP, as before', async () => {
        const lead = { name: 'lead', _packageId: CRM, fields: { name: { type: 'text' } }, actions: [act('convert', undefined)] };
        const { post, bridge, ran, ql } = dispatcherWith([lead], [act('convert', undefined, { objectName: 'lead', requiredPermissions: ['host_admin'] })]);
        ql.find = vi.fn(async (object: string) => (object === 'sys_metadata' ? [] : [{ id: 'r1' }]));
        expect((await post('/lead/convert/r1')).status).toBe(200);
        expect((await bridge.runAction('convert', { objectName: 'lead', recordId: 'r1' })).ok).toBe(true);
        expect(ran).toEqual([{ obj: 'lead', key: 'convert' }, { obj: 'lead', key: 'convert' }]);
    });
});

describe('[ADR-0106 D1] an addressed call of an action the caller is not shown is answered as an unknown name in that scope', () => {
    const DEAL = {
        name: 'crm_deal',
        label: 'Deal',
        fields: { title: { name: 'title', type: 'text' }, margin: { name: 'margin', type: 'currency' } },
    };
    /** The caller reads the deal's `title` and not its `margin`. */
    const security = { getMetadataReadableFields: async (object: string) => (object === DEAL.name ? ['title'] : undefined) };
    const deal = () => dispatcherWith(
        [DEAL],
        [
            act('set_margin', CRM, { objectName: DEAL.name, params: [{ field: 'margin' }] }),
            act('rename_deal', CRM, { objectName: DEAL.name, params: [{ field: 'title' }] }),
        ],
        undefined,
        { security },
    );
    const asUnknown = (text: string, name: string) => text.split('no_such_action').join(name);

    it('REST /actions/:ns/:object/:action: answered byte-identical to a name the namespace does not declare, and nothing runs', async () => {
        const { post, ran } = deal();
        const unknown = await post(`/crm/${DEAL.name}/no_such_action`);
        expect(unknown.status, 'precondition: a name the namespace does not declare is a 404').toBe(404);
        const withheld = await post(`/crm/${DEAL.name}/set_margin`);
        expect(JSON.stringify(withheld)).toBe(asUnknown(JSON.stringify(unknown), 'set_margin'));
        expect(ran).toEqual([]);
    });

    it('MCP run_action with a namespace: answered byte-identical to a name the namespace does not declare, and nothing runs', async () => {
        const { bridge, ran } = deal();
        const unknown = await refusalOf(bridge.runAction('no_such_action', { namespace: 'crm', objectName: DEAL.name }));
        const withheld = await refusalOf(bridge.runAction('set_margin', { namespace: 'crm', objectName: DEAL.name }));
        const fields = (e: any) => JSON.stringify({ message: String(e?.message), code: e?.code, status: e?.status });
        expect(fields(unknown)).toContain('"status":404');
        expect(fields(withheld)).toBe(asUnknown(fields(unknown), 'set_margin'));
        expect(ran).toEqual([]);
    });

    it('CONTROL — an action binding a field the caller reads runs on both addressed doors', async () => {
        const { post, bridge, ran } = deal();
        expect((await post(`/crm/${DEAL.name}/rename_deal`)).status).toBe(200);
        await bridge.runAction('rename_deal', { namespace: 'crm', objectName: DEAL.name });
        expect(ran.map((r) => r.key)).toEqual(['rename_deal', 'rename_deal']);
    });
});

describe('[ADR-0106 D6] a run whose action definition read fails is refused 503 FIELD_VISIBILITY_UNRESOLVED, never judged as an action with no object', () => {
    const DEAL = {
        name: 'crm_deal',
        label: 'Deal',
        fields: { title: { name: 'title', type: 'text' }, margin: { name: 'margin', type: 'currency' } },
    };
    /** Bound to the deal's `margin`, which the caller cannot read. */
    const SET_MARGIN = act('set_margin', undefined, { objectName: DEAL.name, params: [{ field: 'margin' }] });
    const security = { getMetadataReadableFields: async (object: string) => (object === DEAL.name ? ['title'] : undefined) };
    /** The deal's definition read throws, as a registry that cannot answer does. */
    const failingReads = (extra: Record<string, unknown>) => {
        const door = dispatcherWith([DEAL], [SET_MARGIN], undefined, extra);
        const unreadable = () => { throw new Error('schema registry unavailable'); };
        door.ql.getSchema = unreadable;
        door.ql.registry.getObject = unreadable;
        return door;
    };

    it('REST /actions/:object/:action: 503 FIELD_VISIBILITY_UNRESOLVED, and nothing runs', async () => {
        const { post, ran } = failingReads({ security });
        const answer = await post(`/${DEAL.name}/set_margin`);
        expect({ status: answer.status, code: codeOf(answer) }).toEqual({ status: 503, code: 'FIELD_VISIBILITY_UNRESOLVED' });
        expect(ran).toEqual([]);
    });

    it('CONTROL — with no security service the visibility question reads no definition and refuses nothing; the call reaches the later gates', async () => {
        const { post } = failingReads({});
        // A later gate (the handler-owner check) reads the same registry, so the
        // call ends there: by that gate's throw, never by this question's 503.
        const outcome = await post(`/${DEAL.name}/set_margin`).then(
            (answer) => ({ code: codeOf(answer) }),
            (error: unknown) => ({ thrown: String((error as Error)?.message) }),
        );
        expect(outcome).not.toEqual({ code: 'FIELD_VISIBILITY_UNRESOLVED' });
        expect(outcome).toEqual({ thrown: 'schema registry unavailable' });
    });
});

/**
 * [#32521; epic #31527 red lines 2 and 3] With no protocol merged listing the
 * bare door reads its declarations from the metadata service's own plural read
 * (`collectActionDeclarations` over `loadMany('action')`). Driven here over a
 * real `MetadataManager` over a real `DatabaseLoader` over `sys_metadata` rows,
 * each bound to its package by the `package_id` column alone.
 */
describe('[#32521] the bare door over the metadata service\'s own plural read, with no merged listing', () => {
    /**
     * A `sys_metadata`-shaped READ-ONLY engine over a fixed row array:
     * `DatabaseLoader`'s read paths call `find` / `findOne` / `count` and
     * nothing else. The WHERE matcher refuses what it does not implement.
     */
    const readEngine = (rows: Array<Record<string, unknown>>) => {
        const matches = (r: Record<string, unknown>, w: Record<string, unknown>) =>
            Object.entries(w).every(([k, v]) => {
                if (k.startsWith('$')) throw new Error(`readEngine: unsupported WHERE combinator '${k}'`);
                if (v !== null && typeof v === 'object') throw new Error(`readEngine: unsupported WHERE operator on '${k}'`);
                return r[k] === v;
            });
        return {
            async find(_table: string, q: any) {
                const hits = rows.filter((r) => matches(r, q?.where ?? {}));
                return typeof q?.limit === 'number' ? hits.slice(0, q.limit) : hits;
            },
            async findOne(table: string, q: any) {
                assertEngineFindOnePredicate(table, q);
                return rows.find((r) => matches(r, q?.where ?? {})) ?? null;
            },
            async count(_table: string, q: any) {
                return rows.filter((r) => matches(r, q?.where ?? {})).length;
            },
        };
    };
    /** `send_digest`'s row held for `pkg` (none: a package-less row) at `version`, its body unstamped. */
    const row = (pkg: string | undefined, version: number) => {
        const { _packageId: _stamp, ...body } = act('send_digest', pkg) as Record<string, unknown>;
        return {
            id: `md_send_digest_${pkg ?? 'env'}`, type: 'action', name: 'send_digest', state: 'active', version,
            source: 'database', package_id: pkg ?? null, metadata: JSON.stringify(body),
        };
    };
    /**
     * The dispatcher over a manager reading `rows`. The engine's action map
     * holds one `send_digest` (`object:name`, no package): `engineHolds`, the
     * one its rebind kept, which the by-name rung serves.
     */
    const over = (rows: Array<Record<string, unknown>>, engineHolds: any) => {
        const manager = new MetadataManager({});
        manager.registerLoader(new DatabaseLoader({ engine: readEngine(rows) as any, trackHistory: false, cache: { enabled: false } } as any) as any);
        const metadata = {
            listObjects: vi.fn(async () => []),
            getObject: vi.fn(async () => undefined),
            load: vi.fn(async () => null),
            loadMany: (type: string) => manager.loadMany(type),
            loadDiagnosed: vi.fn(async (_t: string, name: string) => ({
                data: engineHolds.name === name ? engineHolds : null, degraded: false, errors: [],
            })),
        };
        const harness = dispatcherWith([], [engineHolds], undefined, { metadata });
        // The environment's store holds no package-less `send_digest`.
        harness.ql.find = vi.fn(async (object: string) => (object === 'sys_metadata' ? [] : [{ id: 'r1' }]));
        return { ...harness, manager };
    };
    /** Each declaration `loadMany` hands on: its package stamp and the row it is (its description). */
    const holders = async (manager: MetadataManager) =>
        ((await manager.loadMany('action')) as Array<{ _packageId?: string; ai?: { description?: string } }>)
            .map((item) => `${item._packageId ?? 'none'}: ${item.ai?.description}`);

    it('two packages\' rows of the name: the bare call is refused on REST and MCP, 409 naming both (BEFORE: one declaration reached the door and the call ran)', async () => {
        const { post, bridge, ran, manager } = over([row(CRM, 1), row(HR, 2)], act('send_digest', HR));
        expect(await holders(manager)).toEqual([`${CRM}: ${CRM} send_digest`, `${HR}: ${HR} send_digest`]);
        const rest = await post('/global/send_digest');
        expect(rest.status, JSON.stringify(rest.body)).toBe(409);
        expect(codeOf(rest)).toBe('RESOURCE_CONFLICT');
        expect(messageOf(rest)).toContain(CRM);
        expect(messageOf(rest)).toContain(HR);
        const mcp = await refusalOf(bridge.runAction('send_digest', {}));
        expect(mcp.status ?? mcp.httpStatus).toBe(409);
        expect(String(mcp.message)).toContain(CRM);
        expect(String(mcp.message)).toContain(HR);
        expect(ran).toEqual([]);
    });

    for (const [shape, rows, handedOn] of [
        ['one package\'s row', [row(CRM, 1)], [`${CRM}: ${CRM} send_digest`]],
        ['one package\'s row and a package-less row of the name saved after it (its customization)', [row(CRM, 1), row(undefined, 2)], ['none: env send_digest']],
        ['a package-less row and one package\'s row of the name saved after it', [row(undefined, 1), row(CRM, 2)], [`${CRM}: ${CRM} send_digest`]],
    ] as const) {
        it(`CONTROL — ${shape}: one declaration reaches the door, the row saved last, and the bare call runs on REST and MCP, as before`, async () => {
            const { post, bridge, ran, manager } = over([...rows], act('send_digest', CRM));
            expect(await holders(manager)).toEqual([...handedOn]);
            const rest = await post('/global/send_digest');
            expect(rest.status, JSON.stringify(rest.body)).toBe(200);
            expect((await bridge.runAction('send_digest', {})).ok).toBe(true);
            expect(ran.length).toBe(2);
        });
    }
});
