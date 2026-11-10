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
    backfillActivationLedgerPackages,
    InMemoryMetadataActivationStore,
    listPackageMetadataActivations,
    type ActivationLedgerHolder,
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
function makeStoreEngine(rows: any[] = []) {
    const calls: Array<{ op: string; object: string; data?: any; options?: any }> = [];
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

// [#22621 → A] The security catalog's activation door switches a position or
// permission set the environment authored, and no package ships those. The row
// says so with ONE spelling — no package value — and the store refuses the
// other spelling a caller reaches for (`?? ''`), so a reader can never take an
// environment item for a package named ''.
describe('ObjectStoreMetadataActivationStore — an item no package ships', () => {
    it('INSERTS a row with no package when packageId is absent', async () => {
        const { engine, calls } = makeStoreEngine([]);

        await new ObjectStoreMetadataActivationStore(engine, 'position').setActive({
            name: 'env_position', active: false,
        });

        expect(calls.find((c) => c.op === 'insert')?.data).toEqual({
            metadata_type: 'position', name: 'env_position', package_id: null, active: false,
        });
    });

    it('UPDATES its row with no package on the way back on', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'r1', metadata_type: 'permission', name: 'env_set', package_id: null, active: false },
        ]);

        await new ObjectStoreMetadataActivationStore(engine, 'permission').setActive({
            name: 'env_set', active: true,
        });

        expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
        expect(calls.find((c) => c.op === 'update')?.data).toEqual({ id: 'r1', active: true, package_id: null });
    });

    it('REFUSES an empty-string package before reading or writing anything', async () => {
        const { engine, calls } = makeStoreEngine([]);

        await expect(new ObjectStoreMetadataActivationStore(engine, 'position').setActive({
            name: 'env_position', packageId: '', active: false,
        })).rejects.toThrow(TypeError);
        expect(calls).toEqual([]);
    });

    it('reads a package-less row back with packageId ABSENT, beside a packaged one that keeps its package', async () => {
        const { engine } = makeStoreEngine([
            { id: 'r1', metadata_type: 'position', name: 'env_position', package_id: null, active: false },
            { id: 'r2', metadata_type: 'position', name: 'sales_rep', package_id: 'crm', active: false },
        ]);

        const rows = await new ObjectStoreMetadataActivationStore(engine, 'position').list();

        expect(rows).toEqual([
            { name: 'env_position', active: false },
            { name: 'sales_rep', packageId: 'crm', active: false },
        ]);
        expect('packageId' in rows[0]).toBe(false);
    });
});

// [ADR-0150 D8 row R4] An item whose ledger already holds more than one row a
// write could mean: two naming no package (stored before the package-less
// index stood), or one naming none beside the write's package's own row. The
// write used to update the FIRST match and give it the write's package, which
// took one row of a package-less pair out of that index's reach, so the next
// boot built the index over the pair and the duplicate was never reported
// again. The store now refuses, naming every such row, and writes nothing —
// the stance the boot backfill takes for the same rows (the describe below
// `backfillActivationLedgerPackages`). The envelope (`code` + `status`) and
// the row ids are asserted, never the sentence. These cases are the store
// addressed by name (the default: actions and the catalog types); the same
// refusal for a store addressed by `(package, name)` is the describe after
// `the ledger addressed by (package, name)`.
/** The writes a store engine double recorded. */
const writes = (calls: Array<{ op: string }>) => calls.filter((c) => c.op === 'insert' || c.op === 'update');

/** A refused write: its envelope (`code` + `status`) and every row id it names; never the sentence. */
async function expectRefusedNaming(write: Promise<void>, ids: readonly string[]) {
    const refusal = await write.then(() => undefined, (e: unknown) => e as { code?: unknown; status?: unknown; message?: unknown });
    expect(refusal, 'the write was accepted').toBeDefined();
    expect({ code: refusal?.code, status: refusal?.status }).toEqual({ code: 'RESOURCE_CONFLICT', status: 409 });
    for (const id of ids) expect(String(refusal?.message)).toContain(id);
}

describe('ObjectStoreMetadataActivationStore by name — a write never picks one of several rows it could mean', () => {
    it('refuses a write naming a package on an item with two package-less rows, naming both, and writes nothing', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'd1', metadata_type: 'action', name: 'app_switch', package_id: null, active: 0 },
            { id: 'd2', metadata_type: 'action', name: 'app_switch', package_id: null, active: 1 },
        ]);

        await expectRefusedNaming(
            new ObjectStoreMetadataActivationStore(engine, 'action').setActive({ name: 'app_switch', packageId: 'com.example.app', active: false }),
            ['d1', 'd2'],
        );
        expect(writes(calls)).toEqual([]);
    });

    it('refuses a write naming no package on the same pair: flipping one of two switches is picked by storage order', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'd1', metadata_type: 'permission', name: 'env_set', package_id: null, active: false },
            { id: 'd2', metadata_type: 'permission', name: 'env_set', package_id: null, active: true },
        ]);

        await expectRefusedNaming(
            new ObjectStoreMetadataActivationStore(engine, 'permission').setActive({ name: 'env_set', active: true }),
            ['d1', 'd2'],
        );
        expect(writes(calls)).toEqual([]);
    });

    it('refuses a write beside a package-less row AND the write\'s package\'s own row, naming both, in either storage order', async () => {
        const packaged = { id: 'b1', metadata_type: 'action', name: 'approve', package_id: 'com.example.app', active: false };
        const packageless = { id: 'n1', metadata_type: 'action', name: 'approve', package_id: null, active: false };
        for (const rows of [[packaged, packageless], [packageless, packaged]]) {
            const { engine, calls } = makeStoreEngine(rows.map((r) => ({ ...r })));

            await expectRefusedNaming(
                new ObjectStoreMetadataActivationStore(engine, 'action').setActive({ name: 'approve', packageId: 'com.example.app', active: true }),
                ['b1', 'n1'],
            );
            expect(writes(calls)).toEqual([]);
        }
    });

    it('refuses a write that finds rows of two other packages and none of its own: re-addressing one is a guess', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'q1', metadata_type: 'action', name: 'app_switch', package_id: 'com.example.one', active: false },
            { id: 'q2', metadata_type: 'action', name: 'app_switch', package_id: 'com.example.two', active: false },
        ]);

        await expectRefusedNaming(
            new ObjectStoreMetadataActivationStore(engine, 'action').setActive({ name: 'app_switch', packageId: 'com.example.app', active: true }),
            ['q1', 'q2'],
        );
        expect(writes(calls)).toEqual([]);
    });

    it('CONTROL: binds an item\'s ONE package-less row to the write\'s package, as before', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'n1', metadata_type: 'action', name: 'app_switch', package_id: null, active: true },
        ]);

        await new ObjectStoreMetadataActivationStore(engine, 'action').setActive({ name: 'app_switch', packageId: 'com.example.app', active: false });

        expect(writes(calls).map((c: any) => [c.op, c.data])).toEqual([
            ['update', { id: 'n1', active: false, package_id: 'com.example.app' }],
        ]);
    });

    it('CONTROL: beside another package\'s row, writes the row that names no package or the write\'s own, in either storage order', async () => {
        const other = { id: 'q1', metadata_type: 'action', name: 'app_switch', package_id: 'com.example.other', active: false };
        for (const mine of [
            { id: 'n1', metadata_type: 'action', name: 'app_switch', package_id: null, active: true },
            { id: 'm1', metadata_type: 'action', name: 'app_switch', package_id: 'com.example.app', active: true },
        ]) {
            for (const rows of [[other, mine], [mine, other]]) {
                const { engine, calls } = makeStoreEngine(rows.map((r) => ({ ...r })));

                await new ObjectStoreMetadataActivationStore(engine, 'action').setActive({ name: 'app_switch', packageId: 'com.example.app', active: false });

                // Never the other package's row: that is its own switch (ADR-0150 D4).
                expect(writes(calls).map((c: any) => [c.op, c.data])).toEqual([
                    ['update', { id: mine.id, active: false, package_id: 'com.example.app' }],
                ]);
            }
        }
    });

    it('CONTROL: re-addresses an item\'s ONE row of another package to the write\'s package, as before', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'q1', metadata_type: 'action', name: 'app_switch', package_id: 'com.example.old', active: false },
        ]);

        await new ObjectStoreMetadataActivationStore(engine, 'action').setActive({ name: 'app_switch', packageId: 'com.example.app', active: true });

        expect(writes(calls).map((c: any) => [c.op, c.data])).toEqual([
            ['update', { id: 'q1', active: true, package_id: 'com.example.app' }],
        ]);
    });
});

// [ADR-0150 D4, #31696] A type whose readers consult the ledger by
// `(package, name)` constructs its store with `addressing: 'package-and-name'`:
// one package's write never re-attributes another package's row of the name.
describe('the ledger addressed by (package, name)', () => {
    const BY_PACKAGE = { addressing: 'package-and-name' } as const;

    it('ObjectStore: a write for one package updates that package\'s row and leaves the other\'s', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'r1', metadata_type: 'flow', name: 'f', package_id: 'p1', active: false },
            { id: 'r2', metadata_type: 'flow', name: 'f', package_id: 'p2', active: false },
        ]);
        await new ObjectStoreMetadataActivationStore(engine, 'flow', BY_PACKAGE).setActive({ name: 'f', packageId: 'p2', active: true });
        expect(calls.filter((c) => c.op === 'update').map((c) => c.data)).toEqual([{ id: 'r2', active: true, package_id: 'p2' }]);
        expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
    });

    it('ObjectStore: a package with no row of its own gets one beside the other package\'s, which it never takes over', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'r1', metadata_type: 'flow', name: 'f', package_id: 'p1', active: false },
        ]);
        await new ObjectStoreMetadataActivationStore(engine, 'flow', BY_PACKAGE).setActive({ name: 'f', packageId: 'p2', active: true });
        expect(calls.filter((c) => c.op === 'update')).toHaveLength(0);
        expect(calls.find((c) => c.op === 'insert')?.data).toEqual({ metadata_type: 'flow', name: 'f', package_id: 'p2', active: true });
    });

    it('ObjectStore: the row naming no package is taken over only when the write says so', async () => {
        const rows = [{ id: 'r0', metadata_type: 'flow', name: 'f', package_id: null, active: false }];
        const plain = makeStoreEngine(rows);
        await new ObjectStoreMetadataActivationStore(plain.engine, 'flow', BY_PACKAGE).setActive({ name: 'f', packageId: 'p1', active: false });
        expect(plain.calls.filter((c) => c.op === 'update')).toHaveLength(0);
        expect(plain.calls.find((c) => c.op === 'insert')?.data).toMatchObject({ package_id: 'p1' });

        const adopting = makeStoreEngine(rows);
        await new ObjectStoreMetadataActivationStore(adopting.engine, 'flow', BY_PACKAGE).setActive(
            { name: 'f', packageId: 'p1', active: false },
            { adoptPackageless: true },
        );
        expect(adopting.calls.filter((c) => c.op === 'insert')).toHaveLength(0);
        expect(adopting.calls.find((c) => c.op === 'update')?.data).toEqual({ id: 'r0', active: false, package_id: 'p1' });
    });

    it('ObjectStore: a package-less write updates the package-less row, never a package\'s', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'r1', metadata_type: 'flow', name: 'f', package_id: 'p1', active: false },
            { id: 'r0', metadata_type: 'flow', name: 'f', package_id: null, active: false },
        ]);
        await new ObjectStoreMetadataActivationStore(engine, 'flow', BY_PACKAGE).setActive({ name: 'f', active: true });
        expect(calls.find((c) => c.op === 'update')?.data).toEqual({ id: 'r0', active: true, package_id: null });
    });

    it('by name (the default), the one row of the name is re-attributed, as before', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'r1', metadata_type: 'action', name: 'a', package_id: 'p1', active: false },
        ]);
        await new ObjectStoreMetadataActivationStore(engine, 'action').setActive({ name: 'a', packageId: 'p2', active: true });
        expect(calls.find((c) => c.op === 'update')?.data).toEqual({ id: 'r1', active: true, package_id: 'p2' });
    });

    it('InMemory keeps rows exactly as the durable store does, in both modes', async () => {
        const byPackage = new InMemoryMetadataActivationStore(BY_PACKAGE);
        await byPackage.setActive({ name: 'f', active: false });
        await byPackage.setActive({ name: 'f', packageId: 'p2', active: true });
        expect(await byPackage.list()).toEqual([{ name: 'f', active: false }, { name: 'f', packageId: 'p2', active: true }]);
        await byPackage.setActive({ name: 'f', packageId: 'p1', active: false }, { adoptPackageless: true });
        expect(await byPackage.list()).toEqual([{ name: 'f', packageId: 'p2', active: true }, { name: 'f', packageId: 'p1', active: false }]);

        const byName = new InMemoryMetadataActivationStore();
        await byName.setActive({ name: 'a', packageId: 'p1', active: false });
        await byName.setActive({ name: 'a', packageId: 'p2', active: true });
        expect(await byName.list()).toEqual([{ name: 'a', packageId: 'p2', active: true }]);
    });
});

// [ADR-0150 D4, D8 row R4] The same refusal for a store addressed by
// `(package, name)` (flows): a write for a package with no row of its own,
// told to take the package-less row over (`adoptPackageless`, which the flow
// toggle passes while its package is the name's one holder), never adopts one
// of two; and a write for a package that finds only ANOTHER package's row
// gets its own row beside it, never that one.
describe('the ledger addressed by (package, name) — a write never adopts one of several rows, nor takes another package\'s', () => {
    const BY_PACKAGE = { addressing: 'package-and-name' } as const;
    const ADOPT = { adoptPackageless: true } as const;

    it('refuses an adopting write over two package-less rows, naming both, and writes nothing', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'd1', metadata_type: 'flow', name: 'f', package_id: null, active: 0 },
            { id: 'd2', metadata_type: 'flow', name: 'f', package_id: null, active: 1 },
        ]);

        await expectRefusedNaming(
            new ObjectStoreMetadataActivationStore(engine, 'flow', BY_PACKAGE).setActive({ name: 'f', packageId: 'p1', active: false }, ADOPT),
            ['d1', 'd2'],
        );
        expect(writes(calls)).toEqual([]);
    });

    it('refuses a package-less write over two package-less rows', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'd1', metadata_type: 'flow', name: 'f', package_id: null, active: false },
            { id: 'd2', metadata_type: 'flow', name: 'f', package_id: null, active: true },
        ]);

        await expectRefusedNaming(
            new ObjectStoreMetadataActivationStore(engine, 'flow', BY_PACKAGE).setActive({ name: 'f', active: true }),
            ['d1', 'd2'],
        );
        expect(writes(calls)).toEqual([]);
    });

    it('CONTROL: a write that does not adopt (a name two packages hold) adds its own row and binds neither of the pair', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'd1', metadata_type: 'flow', name: 'f', package_id: null, active: false },
            { id: 'd2', metadata_type: 'flow', name: 'f', package_id: null, active: true },
        ]);

        await new ObjectStoreMetadataActivationStore(engine, 'flow', BY_PACKAGE).setActive({ name: 'f', packageId: 'p1', active: false });

        expect(writes(calls).map((c: any) => [c.op, c.data])).toEqual([
            ['insert', { metadata_type: 'flow', name: 'f', package_id: 'p1', active: false }],
        ]);
    });

    it('CONTROL: the write\'s own row beside a package-less one is its switch, and is the row written', async () => {
        for (const adopt of [undefined, ADOPT]) {
            const { engine, calls } = makeStoreEngine([
                { id: 'n1', metadata_type: 'flow', name: 'f', package_id: null, active: false },
                { id: 'm1', metadata_type: 'flow', name: 'f', package_id: 'p1', active: false },
            ]);

            await new ObjectStoreMetadataActivationStore(engine, 'flow', BY_PACKAGE).setActive({ name: 'f', packageId: 'p1', active: true }, adopt);

            expect(writes(calls).map((c: any) => [c.op, c.data])).toEqual([
                ['update', { id: 'm1', active: true, package_id: 'p1' }],
            ]);
        }
    });

    it('two packages: a write for B that finds only A\'s row adds B\'s own row, A\'s untouched, and B\'s next switch lands on it', async () => {
        for (const adopt of [undefined, ADOPT]) {
            const table: any[] = [{ id: 'a1', metadata_type: 'flow', name: 'f', package_id: 'com.example.a', active: false }];
            const { engine, calls } = makeStoreEngine(table);
            const insert = engine.insert;
            engine.insert = vi.fn(async (object: string, data: any, options?: any) => {
                const stored = await insert(object, data, options);
                table.push({ ...data, id: 'b1' });
                return stored;
            });
            const store = new ObjectStoreMetadataActivationStore(engine, 'flow', BY_PACKAGE);

            await store.setActive({ name: 'f', packageId: 'com.example.b', active: false }, adopt);
            await store.setActive({ name: 'f', packageId: 'com.example.b', active: true }, adopt);

            expect(writes(calls).map((c: any) => [c.op, c.data])).toEqual([
                ['insert', { metadata_type: 'flow', name: 'f', package_id: 'com.example.b', active: false }],
                ['update', { id: 'b1', active: true, package_id: 'com.example.b' }],
            ]);
            expect(await store.list()).toEqual([
                { name: 'f', packageId: 'com.example.a', active: false },
                { name: 'f', packageId: 'com.example.b', active: true },
            ]);
        }
    });
});

// [#26474] A door writes the row ON BEHALF of the administrator who asked, so
// the write runs under that caller's own envelope, elevated — the engine stamps
// `created_by` / `updated_by` from its `userId`, and the audit plugin reads
// `user_id` / `actor` from the same session. The store's constant system
// context names nobody, which is what left both rows' actor null.
describe('ObjectStoreMetadataActivationStore — the write names the caller who asked for it', () => {
    const CALLER = { userId: 'usr_admin', organizationId: 'org_acme', positions: ['org_admin'], isSystem: true as const };

    it('INSERTS under the context it is handed, and reads the existing row under the same one', async () => {
        const { engine, calls } = makeStoreEngine([]);

        await new ObjectStoreMetadataActivationStore(engine, 'action')
            .setActive({ name: 'convert_lead', packageId: 'crm', active: false }, { context: CALLER });

        expect(calls.map((c) => [c.op, c.options?.context])).toEqual([
            ['find', CALLER],
            ['insert', CALLER],
        ]);
    });

    it('UPDATES under the context it is handed', async () => {
        const { engine, calls } = makeStoreEngine([
            { id: 'r1', metadata_type: 'action', name: 'convert_lead', package_id: 'crm', active: false },
        ]);

        await new ObjectStoreMetadataActivationStore(engine, 'action')
            .setActive({ name: 'convert_lead', packageId: 'crm', active: true }, { context: CALLER });

        expect(calls.find((c) => c.op === 'update')?.options?.context).toEqual(CALLER);
    });

    it('with no caller, writes under the system context it always has — a boot-time write names nobody', async () => {
        const { engine, calls } = makeStoreEngine([]);

        await new ObjectStoreMetadataActivationStore(engine, 'flow').setActive({ name: 'nightly_sync', active: false });

        expect(calls.map((c) => c.options?.context)).toEqual([
            { isSystem: true, positions: [], permissions: [] },
            { isSystem: true, positions: [], permissions: [] },
        ]);
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

    // The flow and action stores' test double refuses exactly the row the
    // durable store refuses: a double more lenient than what it stands for lets
    // a test pass a write the real ledger refuses.
    it('REFUSES an empty-string package as the durable store does, and keeps nothing', async () => {
        const store = new InMemoryMetadataActivationStore();
        const { engine } = makeStoreEngine([]);

        const fromDouble = await store.setActive({ name: 'env_action', packageId: '', active: false }).catch((e) => e);
        const fromStore = await new ObjectStoreMetadataActivationStore(engine, 'action')
            .setActive({ name: 'env_action', packageId: '', active: false }).catch((e) => e);

        expect(fromDouble).toBeInstanceOf(TypeError);
        expect(fromStore).toBeInstanceOf(TypeError);
        // One refusal, two stores: the same text, except that the durable store
        // names its row's type in the subject and the double has no type.
        expect(fromDouble.message).toBe(fromStore.message.replace(`action 'env_action'`, `'env_action'`));
        expect(await store.list()).toEqual([]);
    });

    it('keeps an item no package ships with packageId ABSENT', async () => {
        const store = new InMemoryMetadataActivationStore();

        await store.setActive({ name: 'env_action', active: false });

        const rows = await store.list();
        expect(rows).toEqual([{ name: 'env_action', active: false }]);
        expect('packageId' in rows[0]).toBe(false);
    });
});

describe('listPackageMetadataActivations — one package\'s rows across types (#28411, ADR-0146 D8 item 4)', () => {
    const rows = [
        { id: 'r1', metadata_type: 'flow', name: 'nightly_sync', package_id: 'crm', active: false },
        { id: 'r2', metadata_type: 'action', name: 'mark_done', package_id: 'crm', active: 0 },
        { id: 'r3', metadata_type: 'position', name: 'crm_manager', package_id: 'crm', active: true },
        { id: 'r4', metadata_type: 'flow', name: 'other_sync', package_id: 'other', active: false },
        { id: 'r5', metadata_type: 'permission', name: 'env_set', active: false },
    ];

    it('reads every type\'s rows of the package, under the system context, each with its metadata_type', async () => {
        const { engine, calls } = makeStoreEngine(rows);
        const out = await listPackageMetadataActivations(engine, 'crm');
        expect(out).toEqual([
            { metadataType: 'flow', name: 'nightly_sync', packageId: 'crm', active: false },
            { metadataType: 'action', name: 'mark_done', packageId: 'crm', active: false },
            { metadataType: 'position', name: 'crm_manager', packageId: 'crm', active: true },
        ]);
        const find = calls.find((c) => c.op === 'find');
        expect(find?.object).toBe(METADATA_ACTIVATION_TABLE);
        expect(find?.options?.where).toEqual({ package_id: 'crm' });
        expect(find?.options?.context?.isSystem).toBe(true);
    });

    it('parses a row exactly as its own type\'s store does', async () => {
        const viaPackage = (await listPackageMetadataActivations(makeStoreEngine(rows).engine, 'crm'))
            .filter((r) => r.metadataType === 'action')
            .map(({ metadataType: _type, ...row }) => row);
        const viaStore = (await new ObjectStoreMetadataActivationStore(makeStoreEngine(rows).engine, 'action').list())
            .filter((r) => r.packageId === 'crm');
        expect(viaPackage).toEqual(viaStore);
    });

    it('an empty or non-string package reads nothing, never the package-less rows', async () => {
        const { engine } = makeStoreEngine(rows);
        expect(await listPackageMetadataActivations(engine, '')).toEqual([]);
        expect(await listPackageMetadataActivations(engine, undefined as unknown as string)).toEqual([]);
        expect(engine.find).not.toHaveBeenCalled();
    });
});

/**
 * A STATEFUL ledger for the backfill: `update` patches the row it addresses, so
 * a second run reads what the first one wrote. The backfill's one read is
 * unscoped (`where: {}`), so the double answers every row and refuses any other
 * WHERE rather than filtering it.
 */
function makeLedger(rows: any[]) {
    const table = rows.map((r) => ({ ...r }));
    const updates: Array<{ data: any; options: any }> = [];
    const engine = {
        find: vi.fn(async (_object: string, options?: any) => {
            if (Object.keys(options?.where ?? {}).length > 0) {
                throw new Error('makeLedger: the backfill reads the whole ledger; a scoped read is not modelled');
            }
            return table.map((r) => ({ ...r }));
        }),
        update: vi.fn(async (_object: string, data: any, options?: any) => {
            assertEngineUpdateDispatch(data, options);
            updates.push({ data, options });
            const row = table.find((r) => r.id === data.id);
            if (row) Object.assign(row, data);
            return data;
        }),
    };
    return { engine, table, updates };
}

describe('backfillActivationLedgerPackages — rows with no package take their one holder (ADR-0150 D8 row R4)', () => {
    const holders: Record<string, ActivationLedgerHolder> = {
        'flow:nightly_sync': { kind: 'package', packageId: 'crm' },
        'sharing_rule:share_open': { kind: 'ambiguous', candidates: ['crm', 'support'] },
        'permission:env_set': { kind: 'environment' },
        'action:gone': { kind: 'unheld' },
        'position:crm_manager': { kind: 'unaddressed' },
        'action:mark_done': { kind: 'package', packageId: 'other' },
    };
    const holderOf = vi.fn((type: string, name: string): ActivationLedgerHolder =>
        holders[`${type}:${name}`] ?? { kind: 'unheld' });
    const rows = () => [
        { id: 'r1', metadata_type: 'flow', name: 'nightly_sync', package_id: null, active: false },
        { id: 'r2', metadata_type: 'sharing_rule', name: 'share_open', active: false },
        { id: 'r3', metadata_type: 'permission', name: 'env_set', package_id: null, active: false },
        { id: 'r4', metadata_type: 'action', name: 'gone', package_id: null, active: true },
        { id: 'r5', metadata_type: 'position', name: 'crm_manager', package_id: null, active: false },
        // Already bound: never read as a candidate, even where the resolver
        // would now answer a different package.
        { id: 'r6', metadata_type: 'action', name: 'mark_done', package_id: 'crm', active: 0 },
    ];

    it('binds a single-holder row to its package, writing package_id alone, under the system context', async () => {
        const { engine, table, updates } = makeLedger(rows());
        const report = await backfillActivationLedgerPackages(engine, holderOf);

        expect(report.bound).toEqual([{ metadataType: 'flow', name: 'nightly_sync', packageId: 'crm' }]);
        expect(updates).toHaveLength(1);
        // `active` is the administrator's choice: the backfill never writes it.
        expect(updates[0].data).toEqual({ id: 'r1', package_id: 'crm' });
        expect(updates[0].options?.context?.isSystem).toBe(true);
        expect(table.find((r) => r.id === 'r1')).toMatchObject({ package_id: 'crm', active: false });
    });

    it('leaves an ambiguous row as it is and reports EVERY candidate — never a guess', async () => {
        const { engine, table, updates } = makeLedger(rows());
        const report = await backfillActivationLedgerPackages(engine, holderOf);

        expect(report.ambiguous).toEqual([
            { metadataType: 'sharing_rule', name: 'share_open', candidates: ['crm', 'support'] },
        ]);
        expect(updates.some((u) => u.data.id === 'r2')).toBe(false);
        expect(table.find((r) => r.id === 'r2')?.package_id).toBeUndefined();
    });

    it('leaves the environment\'s own item, an unheld name and an unaddressed type null, saying why', async () => {
        const { engine, updates } = makeLedger(rows());
        const report = await backfillActivationLedgerPackages(engine, holderOf);

        expect(report.unchanged).toEqual([
            { metadataType: 'permission', name: 'env_set', reason: 'environment' },
            { metadataType: 'action', name: 'gone', reason: 'unheld' },
            { metadataType: 'position', name: 'crm_manager', reason: 'unaddressed' },
        ]);
        expect(updates.map((u) => u.data.id)).toEqual(['r1']);
    });

    it('never asks about, or moves, a row that already names a package', async () => {
        holderOf.mockClear();
        const { engine, updates } = makeLedger(rows());
        await backfillActivationLedgerPackages(engine, holderOf);

        expect(holderOf).not.toHaveBeenCalledWith('action', 'mark_done');
        expect(updates.some((u) => u.data.id === 'r6')).toBe(false);
    });

    it('is re-runnable: the second run over the same ledger binds nothing and writes nothing', async () => {
        const { engine, updates } = makeLedger(rows());
        await backfillActivationLedgerPackages(engine, holderOf);
        const writesAfterFirst = updates.length;

        const second = await backfillActivationLedgerPackages(engine, holderOf);

        expect(writesAfterFirst).toBe(1);
        expect(updates).toHaveLength(writesAfterFirst);
        expect(second.bound).toEqual([]);
        // The ambiguous row is still reported, still with every candidate.
        expect(second.ambiguous).toEqual([
            { metadataType: 'sharing_rule', name: 'share_open', candidates: ['crm', 'support'] },
        ]);
    });

    it('a dry run reports the same binding and writes nothing', async () => {
        const { engine, table, updates } = makeLedger(rows());
        const report = await backfillActivationLedgerPackages(engine, holderOf, { dryRun: true });

        expect(report.bound).toEqual([{ metadataType: 'flow', name: 'nightly_sync', packageId: 'crm' }]);
        expect(updates).toHaveLength(0);
        expect(table.find((r) => r.id === 'r1')?.package_id).toBeNull();
    });

    it('reads the whole ledger once, unscoped, under the system context', async () => {
        const { engine } = makeLedger(rows());
        await backfillActivationLedgerPackages(engine, holderOf);
        expect(engine.find).toHaveBeenCalledTimes(1);
        expect(engine.find).toHaveBeenCalledWith(METADATA_ACTIVATION_TABLE, expect.objectContaining({
            where: {},
            context: expect.objectContaining({ isSystem: true }),
        }));
    });
});

describe('backfillActivationLedgerPackages — an item with more than one row is reported, never bound', () => {
    const holderOf = (type: string, name: string): ActivationLedgerHolder =>
        type === 'flow' && (name === 'app_switch' || name === 'app_digest')
            ? { kind: 'package', packageId: 'com.example.app' }
            : { kind: 'unheld' };

    it('binds neither of two rows that name no package for one item, names both, and still binds the item stored after them', async () => {
        const { engine, table, updates } = makeLedger([
            { id: 'd1', metadata_type: 'flow', name: 'app_switch', package_id: null, active: 0 },
            { id: 'd2', metadata_type: 'flow', name: 'app_switch', package_id: null, active: 1 },
            { id: 'd3', metadata_type: 'flow', name: 'app_digest', package_id: null, active: 0 },
        ]);

        const report = await backfillActivationLedgerPackages(engine, holderOf);

        expect(updates.map((u) => u.data)).toEqual([{ id: 'd3', package_id: 'com.example.app' }]);
        expect(table.filter((r) => r.name === 'app_switch').map((r) => r.package_id)).toEqual([null, null]);
        expect(report.bound).toEqual([{ metadataType: 'flow', name: 'app_digest', packageId: 'com.example.app' }]);
        expect(report.duplicated).toEqual([{
            metadataType: 'flow',
            name: 'app_switch',
            packageId: 'com.example.app',
            rows: [{ id: 'd1', active: false }, { id: 'd2', active: true }],
        }]);
        expect(report.failed).toEqual([]);
    });

    it('binds no row that names no package beside one that already names the holder, and names both', async () => {
        const { engine, updates } = makeLedger([
            { id: 'b1', metadata_type: 'flow', name: 'app_switch', package_id: 'com.example.app', active: 0 },
            { id: 'n1', metadata_type: 'flow', name: 'app_switch', package_id: null, active: 1 },
        ]);

        const report = await backfillActivationLedgerPackages(engine, holderOf);

        expect(updates).toEqual([]);
        expect(report.duplicated).toEqual([{
            metadataType: 'flow',
            name: 'app_switch',
            packageId: 'com.example.app',
            rows: [{ id: 'b1', packageId: 'com.example.app', active: false }, { id: 'n1', active: true }],
        }]);
    });

    it('a dry run reports the same duplicate and writes nothing', async () => {
        const { engine, updates } = makeLedger([
            { id: 'd1', metadata_type: 'flow', name: 'app_switch', package_id: null, active: 0 },
            { id: 'd2', metadata_type: 'flow', name: 'app_switch', package_id: null, active: 1 },
        ]);

        const report = await backfillActivationLedgerPackages(engine, holderOf, { dryRun: true });

        expect(updates).toEqual([]);
        expect(report.duplicated.map((d) => d.rows.map((r) => r.id))).toEqual([['d1', 'd2']]);
    });

    it('a write that fails is reported with its error, and the rows stored after it are still bound', async () => {
        const { engine, table, updates } = makeLedger([
            { id: 'x1', metadata_type: 'flow', name: 'app_switch', package_id: null, active: 0 },
            { id: 'x2', metadata_type: 'flow', name: 'app_digest', package_id: null, active: 0 },
        ]);
        const update = engine.update.getMockImplementation()!;
        engine.update.mockImplementation(async (object: string, data: any, options?: any) => {
            if (data.id === 'x1') throw new Error('Duplicate record refused');
            return update(object, data, options);
        });

        const report = await backfillActivationLedgerPackages(engine, holderOf);

        expect(report.failed).toEqual([{
            metadataType: 'flow', name: 'app_switch', id: 'x1', packageId: 'com.example.app', error: 'Duplicate record refused',
        }]);
        expect(report.bound).toEqual([{ metadataType: 'flow', name: 'app_digest', packageId: 'com.example.app' }]);
        expect(updates.map((u) => u.data.id)).toEqual(['x2']);
        expect(table.find((r) => r.id === 'x1')?.package_id).toBeNull();
    });

    it('asks every question before the first write: a resolver that throws leaves the ledger unwritten', async () => {
        const { engine, updates } = makeLedger([
            { id: 'x1', metadata_type: 'flow', name: 'app_digest', package_id: null, active: 0 },
            { id: 'x2', metadata_type: 'flow', name: 'boom', package_id: null, active: 0 },
        ]);
        const throwing = (type: string, name: string): ActivationLedgerHolder => {
            if (name === 'boom') throw new Error('resolver failed');
            return holderOf(type, name);
        };

        await expect(backfillActivationLedgerPackages(engine, throwing)).rejects.toThrow('resolver failed');
        expect(updates).toEqual([]);
    });
});
