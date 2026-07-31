// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4326 — read decorations must not round-trip into the persisted body.
 *
 * `getMetaItem`/`getMetaItems` stamp `_diagnostics` on every served document
 * (and `_draft` on draft reads), while the write path persists the request body
 * VERBATIM by design (ADR-0005 §Validation — `parsed.data` would strip
 * Studio-only auxiliary fields). The standard Studio round-trip therefore used
 * to bake a read-time verdict into `sys_metadata.metadata`, into its checksum,
 * and into every history diff.
 *
 * Nothing user-visible was ever wrong — reads recompute and the fresh verdict
 * shadows the stale one — which is exactly why this needs a pin: the invariant
 * being protected is "a GET → PUT round-trip persists a byte-identical body",
 * and only the stored bytes can show it.
 */
import { describe, expect, it } from 'vitest';
import { ObjectStackProtocolImplementation, stripReadDecorations } from './index.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
    version?: number;
}

function matches(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        if ((r as any)[k] !== v) return false;
    }
    return true;
}

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

function makeStubEngine() {
    const rows = new Map<string, Row>();
    let nextId = 0;
    const findRow = (w: Record<string, unknown>) => {
        for (const [k, r] of rows) if (matches(r, w)) return { key: k, row: r };
        return null;
    };
    const engine: any = {
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            return findRow(opts.where)?.row ?? null;
        },
        async find(_t: string, opts: { where: Record<string, unknown> }) {
            return Array.from(rows.values()).filter((r) => matches(r, opts.where));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table !== 'sys_metadata') return { id: 'side_table' };
            const row = { id: `r_${++nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            if (table !== 'sys_metadata') return { id: null };
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete() { return { deleted: 0 }; },
        async transaction<T>(cb: (ctx: any) => Promise<T>): Promise<T> { return cb(undefined); },
        async syncObjectSchema() { /* no DDL in this stub */ },
        registry: {
            listItems: () => [],
            isPackageDisabled: () => false,
            getItem: () => undefined,
            registerItem: () => {},
            registerObject: () => {},
            getPackage: () => undefined,
        },
    };
    return { engine, rows };
}

const storedBody = (rows: Map<string, Row>, name: string) => {
    const row = Array.from(rows.values()).find((r) => r.name === name)!;
    return JSON.parse(row.metadata);
};

const objectBody = (name: string) => ({
    name,
    label: 'Invoice',
    fields: { amount: { type: 'currency', label: 'Amount' } },
});

describe('stripReadDecorations (#4326)', () => {
    it('removes the read-only decorations', () => {
        const out = stripReadDecorations({
            name: 'x', _diagnostics: { valid: true }, _draft: true,
        }) as Record<string, unknown>;
        expect(out).toEqual({ name: 'x' });
    });

    it('returns the SAME reference when there is nothing to strip', () => {
        const body = { name: 'x', label: 'X' };
        expect(stripReadDecorations(body)).toBe(body);
    });

    it('leaves the ADR-0010 protection envelope and package provenance alone', () => {
        // These share the underscore spelling but are envelope state the write
        // path legitimately carries — stripping them would loosen a packaged lock.
        const body = {
            name: 'x',
            _lock: 'full',
            _lockReason: 'shipped by package',
            _provenance: 'package',
            _packageId: 'app.crm',
            _diagnostics: { valid: false },
        };
        const out = stripReadDecorations(body) as Record<string, unknown>;
        expect(out).toEqual({
            name: 'x',
            _lock: 'full',
            _lockReason: 'shipped by package',
            _provenance: 'package',
            _packageId: 'app.crm',
        });
    });

    it('passes non-object input through untouched', () => {
        expect(stripReadDecorations(null)).toBe(null);
        expect(stripReadDecorations('str')).toBe('str');
        const arr = [{ _diagnostics: {} }];
        expect(stripReadDecorations(arr)).toBe(arr);
    });

    it('does not mutate the caller input', () => {
        const body = { name: 'x', _diagnostics: { valid: true } };
        stripReadDecorations(body);
        expect(body._diagnostics).toEqual({ valid: true });
    });
});

describe('saveMetaItem — the Studio round-trip persists a byte-identical body (#4326)', () => {
    it('GET → PUT the whole served document stores no _diagnostics', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        const authored = objectBody('crm_invoice');
        await protocol.saveMetaItem({ type: 'object', name: 'crm_invoice', item: authored });
        const firstStored = storedBody(rows, 'crm_invoice');

        // What Studio actually holds: the SERVED document, decorations included.
        const served: any = (await protocol.getMetaItem({ type: 'object', name: 'crm_invoice' })).item;
        expect(served._diagnostics).toBeDefined(); // precondition — the read does decorate

        // Edit one label and PUT the whole thing back, as the designer does.
        await protocol.saveMetaItem({
            type: 'object',
            name: 'crm_invoice',
            item: { ...served, label: 'Invoice (edited)' },
        });

        const stored = storedBody(rows, 'crm_invoice');
        expect('_diagnostics' in stored).toBe(false);
        expect(stored.label).toBe('Invoice (edited)');
        // Everything except the edited key is byte-identical to the first save.
        expect({ ...stored, label: firstStored.label }).toEqual(firstStored);
    });

    it('a draft read PUT back does not persist the _draft preview badge', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({
            type: 'object', name: 'crm_quote', item: objectBody('crm_quote'), mode: 'draft',
        });
        // The badge comes from the PREVIEW read (`previewDrafts`), which is what
        // the designer's "preview pending changes" surface calls — a plain
        // `state: 'draft'` read returns the body unbadged.
        const draft: any = (await protocol.getMetaItem({
            type: 'object', name: 'crm_quote', previewDrafts: true,
        })).item;
        expect(draft._draft).toBe(true); // precondition — the preview read badges

        await protocol.saveMetaItem({
            type: 'object', name: 'crm_quote', item: draft, mode: 'draft',
        });

        const stored = storedBody(rows, 'crm_quote');
        expect('_draft' in stored).toBe(false);
        expect('_diagnostics' in stored).toBe(false);
        // Draft-ness lives in the row's state column, not the body.
        expect(Array.from(rows.values()).find((r) => r.name === 'crm_quote')!.state).toBe('draft');
    });

    it('keeps the checksum stable across a decoration-only round-trip', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({ type: 'object', name: 'crm_lead', item: objectBody('crm_lead') });
        const before = Array.from(rows.values()).find((r) => r.name === 'crm_lead')!.checksum;

        // Re-save the served document unchanged — the only difference is our own
        // decoration, so the content hash must not move.
        const served: any = (await protocol.getMetaItem({ type: 'object', name: 'crm_lead' })).item;
        await protocol.saveMetaItem({ type: 'object', name: 'crm_lead', item: served });

        const after = Array.from(rows.values()).find((r) => r.name === 'crm_lead')!.checksum;
        expect(after).toBe(before);
    });
});
