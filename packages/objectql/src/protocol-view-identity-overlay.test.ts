// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { assertEngineDeleteDispatch } from './engine-delete-dispatch.js';
import { assertEngineUpdateDispatch } from './engine-update-dispatch.js';

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
            // [#5480] Pinned to ObjectQL.update's OWN dispatch predicate, the
            // twin of the delete pin below and on the same argument: this file
            // could bind one write verb to the producer and not the other only
            // because `update` had no shared predicate to bind to.
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            rows.set(found.key, { ...found.row, ...(data as any) });
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            // [#4550] Pinned to ObjectQL.delete's OWN dispatch predicate. A double
            // looser than the engine it stands in for is how #4434 shipped a REST
            // route that answered 500 to every caller with its suite green.
            assertEngineDeleteDispatch(opts);
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

    // #3095 — a standalone ViewItem record's `config` used to strip to `{}`
    // under the container ViewSchema, so a broken config saved with a false 200.
    // The `view` type now maps to the union schema that validates it genuinely.
    it('write path rejects a ViewItem whose kanban config is broken (422)', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await expect(
            protocol.saveMetaItem({
                type: 'view',
                name: 'crm_lead.pipeline',
                item: {
                    name: 'crm_lead.pipeline',
                    object: 'crm_lead',
                    viewKind: 'list',
                    // kanban config is missing the required groupByField.
                    config: { type: 'kanban', columns: ['name'], kanban: { summarizeField: 'amount', columns: ['name'] } },
                },
            }),
        ).rejects.toMatchObject({ code: 'INVALID_METADATA', status: 422 });
    });

    it('write path accepts a well-formed ViewItem record', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const result = await protocol.saveMetaItem({
            type: 'view',
            name: 'crm_lead.all',
            item: {
                name: 'crm_lead.all',
                object: 'crm_lead',
                viewKind: 'list',
                config: { type: 'grid', columns: ['name'], data: { provider: 'object', object: 'crm_lead' } },
            },
        });
        expect(result.success).toBe(true);
        expect(Array.from(rows.values()).some((r) => r.type === 'view')).toBe(true);
    });

    it('[#7741] write path REFUSES the adhoc PUT when the registry has no entry to inherit from', async () => {
        // ⚠️ Deliberate inversion (ruled 2026-08-12, direction B). This test
        // used to pin `success: true` for exactly this call — a raw config PUT
        // on a name no registry entry shadows, persisted as a plain name-stamp
        // with no identity. QA run #7695 measured what that row is: stored,
        // badged `valid: true`, and served by NO object-bound read path (the
        // switcher filters `v.viewKind && v.object`). The inline arms now
        // require the binding pair, and with no baseline to inherit it from,
        // the save 422s with the located guidance instead of minting the dead
        // row. A shadowING adhoc PUT (baseline present) still saves — that is
        // the first test in this describe.
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        let caught: any;
        try {
            await protocol.saveMetaItem({
                type: 'view',
                name: 'adhoc.view',
                item: { ...personalization },
            });
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeTruthy();
        // The ADR-0112 envelope, not a bare throw.
        expect(caught.code).toBe('INVALID_METADATA');
        expect(caught.status).toBe(422);
        // The located prescription reaches the 422's issues.
        const issues = JSON.stringify(caught.issues ?? []);
        expect(issues).toContain('names no `object`');
        expect(issues).toContain('defineView({ list: { type, data, columns,');
        // …and nothing was stored.
        expect(Array.from(rows.values()).filter((r) => r.type === 'view')).toHaveLength(0);
    });

    // ── #5599 — the write path's spec gate was bypassable by ANY body ────────
    //
    // #3095 (above) closed the case where a view's nested `config` was stripped
    // to `{}`. #5599 is the case one level further out: the union's fourth
    // member both `.strip()`s and requires nothing, so `{ nope: 1 }` MATCHED it,
    // the gate reported success, and — because `saveMetaItem` persists the
    // ORIGINAL body, not the parse output — `{"nope":1,"name":"garbage_view"}`
    // landed in `sys_metadata` as an ACTIVE view. `view` was the one common
    // overlay type whose declared spec validation (ADR-0005 §Validation) could
    // be bypassed outright: Prime Directive #10's "declared ≠ enforced", at the
    // union's member-selection layer rather than inside any member.
    //
    // Measured on `origin/main` before the fix, this exact call returned
    // `{ success: true, state: 'active', seq: 1 }`.
    it('#5599 write path REJECTS a body that is not a view at all (was: success + stored active)', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await expect(
            protocol.saveMetaItem({ type: 'view', name: 'garbage_view', item: { nope: 1 } }),
        ).rejects.toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        // The half that made this a data bug rather than a validation nit:
        // nothing may reach the store.
        expect(Array.from(rows.values()).some((r) => r.type === 'view')).toBe(false);
    });

    it('#5599 write path REJECTS an empty body, and stores nothing', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await expect(
            protocol.saveMetaItem({ type: 'view', name: 'empty_view', item: {} }),
        ).rejects.toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(Array.from(rows.values()).some((r) => r.type === 'view')).toBe(false);
    });

    it('#5599 the 422 carries the prescription, not a rootless "Invalid input"', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const failure = await protocol
            .saveMetaItem({ type: 'view', name: 'garbage_view', item: { nope: 1 } })
            .then(() => null, (e: unknown) => e);
        expect(failure).toBeTruthy();
        expect(JSON.stringify(failure)).toContain('no recognized `view` key');
    });

    it('#5599 …while the personalization PUT this file exists for still saves', async () => {
        // The regression this precondition must never cause: a 422 on a body the
        // platform itself writes. `personalization` is the captured console PUT.
        const { engine, rows } = makeStubEngine({ 'showcase_task.default': flattened });
        const protocol = new ObjectStackProtocolImplementation(engine);
        const result = await protocol.saveMetaItem({
            type: 'view',
            name: 'showcase_task.default',
            item: { ...personalization },
        });
        expect(result.success).toBe(true);
        expect(Array.from(rows.values()).some((r) => r.type === 'view')).toBe(true);
    });
});
