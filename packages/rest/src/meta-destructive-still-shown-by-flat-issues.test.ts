// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The REST `PUT /api/v1/meta/:type/:name` door answers a `409
 * DESTRUCTIVE_CHANGE` refusal in its flat dialect: `issues` sits at the top
 * level of the body, beside `code` (`error-response.ts`). Each `field_removed`
 * finding there carries `stillShownBy`, the items that still show the field
 * (`DestructiveChangeIssueSchema` in `@objectstack/spec/api`).
 *
 * Driven end to end on the error leg: the REAL producer (`saveMetaItem` over a
 * `sys_metadata` double) refuses, and the door's own writer
 * (`handleRouteError`, the catch of the meta write routes) answers. The answer
 * is non-empty: a list view shows the removed column.
 */

import { describe, expect, it, vi } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { handleRouteError } from './error-response.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum: string;
    version: number;
}

const PKG = 'com.acme.crm';

const row = (type: string, name: string, body: Record<string, unknown>): Row => ({
    id: `row_${type}_${name}`, type, name,
    organization_id: null, package_id: PKG, state: 'active',
    metadata: JSON.stringify(body), checksum: 'sha256_35147_rest_fixture', version: 1,
});

const FIELDS = {
    name: { name: 'name', type: 'text' },
    status: { name: 'status', type: 'text' },
};

const SEED = [
    row('object', 'crm_lead', { name: 'crm_lead', label: 'Lead', fields: FIELDS }),
    row('view', 'crm_lead_open', {
        name: 'crm_lead_open', viewKind: 'list', object: 'crm_lead', type: 'grid',
        data: { provider: 'object', object: 'crm_lead' }, columns: ['name', 'status'],
    }),
];

const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

function protocolOver(seed: Row[]) {
    const rows = new Map<string, Row>(seed.map((r) => [r.id, r]));
    const match = (r: Row, where: Record<string, unknown>): boolean =>
        Object.entries(where ?? {}).every(([k, v]) => {
            if (k === '$or') return (v as Array<Record<string, unknown>>).some((c) => match(r, c));
            return v === null || v === undefined
                ? (r as any)[k] === null || (r as any)[k] === undefined
                : whereValueMatches((r as any)[k], v);
        });
    const engine: any = {
        async find(table: string, o?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
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
        // No `insert` / `update` / `delete`: the save is refused before anything is persisted.
        registry: {
            registerItem: () => {}, registerObject: () => {}, listItems: () => [],
            getItem: () => undefined, getArtifactItem: () => undefined,
            removeRuntimeShadow: () => false, removeOverlayEntry: () => {}, uninstallPackage: () => {},
            getPackage: (id: string) => (id === PKG ? { manifest: { id } } : undefined),
        },
    };
    return new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        send: vi.fn(),
        header: vi.fn(),
    };
    return res;
}

describe('REST flat 409 DESTRUCTIVE_CHANGE body carries stillShownBy', () => {
    it('names the list view that still shows a removed column, in the top-level issues', async () => {
        const protocol = protocolOver(SEED);
        let thrown: unknown;
        try {
            await protocol.saveMetaItem({
                type: 'object', name: 'crm_lead', writeFace: 'meta-envelope',
                item: { name: 'crm_lead', label: 'Lead', fields: { name: FIELDS.name } },
            });
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeDefined();
        const res = mockRes();
        handleRouteError(res, thrown);
        expect(res.statusCode).toBe(409);
        expect(res._body.code).toBe('DESTRUCTIVE_CHANGE');
        const removed = res._body.issues.find((i: any) => i.code === 'field_removed' && i.field === 'status');
        expect(removed.stillShownBy).toEqual([{ type: 'view', name: 'crm_lead_open', where: ['columns[1]'] }]);
    });
});
