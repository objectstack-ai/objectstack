// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7467] The public-lookup capability is REACHABLE end-to-end: a spec-valid
 * stored form carrying a `publicPicker` gets a real lookup answer.
 *
 * `GET /forms/:slug/lookup/:field` has always gated the anonymous picker on a
 * `publicPicker` block — and until #7467 that key was declared in no schema,
 * so `saveMetaItem` (which validates through `ViewMetadataSchema`) refused
 * every form carrying one with a 422 and the route's entire picker branch was
 * live code no authoring path could turn on. PR #7468's stored-row suite pins
 * that boundary from the other side ("STILL 403 — for a different reason");
 * THIS file is the flip's content: the same real write path now persists the
 * picker, and the same real route handler answers with data.
 *
 * ## What is real here and what is stubbed, exactly
 *
 * The form body fed to the routes is the body a REAL `saveMetaItem` persisted
 * into a stub repository's `sys_metadata` row, read back out of that row —
 * that write path validates through the REAL `ViewMetadataSchema` from
 * `@objectstack/spec`, which is precisely the door that refused the picker
 * before #7467. The route handlers are the real `RestServer` registrations.
 * The data engine under `findData` is stubbed (this suite pins the route's
 * request composition and response projection, not a driver), and the reader
 * is stubbed as in `public-form-routes.test.ts` — the ADR-0087 stored-row
 * conversion chain is a different seam, untouched by this card.
 */
import { describe, expect, it, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

// ─── the real save path (the seam that refused the picker before #7467) ─────

/** The slice of the engine the `sys_metadata` write path touches. */
function stubEngine() {
    const rows: Array<Record<string, any>> = [];
    let nextId = 0;
    return {
        rows,
        engine: {
            async findOne() { return null; },
            async find() { return rows.slice(); },
            async insert(table: string, data: Record<string, any>) {
                if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
                nextId += 1;
                rows.push({ id: `r_${nextId}`, ...data });
                return { id: `r_${nextId}` };
            },
            async update() { return { id: null }; },
            async delete() { return { deleted: 0 }; },
            registry: { registerItem: () => {}, registerObject: () => {}, listItems: () => [] },
        } as any,
    };
}

/**
 * Save a view through the real `saveMetaItem` and return the body the
 * `sys_metadata` row holds — what a consumer of that row will read.
 */
async function persistedBody(item: unknown): Promise<any> {
    const { engine, rows } = stubEngine();
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    const result = await protocol.saveMetaItem({ type: 'view', name: 'lead.contact', item });
    expect(result.success, JSON.stringify(result)).toBe(true);
    const row = rows.find((r) => r.type === 'view');
    expect(row, 'the save persisted no view row').toBeDefined();
    return JSON.parse(row!.metadata);
}

// ─── the fixture an author writes ───────────────────────────────────────────

/**
 * The picker under test: every key is one the route reads, nothing more.
 * `object` is declared because the route's fallback resolution reads only the
 * LEGACY field-def spellings (`referenceTo` / `target` / `options.objectName`)
 * and not the canonical `reference` — recorded as a follow-up finding on
 * #7467; against a canonical object schema the override is what works today.
 */
const PICKER = {
    displayFields: ['name', 'email'],
    maxResults: 10,
    filter: [{ field: 'is_active', operator: 'equals', value: true }],
    object: 'sys_user',
};

const studioForm = (fields: unknown[]) => ({
    name: 'lead.contact',
    object: 'lead',
    viewKind: 'form',
    label: 'Contact us',
    config: {
        type: 'simple',
        data: { provider: 'object', object: 'lead' },
        sharing: { allowAnonymous: true, publicLink: '/forms/contact' },
        sections: [{ label: 'About you', fields }],
    },
});

const leadObject = {
    name: 'lead',
    label: 'Lead',
    fields: {
        id: { type: 'text' },
        company: { type: 'text', label: 'Company' },
        owner: { type: 'lookup', reference: 'sys_user', label: 'Owner' },
    },
};

// ─── the real routes ────────────────────────────────────────────────────────

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.header = vi.fn(() => res);
    res.end = vi.fn(() => res);
    return res;
}

/** Mount the real routes over a protocol that serves the STORED view body. */
function routesOver(storedView: any, foundRows: any[]) {
    const findData = vi.fn().mockResolvedValue({ data: foundRows });
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn(async ({ type }: { type: string }) => {
            if (type === 'view') return [storedView];
            if (type === 'object') return [leadObject];
            return [];
        }),
        createData: vi.fn().mockResolvedValue({ object: 'lead', id: 'rec_1', record: {} }),
        findData,
    };
    const rest = new RestServer(mockServer() as any, protocol, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const lookup = rest.getRoutes().find((r) => r.method === 'GET' && r.path.endsWith('/forms/:slug/lookup/:field'))!;
    return { findData, lookup };
}

describe('#7467 a spec-valid stored form carrying a publicPicker reaches the lookup route', () => {
    it('the declaration survives the real save — a 422 here is the pre-#7467 gap reopening', async () => {
        // Before #7467 this exact save failed: `ViewMetadataSchema` reported
        // `unrecognized_keys` on `publicPicker` and no row was written. The
        // whole capability hangs on this assertion, which is why it stands
        // alone rather than as a side effect of the route cases below.
        const stored = await persistedBody(studioForm([{ field: 'owner', publicPicker: PICKER }]));
        expect(stored.config.sections[0].fields[0].publicPicker).toMatchObject({
            displayFields: ['name', 'email'],
            maxResults: 10,
            object: 'sys_user',
        });
    });

    it('…and the real lookup handler answers with projected data, not 403', async () => {
        const stored = await persistedBody(studioForm([{ field: 'owner', publicPicker: PICKER }]));
        const { findData, lookup } = routesOver(stored, [
            // The driver "returns" a column the projection must strip: never
            // trust that the engine respected `select` on an anonymous surface.
            { id: 'usr_1', name: 'Ada', email: 'ada@example.com', password_hash: 'LEAK' },
            { id: 'usr_2', name: 'Adele', email: 'adele@example.com' },
        ]);
        const res = mockRes();
        await lookup.handler({ params: { slug: 'contact', field: 'owner' }, query: { q: 'ad' } } as any, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.data).toEqual([
            { id: 'usr_1', name: 'Ada', email: 'ada@example.com' },
            { id: 'usr_2', name: 'Adele', email: 'adele@example.com' },
        ]);
        expect(res.body.displayFields).toEqual(['name', 'email']);

        // The query the route composed reads the STORED picker, key for key:
        // the declared object override, the declared cap, the declared filter
        // rows ahead of the visitor's search predicate, id + displayFields
        // projection, offset pinned to 0 (no anonymous pagination).
        expect(findData).toHaveBeenCalledTimes(1);
        const call = findData.mock.calls[0][0];
        expect(call.object).toBe('sys_user');
        expect(call.query.limit).toBe(10);
        expect(call.query.offset).toBe(0);
        expect(call.query.select).toEqual(['id', 'name', 'email']);
        expect(call.query.filters).toEqual([
            { field: 'is_active', operator: 'equals', value: true },
            { field: 'name', operator: 'contains', value: 'ad' },
        ]);
        expect(call.context.anonymous).toBe(true);
    });

    it('GUARD: a stored form whose field declares NO picker still answers 403 LOOKUP_NOT_PUBLIC', async () => {
        // The opt-in stays an opt-in. Green before and after #7467 — declaring
        // the key must not have widened the default. (This is the surviving
        // half of PR #7468's "STILL 403" boundary pin: picker-less is now the
        // only reason left.)
        const stored = await persistedBody(studioForm(['company', { field: 'owner' }]));
        const { findData, lookup } = routesOver(stored, []);
        const res = mockRes();
        await lookup.handler({ params: { slug: 'contact', field: 'owner' }, query: {} } as any, res);
        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('LOOKUP_NOT_PUBLIC');
        expect(findData).not.toHaveBeenCalled();
    });
});
