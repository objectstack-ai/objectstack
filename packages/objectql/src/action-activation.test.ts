// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#12160] ADR-0126 §8 item 2 — the packaged-ACTION activation ledger, from
// the maintainer's amendment ruling 3 (2026-08-25, verbatim and untranslated):
//
//   > 「动作 可能是需要开关的，因为有的 action 我不想启用。」
//
// ## What this file pins, and why each half exists
//
// 1. **The ROW contract** (ADR-0126 §4), because the ledger is shared: an
//    `action` writer that touched a flow row, or read one, would corrupt a
//    neighbour's state through a table both are told to treat as generic.
//    Pinned on both sides — the discriminator is in the read AND in the write.
// 2. **`organization_id` stays NULL**, which is the whole of §5's install-level
//    scope on this line. Asserted as an ABSENT key rather than a null value:
//    writing it explicitly would be a different row shape, and the one the
//    reserved per-org dimension is not.
// 3. **Absence means ACTIVE.** The stock-boot state is "no rows", and it must
//    change nothing anywhere (§4). A projection that defaulted the other way
//    would switch off an entire installation's actions on its first boot.
// 4. **The write is durable BEFORE it is local.** A store that throws must
//    leave the projection untouched, or the engine reports an activation state
//    the ledger does not carry — the #10243 shape with persistence bolted on,
//    which ADR-0126 §7.2 exists to remove.
// 5. **Survives re-registration**, which is the in-process half of "survives a
//    restart": `resyncAuthoredActions` re-registers handlers on every
//    `metadata:reloaded`, and a re-registered handler must stay switched off.

import { describe, it, expect, vi } from 'vitest';

import { ObjectQL } from './engine.js';
import {
    ActionActivationProjection,
    InMemoryActionActivationStore,
    ObjectStoreActionActivationStore,
    type ActionActivationStore,
} from './action-activation.js';

const TABLE = 'sys_metadata_activation';

/**
 * A store engine that records what it was asked, and answers `find` from a
 * fixed row set filtered by the WHERE it was given.
 *
 * The filter is applied rather than ignored on purpose: a store that scoped its
 * read by `metadata_type` and a double that answered every row regardless would
 * pin nothing about the discriminator — the exact hole this file's first
 * assertion exists to close.
 */
function makeStoreEngine(rows: any[] = []) {
    const calls: Array<{ op: string; object: string; data?: any; options?: any }> = [];
    const matches = (row: any, where: any): boolean =>
        Object.entries(where ?? {}).every(([k, v]) => row?.[k] === v);
    const engine = {
        find: vi.fn(async (object: string, options?: any) => {
            calls.push({ op: 'find', object, options });
            return rows.filter((r) => matches(r, options?.where));
        }),
        insert: vi.fn(async (object: string, data: any, options?: any) => {
            calls.push({ op: 'insert', object, data, options });
            return { id: 'row_new', ...data };
        }),
        update: vi.fn(async (object: string, data: any, options?: any) => {
            calls.push({ op: 'update', object, data, options });
            return data;
        }),
    };
    return { engine, calls };
}

describe('ObjectStoreActionActivationStore — the ADR-0126 §4 row contract', () => {
    it('reads only `metadata_type: \'action\'` rows, and never a flow neighbour', async () => {
        const { engine } = makeStoreEngine([
            { id: 'r1', metadata_type: 'action', name: 'convert_lead', package_id: 'crm', active: false },
            { id: 'r2', metadata_type: 'flow', name: 'convert_lead', package_id: 'crm', active: false },
        ]);

        const rows = await new ObjectStoreActionActivationStore(engine).list();

        expect(rows).toEqual([{ name: 'convert_lead', packageId: 'crm', active: false }]);
        expect(engine.find).toHaveBeenCalledWith(TABLE, expect.objectContaining({
            where: { metadata_type: 'action' },
        }));
    });

    it('SKIPS a row carrying an organization_id — the per-org dimension is reserved (§5)', async () => {
        const { engine } = makeStoreEngine([
            { id: 'r1', metadata_type: 'action', name: 'install_wide', package_id: 'crm', active: false },
            {
                id: 'r2', metadata_type: 'action', name: 'org_scoped', package_id: 'crm',
                active: false, organization_id: 'org_northwind',
            },
        ]);

        const rows = await new ObjectStoreActionActivationStore(engine).list();

        // Reading it as install-level would apply ONE organization's choice to
        // the whole installation — #10243 arrived at from the read side.
        expect(rows.map((r) => r.name)).toEqual(['install_wide']);
    });

    it('reads a driver `0` as DISABLED, not as truthy-by-accident', async () => {
        // SQLite/libsql round-trip booleans as 0/1; a `!row.active === false`
        // style test would arm every action a SQLite deployment disabled.
        const { engine } = makeStoreEngine([
            { id: 'r1', metadata_type: 'action', name: 'off_zero', package_id: 'p', active: 0 },
            { id: 'r2', metadata_type: 'action', name: 'on_one', package_id: 'p', active: 1 },
            { id: 'r3', metadata_type: 'action', name: 'on_default', package_id: 'p' },
        ]);

        const rows = await new ObjectStoreActionActivationStore(engine).list();

        expect(rows.find((r) => r.name === 'off_zero')?.active).toBe(false);
        expect(rows.find((r) => r.name === 'on_one')?.active).toBe(true);
        // No `active` column value at all — the column defaults to true, so
        // only an explicit false disarms.
        expect(rows.find((r) => r.name === 'on_default')?.active).toBe(true);
    });

    it('INSERTS the discriminator and NO organization_id when there is no row yet', async () => {
        const { engine } = makeStoreEngine([]);

        await new ObjectStoreActionActivationStore(engine).setActive({
            name: 'convert_lead', packageId: 'crm', active: false,
        });

        expect(engine.insert).toHaveBeenCalledTimes(1);
        const [object, data] = engine.insert.mock.calls[0];
        expect(object).toBe(TABLE);
        expect(data).toEqual({
            metadata_type: 'action', name: 'convert_lead', package_id: 'crm', active: false,
        });
        // Absent, not null: omitting the column is what leaves it NULL, and the
        // `unique: 'organization'` index collapses NULL for row identity.
        expect(Object.keys(data)).not.toContain('organization_id');
        expect(engine.update).not.toHaveBeenCalled();
    });

    it('UPDATES the existing install-level row rather than writing a second one', async () => {
        const { engine } = makeStoreEngine([
            { id: 'row_1', metadata_type: 'action', name: 'convert_lead', package_id: 'crm', active: false },
        ]);

        await new ObjectStoreActionActivationStore(engine).setActive({
            name: 'convert_lead', packageId: 'crm', active: true,
        });

        expect(engine.insert).not.toHaveBeenCalled();
        expect(engine.update).toHaveBeenCalledWith(
            TABLE,
            { id: 'row_1', active: true, package_id: 'crm' },
            expect.anything(),
        );
    });

    it('re-enabling UPDATES the row instead of deleting it — the ledger records choices (§6 wall 3)', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'row_1', metadata_type: 'action', name: 'convert_lead', package_id: 'crm', active: false },
        ]);

        await new ObjectStoreActionActivationStore(engine).setActive({
            name: 'convert_lead', packageId: 'crm', active: true,
        });

        // The row is REWRITTEN, never removed: an administrator's choice to
        // re-enable is itself a recorded choice. The store's engine slice is
        // three methods wide and carries no `delete` at all, so "it stopped
        // deleting" cannot regress into "it deletes again" without the
        // interface changing — this asserts the observable half.
        expect(calls.map((c) => c.op)).toEqual(['find', 'update']);
        expect(calls[1].data).toEqual({ id: 'row_1', active: true, package_id: 'crm' });
    });

    it('probe() reads the table so a missing ledger surfaces at BOOT', async () => {
        const engine = {
            find: vi.fn(async () => { throw new Error('no such table: sys_metadata_activation'); }),
            insert: vi.fn(), update: vi.fn(),
        };

        await expect(new ObjectStoreActionActivationStore(engine).probe())
            .rejects.toThrow(/no such table: sys_metadata_activation/);
    });
});

describe('ActionActivationProjection — absence means ACTIVE', () => {
    it('an engine with no ledger attached disables nothing and hydrates to nothing', async () => {
        const projection = new ActionActivationProjection();

        expect(await projection.hydrate()).toEqual([]);
        expect(projection.isEnabled('anything_at_all')).toBe(true);
        expect(projection.durable).toBe(false);
    });

    it('an EMPTY ledger changes nothing anywhere (ADR-0126 §4, the stock boot)', async () => {
        const projection = new ActionActivationProjection();
        projection.attach(new InMemoryActionActivationStore());

        expect(await projection.hydrate()).toEqual([]);
        expect(projection.isEnabled('convert_lead')).toBe(true);
        expect(projection.disabledNames()).toEqual([]);
    });

    it('hydrate() switches off exactly the rows that say so, and names them', async () => {
        const store = new InMemoryActionActivationStore();
        await store.setActive({ name: 'convert_lead', packageId: 'crm', active: false });
        await store.setActive({ name: 'send_quote', packageId: 'crm', active: true });
        const projection = new ActionActivationProjection();
        projection.attach(store);

        const off = await projection.hydrate();

        expect(off).toEqual(['convert_lead']);
        expect(projection.isEnabled('convert_lead')).toBe(false);
        expect(projection.isEnabled('send_quote')).toBe(true);
    });

    it('a row flipped back to active on a LATER boot re-arms the action', async () => {
        const store = new InMemoryActionActivationStore();
        await store.setActive({ name: 'convert_lead', packageId: 'crm', active: false });
        const first = new ActionActivationProjection();
        first.attach(store);
        await first.hydrate();
        expect(first.isEnabled('convert_lead')).toBe(false);

        await store.setActive({ name: 'convert_lead', packageId: 'crm', active: true });
        const second = new ActionActivationProjection();
        second.attach(store);
        await second.hydrate();

        expect(second.isEnabled('convert_lead')).toBe(true);
    });

    it('setActive writes the DURABLE row before the projection, and a failed write changes nothing', async () => {
        const failing: ActionActivationStore = {
            list: async () => [],
            setActive: async () => { throw new Error('datasource unreachable'); },
        };
        const projection = new ActionActivationProjection();
        projection.attach(failing);

        await expect(projection.setActive({ name: 'convert_lead', packageId: 'crm', active: false }))
            .rejects.toThrow(/datasource unreachable/);
        // The load-bearing half: a reported flip that did not persist is the
        // failure this leg exists to remove, so the process state must not
        // have moved either.
        expect(projection.isEnabled('convert_lead')).toBe(true);
    });

    it('refuses the flip when no ledger is attached — ⛔ no in-process fallback', async () => {
        const projection = new ActionActivationProjection();

        const thrown = await projection
            .setActive({ name: 'convert_lead', packageId: 'crm', active: false })
            .catch((e) => e);

        // ADR-0112 envelope: code AND status, so the door serves it honestly
        // instead of a 500.
        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as any).code).toBe('SERVICE_UNAVAILABLE');
        expect((thrown as any).status).toBe(503);
        expect(String(thrown.message)).toMatch(/sys_metadata_activation/);
        expect(projection.isEnabled('convert_lead')).toBe(true);
    });

    it('the refusal sentence names the ledger and the remedies — and ⛔ never a clone', () => {
        const projection = new ActionActivationProjection();

        const message = projection.describeDisabled('convert_lead');

        expect(message).toContain("Action 'convert_lead' is disabled");
        expect(message).toContain('sys_metadata_activation');
        expect(message).toContain('ADR-0126 §8');
        // Action-CLONE is not chartered (§8 item 2). Recommending one would
        // advertise machinery that does not exist — the FLOW refusal says
        // "clone", and this one must not inherit that sentence.
        expect(message).not.toMatch(/clone/i);
    });
});

describe('ObjectQL engine — the projection the dispatch doors consult', () => {
    it('answers `true` for everything on a stock boot', async () => {
        const engine = new ObjectQL();

        expect(engine.isActionEnabled('convert_lead')).toBe(true);
        expect(await engine.hydrateActionActivations()).toEqual([]);
        expect(engine.listDisabledActions()).toEqual([]);
    });

    it('hydrates the ledger and REFUSES to re-arm on handler re-registration', async () => {
        const engine = new ObjectQL();
        const store = new InMemoryActionActivationStore();
        await store.setActive({ name: 'convert_lead', packageId: 'crm', active: false });
        engine.setActionActivationStore(store);

        expect(await engine.hydrateActionActivations()).toEqual(['convert_lead']);
        expect(engine.isActionEnabled('convert_lead')).toBe(false);

        // `resyncAuthoredActions` tears down and re-registers the whole
        // metadata-service action set on every `metadata:reloaded`. The ledger
        // projection is not part of that churn, and this is the in-process half
        // of "the disable survives a restart".
        engine.registerAction('crm_lead', 'convert_lead', async () => ({ ran: true }), 'metadata-service');

        expect(engine.isActionEnabled('convert_lead')).toBe(false);
        expect(engine.describeDisabledAction('convert_lead')).toContain('ADR-0126 §8');
    });

    it('setActionActive flips the row and the projection together, in that order', async () => {
        const engine = new ObjectQL();
        const store = new InMemoryActionActivationStore();
        engine.setActionActivationStore(store);

        await engine.setActionActive({ name: 'convert_lead', packageId: 'crm', active: false });
        expect(engine.isActionEnabled('convert_lead')).toBe(false);
        expect(await store.list()).toEqual([{ name: 'convert_lead', packageId: 'crm', active: false }]);

        await engine.setActionActive({ name: 'convert_lead', packageId: 'crm', active: true });
        expect(engine.isActionEnabled('convert_lead')).toBe(true);
        expect(await store.list()).toEqual([{ name: 'convert_lead', packageId: 'crm', active: true }]);
    });

    it('⛔ executeAction does NOT consult the ledger — the key is not the identity (ADR-0110 D2)', async () => {
        // A target-bound script action registers under its `target`, so a check
        // inside `executeAction` would be asking a question the arguments
        // cannot answer. The consult lives at the declaration-resolving doors;
        // this pins that the engine seam deliberately stays out of it, so a
        // later edit that "helpfully" adds a check there has to argue with a
        // test instead of silently half-gating every target-bound action.
        const engine = new ObjectQL();
        const store = new InMemoryActionActivationStore();
        await store.setActive({ name: 'convert_lead', packageId: 'crm', active: false });
        engine.setActionActivationStore(store);
        await engine.hydrateActionActivations();
        const handler = vi.fn(async () => ({ ran: true }));
        engine.registerAction('crm_lead', 'convert_lead_impl', handler);

        await expect(engine.executeAction('crm_lead', 'convert_lead_impl', {})).resolves.toEqual({ ran: true });
        expect(handler).toHaveBeenCalledTimes(1);
    });
});
