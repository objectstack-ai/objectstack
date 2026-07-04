// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

/**
 * #2555 — a console personalization PUT (grid column sort, inline edit, …)
 * sends only the raw view config: no top-level `viewKind`/`object`. Pre-fix,
 * `saveMetaItem` persisted it verbatim and `getMetaItems` replaced the
 * flattened package entry with the overlay row wholesale, so the identity
 * fields vanished and the view switcher endpoint (which filters on
 * `viewKind && object`) dropped the view permanently.
 *
 * Two independent guards are covered here end-to-end against a stubbed engine:
 *   • write path — `saveMetaItem` inherits the identity fields from the
 *     registry entry the overlay shadows before persisting;
 *   • read path — `getMetaItems` heals identity-less rows already in the DB
 *     (persisted by pre-fix saves) from the shadowed registry entry.
 */

// The flattened package entry `expandViewContainer` produces for the
// showcase's default task grid — the entry the runtime overlay shadows.
const flattened = {
    name: 'showcase_task.default',
    object: 'showcase_task',
    viewKind: 'list',
    label: 'All Tasks',
    scope: 'package',
    config: { type: 'grid', data: { provider: 'object', object: 'showcase_task' }, columns: ['title'] },
};

// What the console actually PUTs back on a column sort — the view's raw
// config plus personalization state, no identity fields (captured from the
// sys_metadata row in the 3777 repro).
const personalization = {
    type: 'grid',
    data: { provider: 'object', object: 'showcase_task' },
    columns: ['title'],
    sort: [{ id: '29200fa8-c416-471e-9ca3-913f9308ad89', field: 'estimate_hours', order: 'desc' }],
};

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    metadata: string;
    package_id?: string | null;
}

function makeStubEngine(registryViews: Record<string, unknown> = {}) {
    const rows = new Map<string, Row>();
    let nextId = 0;
    const keyOf = (w: Record<string, unknown>) => `${w.type}|${w.name}|${w.organization_id ?? '__env__'}`;
    const findRow = (w: Record<string, unknown>) => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        const r = rows.get(keyOf(w));
        return r ? { key: keyOf(w), row: r } : null;
    };
    const engine: any = {
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            return findRow(opts.where)?.row ?? null;
        },
        async find(_t: string, opts: { where: Record<string, unknown> }) {
            return Array.from(rows.values()).filter((r) => {
                if (opts.where.type && r.type !== opts.where.type) return false;
                if (opts.where.organization_id !== undefined && r.organization_id !== opts.where.organization_id) return false;
                if (opts.where.state && r.state !== opts.where.state) return false;
                return true;
            });
        },
        async insert(_t: string, data: Record<string, unknown>) {
            if (_t === 'sys_metadata_audit') return { id: 'audit_skip' };
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            const found = findRow(opts.where);
            if (!found) return { id: null };
            rows.set(found.key, { ...found.row, ...(data as any) });
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            getItem: (type: string, name: string) => (type === 'view' || type === 'views') ? registryViews[name] : undefined,
            listItems: (type: string) => (type === 'view' || type === 'views') ? Object.values(registryViews) : [],
            isPackageDisabled: () => false,
        },
    };
    return { engine, rows };
}

describe('view overlay identity (#2555)', () => {
    it('write path: saveMetaItem inherits viewKind/object/label from the shadowed registry entry', async () => {
        const { engine, rows } = makeStubEngine({ 'showcase_task.default': flattened });
        const protocol = new ObjectStackProtocolImplementation(engine);
        const result = await protocol.saveMetaItem({
            type: 'view',
            name: 'showcase_task.default',
            item: { ...personalization },
        });
        expect(result.success).toBe(true);
        const row = Array.from(rows.values()).find((r) => r.type === 'view');
        expect(row).toBeTruthy();
        const persisted = JSON.parse(row!.metadata);
        // Identity inherited…
        expect(persisted.viewKind).toBe('list');
        expect(persisted.object).toBe('showcase_task');
        expect(persisted.label).toBe('All Tasks');
        expect(persisted.name).toBe('showcase_task.default');
        // …and the personalization survives untouched.
        expect(persisted.sort).toEqual(personalization.sort);
    });

    it('read path: getMetaItems heals a pre-fix identity-less overlay row from the shadowed entry', async () => {
        const { engine } = makeStubEngine({ 'showcase_task.default': flattened });
        // Seed the DB with a PRE-fix row: raw config + name, no identity.
        await engine.insert('sys_metadata', {
            type: 'view',
            name: 'showcase_task.default',
            organization_id: null,
            state: 'active',
            metadata: JSON.stringify({ ...personalization, name: 'showcase_task.default' }),
        });
        const protocol = new ObjectStackProtocolImplementation(engine);
        const items = ((await protocol.getMetaItems({ type: 'view' })) as any).items as any[];
        const item = items.find((i) => i?.name === 'showcase_task.default');
        expect(item).toBeTruthy();
        // The overlay still wins on content…
        expect(item.sort).toEqual(personalization.sort);
        // …but the identity fields the switcher filters on are back.
        expect(item.viewKind).toBe('list');
        expect(item.object).toBe('showcase_task');
        expect(item.label).toBe('All Tasks');
    });

    it("read path: an overlay's own identity fields are not clobbered by the shadowed entry", async () => {
        const { engine } = makeStubEngine({ 'showcase_task.default': flattened });
        await engine.insert('sys_metadata', {
            type: 'view',
            name: 'showcase_task.default',
            organization_id: null,
            state: 'active',
            metadata: JSON.stringify({
                ...personalization,
                name: 'showcase_task.default',
                viewKind: 'list',
                object: 'showcase_task',
                label: 'My Renamed Grid',
            }),
        });
        const protocol = new ObjectStackProtocolImplementation(engine);
        const items = ((await protocol.getMetaItems({ type: 'view' })) as any).items as any[];
        const item = items.find((i) => i?.name === 'showcase_task.default');
        expect(item.label).toBe('My Renamed Grid');
    });

    it('write path stays a plain name-stamp when the registry has no entry to inherit from', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const result = await protocol.saveMetaItem({
            type: 'view',
            name: 'adhoc.view',
            item: { ...personalization },
        });
        expect(result.success).toBe(true);
        const row = Array.from(rows.values()).find((r) => r.type === 'view');
        const persisted = JSON.parse(row!.metadata);
        expect(persisted.name).toBe('adhoc.view');
        expect('viewKind' in persisted).toBe(false);
    });
});
