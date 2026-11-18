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

import { describe, expect, it } from 'vitest';
import { resolveThrownHttpError } from '@objectstack/types';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
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

    it('reads one served listing per type, not one read per item', async () => {
        const { protocol, finds } = makeKernel([leadObject, leadList, leadForm]);
        await protocol.saveMetaItem({ type: 'object', name: 'crm_lead', item: { name: 'crm_lead', fields: withoutStatus } }).catch(() => {});
        const viewReads = finds.filter((t) => t === 'view' || t === 'views');
        expect(viewReads.length).toBeLessThanOrEqual(2);
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
});
