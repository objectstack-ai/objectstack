// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35707] An object save over translations that cannot be read, at the HTTP
 * door.
 *
 * The save reads the registered i18n service's whole catalog to tell a label a
 * translated read served back from one the author typed. When the service's
 * `getLocales` or `getTranslations` throws, the protocol refuses the save as
 * 503 `SERVICE_UNAVAILABLE`, declared a refusal, with one fixed sentence. The
 * route error door withholds the prose of an undeclared 5xx, so this file pins
 * what the caller actually receives: the status, the code, that fixed sentence
 * (never the generic 5xx one), none of the i18n service's own error text, and
 * an unchanged store. The control saves the same body over a service that
 * reads.
 *
 * The real `ObjectStackProtocolImplementation` over a `sys_metadata`-backed
 * engine, as `meta-compound-save-mode-parity.test.ts` boots it. That import
 * resolves to `@objectstack/metadata-protocol`'s `dist/`: rebuild it before
 * reading a result here after touching the protocol.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
// Paid at collection: `rest-server.ts` reaches `@objectstack/objectql` by a
// dynamic import inside a route handler (`check:test-source-alias`).
import '@objectstack/objectql';
import { RestServer } from './rest-server.js';
import { assertEngineUpdateDispatch, assertEngineDeleteDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

const SINGLE_PATH = '/api/v1/meta/:type/:name';
const NAME = 'crm_note';
const LIVE_LABEL = 'Live label';
const SUBMITTED_LABEL = 'Edited label';
const FAULT_TEXT = 'bundle offline at 10.0.0.7';
const SENTENCE =
    'The translations could not be read, so a label a translated read served back cannot be told from one '
    + 'written by hand; nothing was saved or migrated. Retry once the translations can be read.';

const objectBody = (label: string) => ({
    name: NAME,
    label,
    sharingModel: 'private',
    fields: Object.fromEntries(['a', 'b'].map((f) => [f, { name: f, type: 'text', label: f }])),
});

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        send: vi.fn(),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn(),
    };
    return res;
}

const i18nOf = (failing?: 'getLocales' | 'getTranslations') => ({
    getLocales: () => {
        if (failing === 'getLocales') throw new Error(FAULT_TEXT);
        return ['en', 'zh-CN'];
    },
    getTranslations: (locale: string) => {
        if (failing === 'getTranslations') throw new Error(FAULT_TEXT);
        return locale === 'zh-CN' ? { objects: { [NAME]: { label: '笔记' } } } : {};
    },
});

function boot(i18n: unknown) {
    const rows = new Map<string, any>();
    rows.set('row_live', {
        id: 'row_live', type: 'object', name: NAME,
        organization_id: null, package_id: null, state: 'active',
        metadata: JSON.stringify(objectBody(LIVE_LABEL)),
        checksum: 'sha256_35707_fixture', version: 1,
    });
    const match = (r: any, where: Record<string, unknown>): boolean => {
        for (const k of Object.keys(where ?? {})) {
            if (k.startsWith('$')) throw new Error(`fake engine: unsupported logical operator ${k}`);
        }
        return Object.entries(where ?? {}).every(([k, v]) =>
            v === null || v === undefined ? r[k] === null || r[k] === undefined : r[k] === v);
    };
    const engine: any = {
        async find(table: string, o?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const found = [...rows.values()].filter((r) => match(r, o?.where ?? {}));
            return typeof o?.limit === 'number' ? found.slice(0, o.limit) : found;
        },
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, o);
            if (table !== 'sys_metadata') return null;
            for (const r of rows.values()) if (match(r, o?.where ?? {})) return r;
            return null;
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata') {
                const r = { ...(data as any), id: String(data.id ?? `r_${rows.size}`) };
                rows.set(r.id, r);
            }
            return { id: String(data.id ?? 'r_new') };
        },
        async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, opts);
            const id = (opts as any)?.where?.id;
            const existing = id ? rows.get(String(id)) : undefined;
            if (existing) rows.set(String(id), { ...existing, ...(data as any) });
            return { id: id ?? null };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 0 };
        },
        registry: {
            registerItem: () => {}, registerObject: () => {}, listItems: () => [],
            getItem: () => undefined, getArtifactItem: () => undefined,
            removeRuntimeShadow: () => false, removeOverlayEntry: () => {}, uninstallPackage: () => {},
        },
    };
    const protocol: any = new ObjectStackProtocolImplementation(engine, () => new Map<string, any>([['i18n', i18n]]));
    const rest = new RestServer(mockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'u_author', systemPermissions: ['manage_metadata'] });
    rest.registerRoutes();
    const route = (rest as any).getRoutes().find((r: any) => r.method === 'PUT' && r.path === SINGLE_PATH);

    return {
        put: async () => {
            const res = mockRes();
            await route.handler({ params: { type: 'object', name: NAME }, query: {}, headers: {}, body: objectBody(SUBMITTED_LABEL) }, res);
            return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
        },
        liveLabel: () => JSON.parse([...rows.values()].find((r) => r.name === NAME && r.state === 'active')!.metadata).label,
    };
}

// The REST log is loud here, so the server-log assertion reads what a real
// deployment logs.
beforeAll(() => { vi.stubEnv('OS_REST_LOG', 'info'); });
afterAll(() => { vi.unstubAllEnvs(); });

describe('[#35707] PUT /meta/object/:name over translations that cannot be read', () => {
    it('control: the translations reading, the save answers 200 and stores the body', async () => {
        const server = boot(i18nOf());
        const { status } = await server.put();
        expect(status).toBe(200);
        expect(server.liveLabel()).toBe(SUBMITTED_LABEL);
    });

    for (const failing of ['getLocales', 'getTranslations'] as const) {
        it(`${failing} throwing: 503 SERVICE_UNAVAILABLE with the fixed sentence, no i18n error text, store unchanged`, async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                const server = boot(i18nOf(failing));
                const { status, body } = await server.put();
                expect(status).toBe(503);
                expect(body).toMatchObject({ error: SENTENCE, code: 'SERVICE_UNAVAILABLE' });
                expect(JSON.stringify(body)).not.toContain(FAULT_TEXT);
                expect(server.liveLabel()).toBe(LIVE_LABEL);
                // The i18n service's own error reaches the server log.
                expect(warn.mock.calls.some((c) => String(c[0]).includes(FAULT_TEXT))).toBe(true);
            } finally {
                warn.mockRestore();
            }
        });
    }
});
