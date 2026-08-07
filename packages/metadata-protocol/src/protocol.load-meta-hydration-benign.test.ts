// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5841] `loadMetaFromDb` classifies "the metadata store is not provisioned
// yet" by error TYPE — not by a hand-copied message regex.
//
// ---------------------------------------------------------------------------
// The defect
// ---------------------------------------------------------------------------
// The outer `catch` of the boot hydration read used to decide whether a failed
// `sys_metadata` read was the benign first-boot case by running its own
// `/no such table/i` over `e.message`. That is a SECOND vocabulary of "which
// driver errors are benign", living a few thousand lines below the first: the
// same file already imports `isMissingTableError` and asks it in
// `rethrowUnlessMetadataStoreUnprovisioned` (#5532 / PR #5705), as does this
// package's `SysMetadataRepository` (#4867) and `DatabaseLoader` in
// `@objectstack/metadata` (#5108).
//
// A second copy is wrong in both directions, and only one of them is loud:
//
//   * SQLite says `no such table: sys_metadata` — the copy matched, by luck of
//     which driver the author happened to be running.
//   * PostgreSQL says `relation "sys_metadata" does not exist` and sets
//     SQLSTATE `42P01`; MySQL says `Table 'app.sys_metadata' doesn't exist`
//     with `errno` 1146. Neither matches `/no such table/i`, so a perfectly
//     benign first boot printed `[Protocol] DB hydration skipped: …` — a
//     warning about a healthy system that no operator can act on.
//   * Conversely, any driver that phrases a DIFFERENT failure as "no such
//     table" was read as benign and swallowed without a line.
//
// Same class as #5808 (message-regex allowlists retired from routing). One
// driver quirk is taught to the platform once, in
// `@objectstack/metadata/errors`.
//
// ---------------------------------------------------------------------------
// #5841 fact 2, now closed — #5897
// ---------------------------------------------------------------------------
// The classification above decided which failures are worth a console line. It
// did NOT change the return value: every non-benign failure still answered
// `{ loaded: 0, errors: 0, invalid: 0 }`, the exact shape a healthy empty store
// answers, so nothing a CALLER can read distinguished "the store holds no
// overlay rows" from "the store could not be read" (ADR-0110 D3, on the boot
// side). The sole consumer, `ObjectQLPlugin.restoreMetadataFromDb`, therefore
// logged an unreachable database as `debug` "No persisted metadata found in
// database" and the kernel reported ready.
//
// #5897 adds `storeUnavailable: boolean` to the return, set on exactly the
// branch that prints `DB hydration skipped` — the non-benign one. The
// `outage vs empty store` case below is the SAME measurement as before, turned
// over: it used to assert the two are indistinguishable, and now asserts the
// bit is precisely what tells them apart while every count stays identical.
//
// Not a superset of `errors`: that counter is about rows that arrived and
// failed to hydrate, this bit is about a row set that never arrived. And not a
// control-flow change — boot still degrades and continues.
//
// ---------------------------------------------------------------------------
// Reverse verification, direction predicted BEFORE running
// ---------------------------------------------------------------------------
// Two limbs, two predictions, both confirmed by running them:
//
// (1) Restore `if (!/no such table/i.test(e.message ?? ''))` (the #5841 fix)
//     and this file goes PARTIALLY red — the split is itself the finding, so it
//     is recorded rather than rounded to "it goes red":
//
//       * RED: every "table not provisioned" case whose driver does not use
//         SQLite's wording — the Postgres message, the code-only `42P01`, the
//         MySQL `errno`, and the wrapped `cause` — because the regex cannot see
//         any of them, so the benign first boot both warns AND (post-#5897)
//         mis-sets `storeUnavailable`, mistaking health for an outage.
//       * GREEN, unchanged: the SQLite case (the one phrasing the old regex was
//         written against), the ECONNREFUSED outage case (already warned, still
//         warns), and the working-store control. A suite that went fully red
//         here would mean the fix had changed more than the classification.
//
// (2) Delete `storeUnavailable = true` from that branch (the #5897 fix) and the
//     complementary set goes red, all in the same direction — no inversion, no
//     count that moves the other way:
//
//       * RED: the outage cases (`ECONNREFUSED`, the non-Error rejection, the
//         unrecognised-wording case) and `outage vs empty store`, which stops
//         being able to tell them apart — i.e. exactly the defect #5897 names.
//       * GREEN, unchanged: every benign case and the working-store control,
//         because `false` is what they already expected.
//
// The engine doubles below declare `find` only — `loadMetaFromDb` calls nothing
// else on the engine, and a fake with no `delete`/`update` member has no write
// verb for `check:engine-double-contract` to scan. This package cannot import
// `@objectstack/objectql` (the dependency would cycle — see the note in
// `host-engine.ts`), so a hand-mirrored predicate is not an option either: the
// answer is to not declare the verbs.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** The prefix the outer catch prints when it judges a failure NOT benign. */
const SKIPPED = '[Protocol] DB hydration skipped';

/** Registry double — only what the hydration path actually calls. */
function stubRegistry(registered: unknown[]) {
    return {
        listItems: () => [],
        isPackageDisabled: () => false,
        getItem: () => undefined,
        getObject: () => undefined,
        registerItem: (type: string, body: unknown) => { registered.push({ type, body }); },
        registerObject: (body: unknown) => { registered.push({ type: 'object', body }); },
    };
}

/**
 * An engine whose `sys_metadata` read REJECTS with `error()`.
 *
 * `find` is the only engine member `loadMetaFromDb` touches; see the file
 * header for why no write verb is declared.
 */
function engineThatCannotBeRead(error: () => unknown) {
    return {
        registry: stubRegistry([]),
        find: vi.fn(async () => { throw error(); }),
    } as any;
}

/** An engine that answers the read normally, from `rows`. */
function engineWithRows(rows: unknown[]) {
    const registered: unknown[] = [];
    const engine = {
        registry: stubRegistry(registered),
        find: vi.fn(async () => rows),
    } as any;
    return { engine, registered };
}

/**
 * The real driver phrasings for "this table has not been provisioned yet".
 *
 * Every one of these is a shape `isMissingTableError` already recognises — the
 * point of the fix is to ask THAT predicate rather than to grow a third list
 * here, so these are transcribed from its documented signature (code / errno /
 * message / one step down `cause`), not invented.
 */
const missingTable: Record<string, () => unknown> = {
    // SQLite / libsql — the one phrasing the retired regex was written against.
    'sqlite message': () =>
        Object.assign(new Error('SQLITE_ERROR: no such table: sys_metadata'), {
            code: 'SQLITE_ERROR',
        }),
    // PostgreSQL, message only (a driver that forwards text but no SQLSTATE).
    'postgres message': () =>
        new Error('relation "sys_metadata" does not exist'),
    // PostgreSQL, SQLSTATE only — no message signal at all.
    'postgres SQLSTATE 42P01': () =>
        Object.assign(new Error('query failed'), { code: '42P01' }),
    // MySQL / MariaDB numeric errno.
    'mysql errno 1146': () =>
        Object.assign(new Error('opaque driver failure'), { errno: 1146 }),
    // Drivers commonly re-throw with the original attached as `cause`.
    // (Assigned rather than passed to the `Error` constructor: this package's
    // tsconfig `lib` predates the ES2022 two-argument overload, and the
    // predicate walks the `cause` PROPERTY either way.)
    'wrapped in a cause chain': () =>
        Object.assign(new Error('metadata read failed'), {
            cause: new Error('relation "sys_metadata" does not exist'),
        }),
};

/** An outage: the rows may well exist and simply were not seen. */
const connectionRefused = () =>
    Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' });

afterEach(() => {
    vi.restoreAllMocks();
});

describe('loadMetaFromDb — an unprovisioned store is benign, by error TYPE (#5841)', () => {
    for (const [driver, error] of Object.entries(missingTable)) {
        it(`is silent and returns loaded: 0 for ${driver}`, async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const protocol = new ObjectStackProtocolImplementation(
                engineThatCannotBeRead(error),
            );

            const res = await protocol.loadMetaFromDb();

            // Benign: there really are no overlay rows yet, so this IS the
            // truth — including `storeUnavailable: false` (#5897). An
            // un-provisioned store is not an outage, and a bit that fired here
            // would turn every first boot into a boot-time `error`.
            expect(res).toEqual({ loaded: 0, errors: 0, invalid: 0, storeUnavailable: false });
            // …and a healthy first boot owes the operator no warning line.
            expect(
                warn.mock.calls.map((c) => String(c[0])),
                `expected no "${SKIPPED}" line for a ${driver} first boot`,
            ).toEqual([]);
        });
    }

    it('asks the shared predicate, not a private message list — an unrecognised wording stays loud', async () => {
        // Guard against the fix over-reaching into "anything vaguely table-ish
        // is benign". `isMissingTableError` deliberately does NOT match a bare
        // "does not exist" (that also covers role/database/column — all real
        // failures), so this must warn.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const protocol = new ObjectStackProtocolImplementation(
            engineThatCannotBeRead(() => new Error('role "app_ro" does not exist')),
        );

        const res = await protocol.loadMetaFromDb();

        expect(warn.mock.calls.some((c) => String(c[0]).startsWith(SKIPPED))).toBe(true);
        // The console line and the return bit are ONE verdict, read twice —
        // a failure loud enough to warn about is one the caller must be able
        // to see too (#5897). If these two ever disagree, the boot log and the
        // boot's own return value are describing different systems.
        expect(res.storeUnavailable).toBe(true);
    });
});

describe('loadMetaFromDb — every other read failure stays loud (#5841)', () => {
    it('warns for a connection refusal and still returns without throwing', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const protocol = new ObjectStackProtocolImplementation(
            engineThatCannotBeRead(connectionRefused),
        );

        const res = await protocol.loadMetaFromDb();

        // #5897 — the counts are unchanged (nothing was loaded, and truthfully
        // so), but the shape now ALSO says why: the read never happened.
        expect(res).toEqual({ loaded: 0, errors: 0, invalid: 0, storeUnavailable: true });
        const skipped = warn.mock.calls
            .map((c) => String(c[0]))
            .filter((m) => m.startsWith(SKIPPED));
        expect(skipped).toHaveLength(1);
        expect(skipped[0]).toContain('ECONNREFUSED');
    });

    it('reports a non-Error rejection instead of printing "undefined"', async () => {
        // The retired branch read `e.message` off whatever was thrown; a driver
        // that rejects with a string produced `DB hydration skipped: undefined`.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const protocol = new ObjectStackProtocolImplementation(
            engineThatCannotBeRead(() => 'pool exhausted'),
        );

        const res = await protocol.loadMetaFromDb();

        const skipped = warn.mock.calls
            .map((c) => String(c[0]))
            .filter((m) => m.startsWith(SKIPPED));
        expect(skipped).toHaveLength(1);
        expect(skipped[0]).toContain('pool exhausted');
        expect(skipped[0]).not.toContain('undefined');
        // A driver that rejects with a bare string is still an outage: the bit
        // is set from the CLASSIFICATION, never from the thrown value's shape.
        expect(res.storeUnavailable).toBe(true);
    });

    it('an outage and an empty store agree on every count and are told apart by the bit alone', async () => {
        // This case is #5841 fact 2, TURNED OVER (#5897). It used to assert
        // `expect(outage).toEqual(emptyStore)` and carried the note "when the
        // return contract grows a way to say the store could not be read, this
        // assertion is EXPECTED to flip — update it to assert the difference;
        // do not delete the case." This is that flip.
        //
        // The `console.warn` is no longer the ONLY channel separating the two.
        // The return value — the thing `ObjectQLPlugin.restoreMetadataFromDb`
        // actually reads — now separates them as well, which is what lets boot
        // log an unreachable store at `error` instead of `debug` "No persisted
        // metadata found in database".
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const outage = await new ObjectStackProtocolImplementation(
            engineThatCannotBeRead(connectionRefused),
        ).loadMetaFromDb();
        const emptyStore = await new ObjectStackProtocolImplementation(
            engineWithRows([]).engine,
        ).loadMetaFromDb();

        // Distinguishable at all — the defect, gone.
        expect(outage).not.toEqual(emptyStore);
        expect(outage.storeUnavailable).toBe(true);
        expect(emptyStore.storeUnavailable).toBe(false);

        // …and distinguishable by the bit ALONE. Asserted rather than implied:
        // every count is still identical, so nothing downstream can reconstruct
        // the difference from `loaded`/`errors`/`invalid` and quietly grow a
        // second, weaker way of asking the same question.
        const { storeUnavailable: _o, ...outageCounts } = outage;
        const { storeUnavailable: _e, ...emptyCounts } = emptyStore;
        expect(outageCounts).toEqual(emptyCounts);
        expect(outageCounts).toEqual({ loaded: 0, errors: 0, invalid: 0 });

        expect(warn).toHaveBeenCalled();
    });
});

describe('loadMetaFromDb — a working store is untouched by the classification (#5841)', () => {
    it('hydrates rows and prints no skipped line', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { engine, registered } = engineWithRows([
            {
                id: 'r_1',
                type: 'object',
                name: 'crm_invoice',
                organization_id: null,
                package_id: null,
                state: 'active',
                metadata: JSON.stringify({
                    name: 'crm_invoice',
                    label: 'Invoice',
                    fields: { amount: { type: 'currency', label: 'Amount' } },
                }),
            },
        ]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res = await protocol.loadMetaFromDb();

        expect(res.loaded).toBe(1);
        expect(res.errors).toBe(0);
        // #5897 — the control that keeps the bit from becoming decorative: a
        // read that SUCCEEDED must report `false`, or every boot is an outage.
        expect(res.storeUnavailable).toBe(false);
        expect(registered).toHaveLength(1);
        expect(warn.mock.calls.some((c) => String(c[0]).startsWith(SKIPPED))).toBe(false);
    });

    it('rows that fail to hydrate are counted in `errors`, NOT reported as an unavailable store', async () => {
        // #5897 — the other half of "not a superset of `errors`". Here the read
        // succeeded and one row is unparseable: the store was perfectly
        // available, the hydration is PARTIAL. Setting the bit here would make
        // boot print the durability `error` for a single corrupt row, which is
        // the mirror-image failure AGENTS.md "Degradation log levels" warns
        // about — it trains everyone to skim `error`.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { engine } = engineWithRows([
            {
                id: 'r_ok',
                type: 'app',
                name: 'crm',
                organization_id: null,
                state: 'active',
                metadata: JSON.stringify({ name: 'crm', label: 'CRM' }),
            },
            {
                id: 'r_bad',
                type: 'app',
                name: 'broken',
                organization_id: null,
                state: 'active',
                metadata: 'not-valid-json{{{',
            },
        ]);

        const res = await new ObjectStackProtocolImplementation(engine).loadMetaFromDb();

        expect(res.loaded).toBe(1);
        expect(res.errors).toBe(1);
        expect(res.storeUnavailable).toBe(false);
        expect(warn).toHaveBeenCalled(); // the per-row line, not the skipped one
        expect(warn.mock.calls.some((c) => String(c[0]).startsWith(SKIPPED))).toBe(false);
    });
});
