// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#12350] ADR-0126 §4 — the activation-ledger row contract, now written ONCE
// and parameterized by `metadata_type`.
//
// ## What this file pins that neither consumer's suite can
//
// The two consumer suites — `flow-activation-ledger.test.ts` (packaged flows)
// and `action-activation.test.ts` (packaged actions) — are unchanged by the
// consolidation, deliberately: they pin the row contract from each binding's
// side, so their staying green IS the proof that moving the implementation
// lost nothing. What they cannot pin is the property that only exists now that
// there is one implementation:
//
//   1. **The discriminator is a PARAMETER, not a constant.** Each consumer
//      suite sees exactly one value, so both would stay green against a store
//      that had quietly hard-coded the other one's.
//   2. **Two bindings over one table do not see each other's rows** — in BOTH
//      directions, from the same store class. That is the drift the two copies
//      made possible (#12350's own argument: the discriminator scoping and the
//      `0`-is-false read are what a copy loses quietly), and it can only be
//      measured where both types are constructed side by side.
//   3. **A type nobody has written yet behaves the same.** ADR-0126 §8
//      pre-charts `tool` / `skill` / `position`; a third consumer must inherit
//      the semantics rather than re-derive them, and the cheapest proof is an
//      unknown discriminator asserted through the same battery.
//
// The load-bearing row properties themselves (the ledger is deployment-wide
// and carries no tenant column, absence means ACTIVE, a driver `0` reads as
// false) are pinned here too — this is where they now live, so this is where a
// change to them has to argue.

import { describe, it, expect, vi } from 'vitest';
// The real engine's OWN update-dispatch predicate, so the double below cannot
// accept a call `ObjectQL.update` refuses (`pnpm check:engine-double-contract`).
// `@objectstack/metadata-core` is where it lives precisely so packages on both
// sides of the engine can reach it without closing a dependency cycle.
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';

import {
    InMemoryMetadataActivationStore,
    METADATA_ACTIVATION_TABLE,
    ObjectStoreMetadataActivationStore,
} from './metadata-activation-store.js';

const TABLE = 'sys_metadata_activation';

/**
 * The double's WHERE predicate, at MODULE scope on purpose.
 *
 * `pnpm check:where-matcher` judges a matcher by LIFTING it — transpiling it
 * with the same-file declarations it references and running a combinator
 * battery against it. Declared inside the factory below, the lift would have to
 * carry that factory's scope, which reaches `vi` and fails to evaluate: the
 * gate then reports the matcher UNJUDGED, and unjudged is never treated as
 * passing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matches(row: any, where: any): boolean {
    return Object.entries(where ?? {}).every(([k, v]) => {
        // Equality ONLY, and a loud REFUSAL for anything else rather than a
        // quiet mismatch. A matcher with no combinator branch reads `$or` /
        // `$in` as a FIELD NAME, compares `row.$or` (undefined) against the
        // operand, matches nothing, and leaves the suite asserting on an empty
        // result set with nothing erroring — the silent-wrong class
        // `pnpm check:where-matcher` exists to catch. Refusing is the honest
        // answer for a double that only ever sees scalar equality: the store's
        // two reads are `{ metadata_type }` and `{ metadata_type, name }`, and
        // its probe is `{}`. Same refusal both consumer doubles carry.
        if (k.startsWith('$') || (v !== null && typeof v === 'object')) {
            throw new Error(
                `makeStoreEngine: unsupported WHERE combinator '${k}' — this double implements equality only`,
            );
        }
        return row?.[k] === v;
    });
}

/**
 * A store engine that records what it was asked and answers `find` from a fixed
 * row set filtered by the WHERE it was given.
 *
 * The filter is APPLIED rather than ignored on purpose: a store that scoped its
 * read by `metadata_type` and a double that answered every row regardless would
 * pin nothing about the discriminator — which is this file's whole subject.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeStoreEngine(rows: any[] = []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls: Array<{ op: string; object: string; data?: any; options?: any }> = [];
    const engine = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        find: vi.fn(async (object: string, options?: any) => {
            calls.push({ op: 'find', object, options });
            return rows.filter((r) => matches(r, options?.where));
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        insert: vi.fn(async (object: string, data: any, options?: any) => {
            calls.push({ op: 'insert', object, data, options });
            return { id: 'row_new', ...data };
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: vi.fn(async (object: string, data: any, options?: any) => {
            // Routed through the producer's OWN dispatch predicate, so this
            // fake cannot be looser than the engine it stands in for — #4434
            // shipped a dead REST route with its suite green off exactly that
            // gap. `pnpm check:engine-double-contract` is the gate.
            assertEngineUpdateDispatch(data, options);
            calls.push({ op: 'update', object, data, options });
            return data;
        }),
    };
    return { engine, calls };
}

describe('ObjectStoreMetadataActivationStore — the discriminator is a parameter (#12350)', () => {
    it('scopes the read by the metadata_type it was constructed with', async () => {
        const { engine } = makeStoreEngine([
            { id: 'r1', metadata_type: 'flow', name: 'nightly_sync', package_id: 'crm', active: false },
        ]);

        await new ObjectStoreMetadataActivationStore(engine, 'flow').list();

        expect(engine.find).toHaveBeenCalledWith(TABLE, expect.objectContaining({
            where: { metadata_type: 'flow' },
        }));
    });

    it('two bindings over ONE table never see each other\'s rows — both directions', async () => {
        const rows = [
            { id: 'r1', metadata_type: 'flow', name: 'nightly_sync', package_id: 'crm', active: false },
            { id: 'r2', metadata_type: 'action', name: 'mark_done', package_id: 'crm', active: false },
        ];

        const flows = await new ObjectStoreMetadataActivationStore(makeStoreEngine(rows).engine, 'flow').list();
        const actions = await new ObjectStoreMetadataActivationStore(makeStoreEngine(rows).engine, 'action').list();

        expect(flows.map((r) => r.name)).toEqual(['nightly_sync']);
        expect(actions.map((r) => r.name)).toEqual(['mark_done']);
    });

    it('stamps the metadata_type it was given on an INSERT, and never a neighbour\'s', async () => {
        const { engine, calls } = makeStoreEngine([]);

        await new ObjectStoreMetadataActivationStore(engine, 'action').setActive({
            name: 'mark_done', packageId: 'crm', active: false,
        });

        const insert = calls.find((c) => c.op === 'insert');
        expect(insert?.object).toBe(TABLE);
        expect(insert?.data).toEqual({
            metadata_type: 'action', name: 'mark_done', package_id: 'crm', active: false,
        });
        // No tenant column is written, because the table has none. Kept from
        // the era when the column existed-but-was-reserved (where it guarded
        // against writing it even as an explicit null): it is now what makes a
        // re-introduced tenant write loud at the payload, which is the one
        // place the column could come back without touching the declaration.
        expect(Object.keys(insert?.data ?? {})).not.toContain('organization_id');
    });

    it('scopes the read-then-write lookup by BOTH discriminator and name', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'r1', metadata_type: 'flow', name: 'mark_done', package_id: 'crm', active: false },
        ]);

        // Same NAME as the flow row above, different type. A store that scoped
        // the lookup by name alone would UPDATE the flow's row here.
        await new ObjectStoreMetadataActivationStore(engine, 'action').setActive({
            name: 'mark_done', packageId: 'crm', active: false,
        });

        expect(calls.find((c) => c.op === 'find')?.options?.where)
            .toEqual({ metadata_type: 'action', name: 'mark_done' });
        expect(calls.some((c) => c.op === 'update')).toBe(false);
        expect(calls.find((c) => c.op === 'insert')?.data?.metadata_type).toBe('action');
    });

    it('a type nobody has written yet (ADR-0126 §8: tool / skill / position) behaves identically', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'r1', metadata_type: 'tool', name: 'summarize', package_id: 'ai', active: 0 },
            { id: 'r2', metadata_type: 'flow', name: 'summarize', package_id: 'ai', active: true },
        ]);
        const store = new ObjectStoreMetadataActivationStore(engine, 'tool');

        expect(await store.list()).toEqual([{ name: 'summarize', packageId: 'ai', active: false }]);

        await store.setActive({ name: 'summarize', packageId: 'ai', active: true });
        expect(calls.find((c) => c.op === 'update')?.data)
            .toEqual({ id: 'r1', active: true, package_id: 'ai' });
    });
});

describe('ObjectStoreMetadataActivationStore — the ADR-0126 §4 row semantics, one home', () => {
    it('reads EVERY row of its type — the discriminator is the only scope', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'r1', metadata_type: 'flow', name: 'first', package_id: 'crm', active: false },
            { id: 'r2', metadata_type: 'flow', name: 'second', package_id: 'crm', active: false },
        ]);

        const store = new ObjectStoreMetadataActivationStore(engine, 'flow');
        const rows = await store.list();

        // ⚠️ This replaces a pin that asserted a SKIP: the store used to drop
        // any row carrying an organization, because the table declared a
        // reserved-but-never-written tenant column. The column was dropped
        // before it ever shipped, so there is no second axis left — every row
        // of this type is an answer, and a filter here would now be dead code
        // that reads as if it guarded something.
        expect(rows.map((r) => r.name)).toEqual(['first', 'second']);

        // The read names the discriminator and NOTHING else. Asserted on the
        // query rather than on the result, because a store that had kept a
        // tenant predicate would still return both of these rows — the fake's
        // rows carry no such column — and the skip would be invisible from the
        // result side alone.
        expect(calls.find((c) => c.op === 'find')?.options?.where)
            .toEqual({ metadata_type: 'flow' });
    });

    it('reads a driver `0` as FALSE, and a missing column as the packaged default (true)', async () => {
        const { engine } = makeStoreEngine([
            { id: 'r1', metadata_type: 'flow', name: 'sqlite_off', package_id: 'crm', active: 0 },
            { id: 'r2', metadata_type: 'flow', name: 'explicit_off', package_id: 'crm', active: false },
            { id: 'r3', metadata_type: 'flow', name: 'default_on', package_id: 'crm' },
        ]);

        const rows = await new ObjectStoreMetadataActivationStore(engine, 'flow').list();

        expect(rows).toEqual([
            { name: 'sqlite_off', packageId: 'crm', active: false },
            { name: 'explicit_off', packageId: 'crm', active: false },
            { name: 'default_on', packageId: 'crm', active: true },
        ]);
    });

    it('UPDATES the existing install-level row rather than inserting a second one', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'r1', metadata_type: 'flow', name: 'nightly_sync', package_id: 'crm', active: false },
        ]);

        await new ObjectStoreMetadataActivationStore(engine, 'flow').setActive({
            name: 'nightly_sync', packageId: 'crm', active: true,
        });

        // Re-enabling records the administrator's CHOICE (§6 wall 3); it never
        // deletes the row — which is why the engine slice has no `delete` at
        // all, so a double cannot pretend one exists.
        expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
        expect(calls.find((c) => c.op === 'update')?.data)
            .toEqual({ id: 'r1', active: true, package_id: 'crm' });
    });

    it('UPDATES the one row the keyed lookup returns — no tenant tie-break left to make', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'r1', metadata_type: 'flow', name: 'nightly_sync', package_id: 'crm', active: false },
        ]);

        await new ObjectStoreMetadataActivationStore(engine, 'flow').setActive({
            name: 'nightly_sync', packageId: 'crm', active: true,
        });

        // ⚠️ This replaces a pin that asserted the store IGNORED an
        // org-carrying row and inserted a second one instead. That choice
        // existed only because a reserved tenant column could put more than one
        // row behind the same `(metadata_type, name)` key; with the column gone
        // the declared `unique: 'global'` index over exactly those two columns
        // makes the keyed read single-valued, so taking the first match is
        // taking the only one — and inserting a duplicate would now be the bug.
        expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
        expect(calls.find((c) => c.op === 'update')?.data)
            .toEqual({ id: 'r1', active: true, package_id: 'crm' });
    });

    it('probes the TABLE unscoped — the question is composition, not type', async () => {
        const { engine } = makeStoreEngine([]);

        await new ObjectStoreMetadataActivationStore(engine, 'flow').probe();

        expect(engine.find).toHaveBeenCalledWith(TABLE, expect.objectContaining({ where: {}, limit: 1 }));
    });

    it('surfaces the driver error verbatim when the table cannot be read', async () => {
        const engine = {
            find: vi.fn(async () => { throw new Error(`no such table: ${TABLE}`); }),
            insert: vi.fn(),
            update: vi.fn(),
        };

        await expect(new ObjectStoreMetadataActivationStore(engine, 'flow').probe())
            .rejects.toThrow(/no such table: sys_metadata_activation/);
    });

    it('exports the table name the consumers re-export, so it cannot be spelled two ways', () => {
        expect(METADATA_ACTIVATION_TABLE).toBe(TABLE);
    });
});

describe('InMemoryMetadataActivationStore', () => {
    it('round-trips a row and reflects the latest flip', async () => {
        const store = new InMemoryMetadataActivationStore();

        expect(await store.list()).toEqual([]);
        await store.setActive({ name: 'nightly_sync', packageId: 'crm', active: false });
        expect(await store.list()).toEqual([{ name: 'nightly_sync', packageId: 'crm', active: false }]);
        await store.setActive({ name: 'nightly_sync', packageId: 'crm', active: true });
        expect(await store.list()).toEqual([{ name: 'nightly_sync', packageId: 'crm', active: true }]);
    });
});
