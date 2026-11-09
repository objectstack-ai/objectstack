// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D2/D3/D5/D6] The MCP action bridge addresses an action by
 * (namespace, name). One action name two installed packages both declare:
 * `list_actions` lists both rows, each with its namespace and derived face;
 * `run_action` with `namespace` runs that package's declaration and handler;
 * without it the bare name is refused 409 naming both packages — never a
 * silent pick of one. A single holder's bare name is unchanged (CONTROL).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@objectstack/metadata';
import { HttpDispatcher } from './http-dispatcher.js';

const NAMESPACE_OF: Record<string, string> = { 'com.crm.pkg': 'crm', 'com.hr.pkg': 'hr' };

function dispatcherWith(objects: any[], standalone: any[]) {
    const ran: Array<{ obj: string; key: string; packageId?: string }> = [];
    const ql: any = {
        getSchema: (n: string) => objects.find((o) => o.name === n),
        registry: {
            getObject: (n: string) => objects.find((o) => o.name === n),
            getItem: () => undefined,
            getNamespaceOwners: (ns: string) => Object.keys(NAMESPACE_OF).filter((id) => NAMESPACE_OF[id] === ns),
            getPackage: (id: string) => (NAMESPACE_OF[id] ? { manifest: { id, namespace: NAMESPACE_OF[id] } } : undefined),
        },
        find: vi.fn(async () => [{ id: 'r1' }]),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        executeAction: vi.fn(async (obj: string, key: string, _ctx: any, opts?: { packageId?: string }) => {
            ran.push({ obj, key, ...(opts?.packageId !== undefined ? { packageId: opts.packageId } : {}) });
            return { ran: opts?.packageId ?? 'unqualified' };
        }),
        // The engine's handler listing: one bound handler per declared key, as
        // a package install binds them (the listing filters on it).
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
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
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
    const bridge = (new HttpDispatcher(kernel) as any).buildMcpBridge({
        request: {},
        environmentId: 'platform',
        executionContext: { userId: 'u1', systemPermissions: [] },
    });
    return { bridge, ran };
}

const act = (name: string, pkg: string, extra: Record<string, unknown> = {}) => ({
    name,
    label: name,
    type: 'script',
    body: { language: 'js', source: 'return 1' },
    ai: { exposed: true, description: `${pkg} ${name}` },
    _packageId: pkg,
    ...extra,
});

async function refusalOf(p: Promise<unknown>): Promise<any> {
    try {
        await p;
    } catch (err) {
        return err;
    }
    throw new Error('expected a refusal');
}

describe('MCP action bridge: (namespace, name) addressing (ADR-0150)', () => {
    beforeEach(() => {
        vi.spyOn(console, 'info').mockImplementation(() => {});
    });

    const pair = () => dispatcherWith([], [act('send_digest', 'com.crm.pkg'), act('send_digest', 'com.hr.pkg')]);

    it('list_actions lists both holders of an object-less name, each with its namespace and face', async () => {
        const { bridge } = pair();
        const rows = (await bridge.listActions()).filter((a: any) => a.name === 'send_digest');
        expect(rows.map((a: any) => [a.namespace, a.face])).toEqual([
            ['crm', 'crm-send_digest'],
            ['hr', 'hr-send_digest'],
        ]);
    });

    it('run_action without namespace refuses a two-holder name 409, naming both packages', async () => {
        const { bridge, ran } = pair();
        const err = await refusalOf(bridge.runAction('send_digest', {}));
        expect(err.code).toBe('RESOURCE_CONFLICT');
        expect(err.status).toBe(409);
        expect(err.message).toContain('com.crm.pkg');
        expect(err.message).toContain('com.hr.pkg');
        expect(ran).toEqual([]);
    });

    it('run_action with namespace runs that package\'s declaration and handler', async () => {
        const { bridge, ran } = pair();
        const out = await bridge.runAction('send_digest', { namespace: 'hr' });
        expect(out.ok).toBe(true);
        expect(ran).toEqual([{ obj: 'global', key: 'send_digest', packageId: 'com.hr.pkg' }]);
    });

    it('run_action with an unknown namespace is refused 404 naming it', async () => {
        const { bridge, ran } = pair();
        const err = await refusalOf(bridge.runAction('send_digest', { namespace: 'ops' }));
        expect(err.status).toBe(404);
        expect(err.message).toContain("'ops'");
        expect(ran).toEqual([]);
    });

    it('run_action with a namespace that holds no such action is refused 404', async () => {
        const { bridge } = dispatcherWith([], [act('send_digest', 'com.crm.pkg')]);
        const err = await refusalOf(bridge.runAction('send_digest', { namespace: 'hr' }));
        expect(err.status).toBe(404);
    });

    it('CONTROL: a single holder\'s bare name runs as before, naming no package', async () => {
        const { bridge, ran } = dispatcherWith([], [act('send_digest', 'com.crm.pkg')]);
        const out = await bridge.runAction('send_digest', {});
        expect(out.ok).toBe(true);
        expect(ran).toEqual([{ obj: 'global', key: 'send_digest' }]);
        const [row] = (await bridge.listActions()).filter((a: any) => a.name === 'send_digest');
        expect(row.namespace).toBe('crm');
        expect(row.face).toBe('crm-send_digest');
    });

    it('an object-bound action\'s face is OBJECT-ACTION and its row names its package namespace', async () => {
        const objs = [{ name: 'crm_lead', fields: {}, actions: [act('convert', 'com.crm.pkg', { objectName: 'crm_lead' })], _packageId: 'com.crm.pkg' }];
        const { bridge } = dispatcherWith(objs, []);
        const [row] = (await bridge.listActions()).filter((a: any) => a.name === 'convert');
        expect(row).toMatchObject({ objectName: 'crm_lead', namespace: 'crm', face: 'crm_lead-convert' });
    });
});
