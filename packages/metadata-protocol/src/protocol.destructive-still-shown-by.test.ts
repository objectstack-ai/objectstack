// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `409 DESTRUCTIVE_CHANGE` refusal names what still shows a removed field,
 * and the list-view filters a type change leaves unfit (`stillShownBy` on the
 * refusal's `issues[]`, `DestructiveChangeIssueSchema` in `@objectstack/spec/api`).
 *
 * Driven through the real producer, `saveMetaItem`, over a `sys_metadata`
 * double (the harness `protocol.destructive-409-face-inventory.test.ts` uses).
 * The findings ride `err.issues`, which every door relays verbatim; the
 * relay itself is `resolveThrownHttpError`, the rule both HTTP doors read, and
 * the MCP draft door saves with `mode: 'draft'` and `writeFace: 'meta-dispatch'`.
 */

import { describe, expect, it, vi } from 'vitest';
import { resolveThrownHttpError } from '@objectstack/types';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { DestructiveChangeIssueSchema } from '@objectstack/spec/api';
import './lint-root-preload.testkit.js';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum: string;
    version?: number;
}

const PKG = 'com.acme.crm';

const row = (type: string, name: string, body: Record<string, unknown>): Row => ({
    id: `row_${type}_${name}`,
    type,
    name,
    organization_id: null,
    package_id: PKG,
    state: 'active',
    metadata: JSON.stringify(body),
    checksum: 'sha256_35147_fixture',
    version: 1,
});

const FIELDS = {
    name: { name: 'name', type: 'text' },
    status: { name: 'status', type: 'text' },
    note: { name: 'note', type: 'text' },
};

const leadObject = row('object', 'crm_lead', { name: 'crm_lead', label: 'Lead', fields: FIELDS });

/**
 * A list view showing `status` as a column and filtering on it with a text
 * operator, in the flattened list-overlay shape the `/meta/view` door stores.
 */
const leadList = row('view', 'crm_lead_open', {
    name: 'crm_lead_open',
    viewKind: 'list',
    object: 'crm_lead',
    type: 'grid',
    data: { provider: 'object', object: 'crm_lead' },
    columns: ['name', 'status'],
    filter: [{ field: 'status', operator: 'contains', value: 'op' }],
});

/**
 * A view item in the shape the served `view` listing presents (`viewKind` +
 * `config`): the listing never serves a `{ list, listViews }` container, only
 * the items it expands into. Its `config` shows `status` as a column, filters
 * on it, and carries a `userFilters` tab preset that filters on it too.
 */
const leadItem = row('view', 'crm_lead.pipeline', {
    name: 'crm_lead.pipeline',
    object: 'crm_lead',
    viewKind: 'list',
    config: {
        type: 'grid',
        columns: ['name', 'status'],
        filter: [{ field: 'status', operator: 'contains', value: 'a' }],
        userFilters: {
            element: 'tabs',
            tabs: [{ name: 'hot', label: 'Hot', filter: [{ field: 'status', operator: 'contains', value: 'h' }] }],
        },
    },
});

/** A dataset with a dimension on `status`, and a dashboard card bound to that dimension. */
const leadDataset = row('dataset', 'lead_stats', {
    name: 'lead_stats',
    label: 'Lead stats',
    object: 'crm_lead',
    dimensions: [{ name: 'by_status', label: 'Status', field: 'status' }],
    measures: [{ name: 'lead_count', label: 'Leads', aggregate: 'count' }],
});
const leadDashboard = row('dashboard', 'lead_board', {
    name: 'lead_board',
    label: 'Lead board',
    widgets: [
        { id: 'w_total', type: 'metric', dataset: 'lead_stats', values: ['lead_count'] },
        { id: 'w_status', type: 'bar', dataset: 'lead_stats', dimensions: ['by_status'], values: ['lead_count'] },
    ],
});

/** A form view editing `status`. */
const leadForm = row('view', 'crm_lead_edit', {
    name: 'crm_lead_edit',
    object: 'crm_lead',
    type: 'simple',
    data: { provider: 'object', object: 'crm_lead' },
    sections: [{ label: 'Main', fields: ['name', 'status'] }],
});

const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

function makeKernel(seed: Row[]) {
    const rows = new Map<string, Row>();
    for (const r of seed) rows.set(r.id, r);
    const match = (r: Row, where: Record<string, unknown>): boolean =>
        Object.entries(where ?? {}).every(([k, v]) => {
            if (k === '$or') return (v as Array<Record<string, unknown>>).some((c) => match(r, c));
            return v === null || v === undefined
                ? (r as any)[k] === null || (r as any)[k] === undefined
                : whereValueMatches((r as any)[k], v);
        });
    const finds: string[] = [];
    const engine: any = {
        async find(table: string, o?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            finds.push(String(o?.where?.type));
            const matched = Array.from(rows.values()).filter((r) => match(r, o?.where ?? {}));
            return typeof o?.limit === 'number' ? matched.slice(0, o.limit) : matched;
        },
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, o);
            if (table !== 'sys_metadata') return null;
            for (const r of rows.values()) if (match(r, o?.where ?? {})) return r;
            return null;
        },
        async count() {
            return 0;
        },
        // No `insert` / `update` / `delete`: every case here is refused before
        // anything is persisted.
        registry: {
            registerItem: () => {}, registerObject: () => {}, listItems: () => [],
            getItem: () => undefined, getArtifactItem: () => undefined,
            removeRuntimeShadow: () => false, removeOverlayEntry: () => {}, uninstallPackage: () => {},
            getPackage: (id: string) => (id === PKG ? { manifest: { id } } : undefined),
        },
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    return { protocol, finds };
}

async function refusal(seed: Row[], fields: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<any> {
    const { protocol } = makeKernel(seed);
    return refusalOf(protocol, fields, extra);
}

async function refusalOf(protocol: any, fields: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<any> {
    try {
        await protocol.saveMetaItem({ type: 'object', name: 'crm_lead', item: { name: 'crm_lead', label: 'Lead', fields }, ...extra });
    } catch (e: any) {
        return e;
    }
    throw new Error('expected saveMetaItem to refuse the destructive change');
}

const withoutStatus = { name: FIELDS.name, note: FIELDS.note };

describe('a refused field removal names the views and forms that still show the field', () => {
    it('names the list view and the form on the field_removed finding', async () => {
        const err = await refusal([leadObject, leadList, leadForm], withoutStatus);
        expect(err.code).toBe('DESTRUCTIVE_CHANGE');
        expect(err.status).toBe(409);
        const removed = err.issues.find((i: any) => i.code === 'field_removed' && i.field === 'status');
        expect(removed.stillShownBy).toEqual([
            { type: 'view', name: 'crm_lead_open', where: ['columns[1]', 'filter[0]'] },
            { type: 'view', name: 'crm_lead_edit', where: ['sections[0].fields[1]'] },
        ]);
        // …and its prose names them too, so a face that carries only the message still says so.
        expect(removed.message).toContain('view "crm_lead_open"');
        expect(removed.message).toContain('view "crm_lead_edit"');
    });

    it('names nothing for a removed field no item shows (computed, empty)', async () => {
        const err = await refusal([leadObject, leadList, leadForm], { name: FIELDS.name, status: FIELDS.status });
        const removed = err.issues.find((i: any) => i.code === 'field_removed' && i.field === 'note');
        expect(removed.stillShownBy).toEqual([]);
    });

    it('reaches the wire unchanged on the HTTP doors (the shared thrown-error rule)', async () => {
        const err = await refusal([leadObject, leadList, leadForm], withoutStatus, { writeFace: 'meta-envelope' });
        const wire = resolveThrownHttpError(err, 500) as any;
        expect(wire.status).toBe(409);
        expect(wire.code).toBe('DESTRUCTIVE_CHANGE');
        const names = wire.details.issues
            .flatMap((i: any) => i.stillShownBy ?? [])
            .map((s: any) => s.name);
        expect(names).toEqual(expect.arrayContaining(['crm_lead_open', 'crm_lead_edit']));
    });

    it('names both on the MCP draft door\'s save (draft mode, meta-dispatch face)', async () => {
        const err = await refusal([leadObject, leadList, leadForm], withoutStatus, {
            mode: 'draft', surface: 'mcp', writeFace: 'meta-dispatch', packageId: PKG,
        });
        expect(err.code).toBe('DESTRUCTIVE_CHANGE');
        const removed = err.issues.find((i: any) => i.code === 'field_removed' && i.field === 'status');
        expect(removed.stillShownBy.map((s: any) => s.name)).toEqual(expect.arrayContaining(['crm_lead_open', 'crm_lead_edit']));
    });

    it('reads each type\'s served listing a fixed number of times, however many items it holds', async () => {
        // The view listing is read (a positive count, so the bound cannot pass
        // with no reads), and five more view items add no read at all.
        const viewReads = async (seed: Row[]): Promise<number> => {
            const { protocol, finds } = makeKernel(seed);
            await refusalOf(protocol, withoutStatus);
            return finds.filter((t) => t === 'view').length;
        };
        const extra = [1, 2, 3, 4, 5].map((n) => row('view', `crm_lead_extra_${n}`, {
            name: `crm_lead_extra_${n}`, viewKind: 'list', object: 'crm_lead', type: 'grid', columns: ['status'],
        }));
        const one = await viewReads([leadObject, leadList]);
        const six = await viewReads([leadObject, leadList, ...extra]);
        expect(one).toBeGreaterThan(0);
        expect(six).toBe(one);
    });

    it('names a served view item at its config positions', async () => {
        const err = await refusal([leadObject, leadItem], withoutStatus);
        const removed = err.issues.find((i: any) => i.code === 'field_removed' && i.field === 'status');
        expect(removed.stillShownBy).toEqual([
            {
                type: 'view',
                name: 'crm_lead.pipeline',
                where: ['config.columns[1]', 'config.filter[0]', 'config.userFilters.tabs[0].filter[0]'],
            },
        ]);
    });

    it('names a dashboard card that shows the field through a dataset (via)', async () => {
        const err = await refusal([leadObject, leadDataset, leadDashboard], withoutStatus);
        const removed = err.issues.find((i: any) => i.code === 'field_removed' && i.field === 'status');
        expect(removed.stillShownBy).toEqual([
            { type: 'dataset', name: 'lead_stats', where: ['dimensions[0]'] },
            { type: 'dashboard', name: 'lead_board', where: ['widgets[1]'], via: 'lead_stats' },
        ]);
        expect(removed.message).toContain('through dataset "lead_stats"');
    });

    it('leaves stillShownBy absent, not [], when a listing cannot be read, and still refuses', async () => {
        // The served `dashboard` listing fails; every other listing answers.
        const { protocol } = makeKernel([leadObject, leadList, leadForm]);
        const served = protocol.getMetaItems.bind(protocol);
        vi.spyOn(protocol, 'getMetaItems').mockImplementation(async (request: any) => {
            if (request?.type === 'dashboard') throw new Error('fixture: the dashboard listing is unreadable');
            return served(request);
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const err = await refusalOf(protocol, withoutStatus).finally(() => warn.mockRestore());
        expect(err.code).toBe('DESTRUCTIVE_CHANGE');
        expect(err.status).toBe(409);
        const removed = err.issues.find((i: any) => i.code === 'field_removed' && i.field === 'status');
        expect(removed).toBeDefined();
        expect('stillShownBy' in removed).toBe(false);
    });

    it('still refuses when naming the items throws, with stillShownBy absent', async () => {
        // A listing answer that is not a list makes the namer throw past its
        // own read guard; the save's call site must catch it rather than let
        // the enclosing catch read it as "skip the safety check".
        const { protocol } = makeKernel([leadObject, leadList, leadForm]);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(protocol, 'getMetaItems').mockResolvedValue({ type: 'view', items: 7 });
        try {
            const err = await refusalOf(protocol, { ...FIELDS, status: { name: 'status', type: 'number' } });
            expect(err.code).toBe('DESTRUCTIVE_CHANGE');
            expect(err.status).toBe(409);
            const retyped = err.issues.find((i: any) => i.code === 'field_type_change' && i.field === 'status');
            expect(retyped).toBeDefined();
            expect('stillShownBy' in retyped).toBe(false);
        } finally {
            warn.mockRestore();
        }
    });

    it('produces findings the declared wire shape parses (DestructiveChangeIssueSchema)', async () => {
        const err = await refusal([leadObject, leadList, leadForm, leadDataset, leadDashboard], withoutStatus);
        const removed = err.issues.find((i: any) => i.code === 'field_removed' && i.field === 'status');
        expect(removed.stillShownBy.length).toBeGreaterThan(0);
        for (const issue of err.issues) {
            const parsed = DestructiveChangeIssueSchema.safeParse(issue);
            expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
        }
    });
});

describe('a refused type change names the list-view filters whose operator no longer fits', () => {
    it('names the view filter whose text operator the new number type refuses', async () => {
        const err = await refusal([leadObject, leadList, leadForm], {
            ...FIELDS, status: { name: 'status', type: 'number' },
        });
        const retyped = err.issues.find((i: any) => i.code === 'field_type_change' && i.field === 'status');
        expect(retyped.stillShownBy).toEqual([
            { type: 'view', name: 'crm_lead_open', where: ['filter[0]'], operator: 'contains' },
        ]);
    });

    it('names a served view item\'s config filter and its userFilters tab filter', async () => {
        const err = await refusal([leadObject, leadItem], { ...FIELDS, status: { name: 'status', type: 'number' } });
        const retyped = err.issues.find((i: any) => i.code === 'field_type_change' && i.field === 'status');
        expect(retyped.stillShownBy).toEqual([{
            type: 'view',
            name: 'crm_lead.pipeline',
            where: ['config.filter[0]', 'config.userFilters.tabs[0].filter[0]'],
            operator: 'contains',
        }]);
    });
});
