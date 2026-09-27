// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20186 — the flattened `view` overlay verdicts, pinned at the WRITE DOOR.
 *
 * `ViewMetadataSchema` now judges a flattened body by the arm its `viewKind`
 * names (the spec-side pins live in `view-overlay-viewkind-arm.test.ts`). The
 * spec pins alone would stay green if `saveMetaItem` stopped consulting that
 * schema, and the defect was measured HERE: before the change, a column-less
 * `viewKind: 'list'` body carrying a retired `sort` string answered
 * `success: true` and the row held the string as sent. So this file drives the
 * REAL `saveMetaItem` against a stub engine and reads the persisted
 * `sys_metadata` row, both for what is now refused (nothing stored, a located
 * `422 INVALID_METADATA`) and for what must keep saving (the console's
 * patch-only toolbar writes, ruled on #7494 — stored verbatim).
 */
import { describe, expect, it } from 'vitest';
import {
    assertEngineDeleteDispatch,
    assertEngineUpdateDispatch, assertEngineFindOnePredicate,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    metadata: string;
}

const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}`;

/**
 * The engine surface the repository write path touches — the stub shape
 * `protocol.graft-folded-form-sections.test.ts` uses, keyed BY TABLE so a
 * journal row can never be read back as a `sys_metadata` row.
 */
function makeProtocol() {
    const tables = new Map<string, Map<string, Row>>();
    const tableOf = (table: string): Map<string, Row> => {
        const existing = tables.get(table);
        if (existing) return existing;
        const created = new Map<string, Row>();
        tables.set(table, created);
        return created;
    };
    const rows = tableOf('sys_metadata');
    let nextId = 0;
    const findRow = (table: string, w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of tableOf(table)) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        for (const [k, r] of tableOf(table)) {
            if (w.type !== undefined && r.type !== w.type) continue;
            if (w.name !== undefined && r.name !== w.name) continue;
            if (w.organization_id !== undefined && r.organization_id !== w.organization_id) continue;
            if (w.state !== undefined && r.state !== w.state) continue;
            return { key: k, row: r };
        }
        return null;
    };
    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            return findRow(table, opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown> }) {
            return Array.from(tableOf(table).values()).filter((r) => {
                if (opts.where.type && r.type !== opts.where.type) return false;
                if (opts.where.organization_id !== undefined
                    && r.organization_id !== opts.where.organization_id) return false;
                if (opts.where.state && r.state !== opts.where.state) return false;
                return true;
            });
        },
        async insert(table: string, data: Record<string, unknown>) {
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            tableOf(table).set(keyOf(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(table, opts.where);
            if (!found) return { id: null };
            tableOf(table).set(found.key, { ...found.row, ...(data as any) });
            return { id: found.row.id };
        },
        async delete(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(table, opts.where);
            if (!found) return { deleted: 0 };
            tableOf(table).delete(found.key);
            return { deleted: 1 };
        },
        registry: { registerItem: () => {}, registerObject: () => {} },
    };
    return { protocol: new ObjectStackProtocolImplementation(engine, () => new Map()), rows };
}

const ID = { name: 'crm_lead.all', object: 'crm_lead' } as const;
const LIST = { ...ID, viewKind: 'list' } as const;
const FORM = { ...ID, viewKind: 'form' } as const;

/** Save through the real write door; return the body the stored ROW holds. */
async function stored(item: Record<string, unknown>): Promise<unknown> {
    const { protocol, rows } = makeProtocol();
    const result: any = await (protocol as any).saveMetaItem({ type: 'view', name: item.name as string, item });
    expect(result.success, JSON.stringify(result)).toBe(true);
    const row = Array.from(rows.values()).find((r) => r.type === 'view');
    expect(row, 'the save persisted no view row').toBeDefined();
    return JSON.parse(row!.metadata);
}

/** Save through the real write door; return the refusal, and prove nothing was stored. */
async function refused(item: Record<string, unknown>): Promise<{ code: string; status: number; issues: Array<{ path: string; code?: string; message: string }> }> {
    const { protocol, rows } = makeProtocol();
    let thrown: any;
    try {
        await (protocol as any).saveMetaItem({ type: 'view', name: item.name as string, item });
    } catch (e) {
        thrown = e;
    }
    expect(thrown, 'the save must be refused').toBeDefined();
    expect(thrown.code).toBe('INVALID_METADATA');
    expect(thrown.status).toBe(422);
    expect(rows.size, 'a refused save stores nothing').toBe(0);
    return thrown;
}

/** The envelope entry located at `path`. */
function at(err: { issues: Array<{ path: string; code?: string; message: string }> }, path: string) {
    const issue = err.issues.find((i) => i.path === path);
    expect(issue, `no issue at \`${path}\` in ${JSON.stringify(err.issues)}`).toBeDefined();
    return issue!;
}

describe('#20186 the write door stores the console patch-only list overlay verbatim', () => {
    it('the headline `{ name, object, viewKind: list, sort }` saves, and the row is the body as sent', async () => {
        const body = { ...LIST, sort: [{ field: 'name', order: 'asc' }] };
        expect(await stored(body)).toEqual(body);
    });

    it('the objectui sort toggle (`{ ...patch, viewKind }` + object/name/_isOverride) saves verbatim', async () => {
        const body = { sort: [{ field: 'name', order: 'desc' }], viewKind: 'list', ...ID, _isOverride: true };
        expect(await stored(body)).toEqual(body);
    });
});

describe('#20186 …and REFUSES the list keys it used to store unjudged', () => {
    it('a retired bare-string `sort`: 422 at `sort`, with the 17.5.0 retirement prescription', async () => {
        const err = await refused({ ...LIST, sort: 'name desc' });
        const issue = at(err, 'sort');
        expect(issue.code).toBe('invalid_type');
        expect(issue.message).toContain('The bare string `sort` clause was removed from `view.sort` in @objectstack/spec 17.5.0');
    });

    it('the `timeline.metaFields` twin: 422 at `timeline`, naming the key', async () => {
        const err = await refused({ ...LIST, timeline: { startDateField: 'created', titleField: 'name', metaFields: ['region'] } });
        const issue = at(err, 'timeline');
        expect(issue.code).toBe('unrecognized_keys');
        expect(issue.message).toContain('Unrecognized key(s) on this timeline configuration: `metaFields`.');
    });

    it('a non-array `searchableFields`: 422 at `searchableFields`', async () => {
        const err = await refused({ ...LIST, searchableFields: 'name' });
        expect(at(err, 'searchableFields').code).toBe('invalid_type');
    });

    it('a form-style `sharing` on a list body: 422 at `sharing`', async () => {
        const err = await refused({ ...LIST, sharing: { enabled: true } });
        expect(at(err, 'sharing').code).toBe('unrecognized_keys');
    });

    it('a column-less list overlay that names a `type`: 422 at `columns`, with the prescription', async () => {
        const err = await refused({ ...LIST, type: 'kanban', groupByField: 'stage' });
        const issue = at(err, 'columns');
        expect(issue.code).toBe('custom');
        expect(issue.message).toMatch(/^This list view overlay sets `type` but lists no `columns`\./);
    });

    it('the mirror — list `columns` on a `viewKind: form` body: 422 at `columns`, with the count prescription', async () => {
        const err = await refused({ ...FORM, columns: ['name'] });
        const issue = at(err, 'columns');
        expect(issue.code).toBe('invalid_type');
        expect(issue.message).toMatch(/^On a form view `columns` is the NUMBER of body columns/);
    });
});

describe('#20186 W2 — a list-legal value under a key both arms declare differently now saves', () => {
    it.each([
        ['aria', { aria: { ariaLabel: 'Leads' } }],
        ['an i18n description', { description: { en: 'All leads' } }],
        ['list-style sharing', { sharing: { type: 'personal' } }],
    ])('%s', async (_label, extra) => {
        const body = { ...LIST, ...extra };
        expect(await stored(body)).toEqual(body);
    });
});

describe('#20186 controls', () => {
    it('a real form overlay saves verbatim', async () => {
        const body = { ...FORM, type: 'simple', sections: [{ label: 'Main', fields: ['name'] }] };
        expect(await stored(body)).toEqual(body);
    });

    it('a list overlay with `columns` saves verbatim', async () => {
        const body = { ...LIST, columns: ['name'], sort: [{ field: 'name', order: 'asc' }] };
        expect(await stored(body)).toEqual(body);
    });
});
