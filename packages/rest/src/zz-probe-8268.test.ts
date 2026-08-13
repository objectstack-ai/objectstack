// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// TEMPORARY probe for #8268 — deleted before the PR.
import { describe, it, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const TITLED = {
    name: 'showcase_account',
    label: 'Account',
    fields: {
        name: { name: 'name', label: 'Name', type: 'text' },
        industry: { name: 'industry', label: 'Industry', type: 'text' },
    },
};

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

const UNTITLED = {
    name: 'showcase_project_membership',
    label: 'Project Membership',
    fields: {
        project: { name: 'project', label: 'Project', type: 'lookup', reference_to: 'showcase_project' },
        seats: { name: 'seats', label: 'Seats', type: 'number' },
    },
};

async function measure(opts: { serviceMode: 'artifact' | 'bridged' | 'absent'; searchCompanion?: boolean; multiTenant?: boolean; untitled?: boolean; extendWithText?: boolean }) {
    const declaration = opts.untitled ? UNTITLED : TITLED;
    const objectName = declaration.name;
    const registry = new SchemaRegistry({
        multiTenant: opts.multiTenant ?? false,
        searchCompanion: opts.searchCompanion !== false,
    } as never);
    registry.registerObject(clone(declaration) as never, 'showcase', undefined, 'own');
    if (opts.extendWithText) {
        registry.registerObject(
            { name: objectName, fields: { nickname: { name: 'nickname', label: 'Nickname', type: 'text' } } } as never,
            'ext_pkg', undefined, 'extend',
        );
    }

    const engine = {
        registry,
        find: async () => [],
        findOne: async () => undefined,
    };

    const services = new Map<string, unknown>();
    if (opts.serviceMode !== 'absent') {
        const body = opts.serviceMode === 'artifact' ? clone(declaration) : registry.getObject(objectName);
        services.set('metadata', {
            get: async (type: string, name: string) =>
                (type === 'object' || type === 'objects') && name === objectName ? clone(body) : undefined,
        });
    }

    const protocol = new ObjectStackProtocolImplementation(engine as never, () => services as Map<string, never>);
    const rest = new RestServer(createMockServer() as never, protocol as never, { api: { requireAuth: false } } as never);
    (rest as unknown as { resolveExecCtx: () => Promise<unknown> }).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const routes = rest.getRouteManager();

    const run = async (path: string, params: Record<string, string>, query: Record<string, string>) => {
        const entry = routes.get('GET', path);
        if (!entry) throw new Error(`route not registered: ${path}`);
        let body: unknown;
        const res = {
            status: () => res, header: () => res,
            json: (b: unknown) => { body = b; }, send: (b: unknown) => { body = b; },
        } as unknown as Parameters<typeof entry.handler>[1];
        await entry.handler({ params, query, headers: {}, method: 'GET', path } as unknown as Parameters<typeof entry.handler>[0], res);
        return body as Record<string, unknown> | undefined;
    };

    const listBody = await run('/api/v1/meta/:type', { type: 'object' }, {});
    const listItems = (Array.isArray(listBody) ? listBody : ((listBody?.items ?? listBody?.data ?? []) as unknown[])) as Array<{ name?: string }>;
    const listed = listItems.find((o) => o?.name === objectName) as Record<string, unknown> | undefined;
    const single = await run('/api/v1/meta/:type/:name', { type: 'object', name: objectName }, {});
    const layered = await run('/api/v1/meta/:type/:name', { type: 'object', name: objectName }, { layers: 'true' });
    const byName = single?.item as Record<string, unknown> | undefined;
    const effective = layered?.effective as Record<string, unknown> | undefined;
    const registryResolved = registry.getObject(objectName) as unknown as Record<string, unknown>;

    const keysOf = (o: unknown) => Object.keys((o ?? {}) as Record<string, unknown>).sort();
    const IGNORED = new Set(['_diagnostics', '_packageId', '_lock', '_draft']);
    const diverge = (a: unknown, b: unknown) => {
        const ka = new Set(keysOf(a).filter((k) => !IGNORED.has(k)));
        const kb = new Set(keysOf(b).filter((k) => !IGNORED.has(k)));
        const all = [...new Set([...ka, ...kb])].sort();
        return all.filter((k) => JSON.stringify((a as never)?.[k]) !== JSON.stringify((b as never)?.[k]));
    };

    return {
        mode: opts.serviceMode,
        listedNameField: listed?.nameField,
        byNameNameField: byName?.nameField,
        effectiveNameField: effective?.nameField,
        registryNameField: registryResolved?.nameField,
        listedFields: Object.keys((listed?.fields ?? {}) as Record<string, unknown>).sort(),
        fieldsDiffDetail: (() => {
            const a = (byName?.fields ?? {}) as Record<string, unknown>;
            const b = (registryResolved?.fields ?? {}) as Record<string, unknown>;
            const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
            const out: Record<string, unknown> = {};
            for (const k of keys) {
                const sa = JSON.stringify(a[k], Object.keys(a[k] ?? {}).sort());
                const sb = JSON.stringify(b[k], Object.keys(b[k] ?? {}).sort());
                if (sa !== sb) out[k] = { byName: a[k] === undefined ? '<absent>' : sa, registry: b[k] === undefined ? '<absent>' : sb };
            }
            return { differingKeys: Object.keys(out), keyOrderOnly: Object.keys(out).length === 0, detail: out };
        })(),
        byNameSearchDef: (byName?.fields as never)?.['__search'],
        registrySearchDef: (registryResolved?.fields as never)?.['__search'],
        divergeListedVsRegistry: diverge(listed, registryResolved),
        byNameFields: Object.keys((byName?.fields ?? {}) as Record<string, unknown>).sort(),
        registryFields: Object.keys((registryResolved?.fields ?? {}) as Record<string, unknown>).sort(),
        byNameIndexes: byName?.indexes,
        registryIndexes: registryResolved?.indexes,
        byNameValidations: byName?.validations,
        registryValidations: registryResolved?.validations,
        divergeByNameVsRegistry: diverge(byName, registryResolved),
        divergeByNameVsListed: diverge(byName, listed),
        divergeEffectiveVsRegistry: diverge(effective, registryResolved),
    };
}

describe('#8268 probe', () => {
    it('measures nameField + whole-key divergence per host', async () => {
        const out: unknown[] = [];
        for (const mode of ['artifact', 'bridged', 'absent'] as const) {
            out.push(await measure({ serviceMode: mode }));
        }
        out.push({ tag: 'MULTITENANT', ...(await measure({ serviceMode: 'artifact', multiTenant: true })) });
        out.push({ tag: 'NOCOMPANION', ...(await measure({ serviceMode: 'artifact', searchCompanion: false })) });
        out.push({ tag: 'UNTITLED', ...(await measure({ serviceMode: 'artifact', untitled: true })) });
        out.push({ tag: 'UNTITLED+EXTEND_TEXT', ...(await measure({ serviceMode: 'artifact', untitled: true, extendWithText: true })) });
        out.push({ tag: 'TITLED+EXTEND_TEXT', ...(await measure({ serviceMode: 'artifact', extendWithText: true })) });
        out.push({ tag: 'ABSENT+UNTITLED+EXTEND_TEXT', ...(await measure({ serviceMode: 'absent', untitled: true, extendWithText: true })) });
        out.push({ tag: 'ABSENT+TITLED+EXTEND_TEXT', ...(await measure({ serviceMode: 'absent', extendWithText: true })) });
        const fs = await import('node:fs');
        fs.writeFileSync(process.env.OS_PROBE_OUT!, JSON.stringify(out, null, 2));
    });
});
