// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
// [#5855] The fake engine's write verbs route through the producer's OWN
// dispatch predicates (#4550 delete / #5480 update), so this double cannot
// accept a call `ObjectQL.<verb>` refuses. Imported from
// `@objectstack/metadata-core` (already a `dependencies` entry here) and not
// from `@objectstack/objectql`, which depends on this package — that import
// would close a dependency cycle turbo rejects, and is why both of this file's
// (file, verb) pairs sat in the gate's DEBT ledger until #5619 sank the two
// predicates into a package that depends on neither side.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
// [#16100] The ledger contract and its SHIPPED readers/writers, so the receipt
// cases below measure what a consumer would really see rather than a literal
// this file agrees with itself about.
import { DATA_MIGRATION_FLAG_OBJECT, NOTIFICATION_EVENT_MIGRATION_ID } from '@objectstack/spec/system';
import { attestFreshDatastore, isDataMigrationVerified } from '@objectstack/platform-objects/system';
import { migrateSysNotificationToEvent } from './migrate-sys-notification-to-event.js';

/** Columns the legacy (pre-ADR-0030) sys_notification table physically has. */
const LEGACY_TABLE_COLUMNS = [
    'id', 'recipient_id', 'type', 'title', 'body', 'url', 'actor_name',
    'is_read', 'read_at', 'created_at', 'organization_id', 'topic', 'payload', 'severity',
];

function fakeDriver(rows: any[], columns: string[] = LEGACY_TABLE_COLUMNS) {
    const updates: Array<{ sql: string; bindings: any[] }> = [];
    return {
        updates,
        driver: {
            async raw(sql: string, bindings: any[] = []) {
                if (sql.startsWith('PRAGMA table_info')) {
                    return columns.map((name) => ({ name }));
                }
                if (sql.startsWith('SELECT id, recipient_id')) {
                    return rows;
                }
                if (sql.startsWith('UPDATE')) {
                    updates.push({ sql, bindings });
                    return [];
                }
                return [];
            },
        } as any,
    };
}

/**
 * [#16100] The `sys_migration` deployment ledger a host may or may not carry.
 *
 * `IDataEngine` does not declare `getObject`, so the receipt writer PROBES for
 * it — which makes "was a ledger configured on this double?" the difference
 * between a host that can hold the run receipt and one that cannot. A
 * `fakeEngine()` built with no argument is the latter, and that is deliberately
 * what every case predating #16100 exercises: they measure the migration, not
 * the receipt, and none of them may start writing a ledger row.
 */
interface FakeLedger {
    /** Rows already in `sys_migration` — e.g. a fresh store's birth attestation. */
    rows?: Array<Record<string, unknown>>;
    /** Object names this kernel has registered. Defaults to the ledger alone. */
    registered?: string[];
    /** Make every `sys_migration` write throw with this message. */
    failWrites?: string;
}

const LEDGER_OBJECT = 'sys_migration';

function fakeEngine(ledger?: FakeLedger) {
    const inserts: Array<{ object: string; row: any }> = [];
    const updates: Array<{ object: string; data: any }> = [];
    const finds: Array<{ object: string; query: any }> = [];
    const stored = new Map<string, Record<string, unknown>>(
        (ledger?.rows ?? []).map((r) => [String(r.id), { ...r }]),
    );
    const registered = new Set(ledger?.registered ?? [LEDGER_OBJECT]);
    return {
        inserts,
        updates,
        finds,
        /** The ledger's contents AFTER the run — the fresh-store assertion's subject. */
        stored,
        engine: {
            // Present only when a ledger was configured: the probe's own input.
            ...(ledger
                ? {
                      getObject(name: string) {
                          return registered.has(name) ? { name } : undefined;
                      },
                  }
                : {}),
            async insert(object: string, row: any) {
                inserts.push({ object, row });
                if (object === LEDGER_OBJECT) {
                    if (ledger?.failWrites) throw new Error(ledger.failWrites);
                    stored.set(String(row.id), { ...row });
                }
                return { id: `${object}_${inserts.length}`, ...row };
            },
            async update(object: string, data: any, options?: Record<string, unknown>) {
                assertEngineUpdateDispatch(data, options);
                updates.push({ object, data });
                if (object === LEDGER_OBJECT) {
                    if (ledger?.failWrites) throw new Error(ledger.failWrites);
                    const id = String(data.id);
                    // MERGE, not replace — that is what an UPDATE does to the
                    // columns it does not name, and the whole point of the
                    // fresh-store case is which columns are named.
                    stored.set(id, { ...(stored.get(id) ?? {}), ...data });
                }
                return data;
            },
            async find(object?: string, query?: Record<string, any>) {
                if (object !== undefined) finds.push({ object, query });
                if (ledger && object === LEDGER_OBJECT) {
                    const row = stored.get(String(query?.where?.id));
                    return row ? [{ ...row }] : [];
                }
                return [];
            },
            async findOne(object: string, query?: EngineFindOneQueryInput) {
                              assertEngineFindOnePredicate(object, query); return null; },
            async delete(_object?: string, options?: Record<string, unknown>) {
                assertEngineDeleteDispatch(options);
                return {};
            },
            async count() { return 0; },
            async aggregate() { return []; },
        } as any,
    };
}

describe('migrateSysNotificationToEvent', () => {
    it('splits each legacy row into inbox + receipt and rewrites the event', async () => {
        const d = fakeDriver([
            { id: 'n1', recipient_id: 'u1', type: 'mention', title: 'You were mentioned', body: 'hi', url: '/x', actor_name: 'Ada', is_read: 0, read_at: null, created_at: '2026-01-01T00:00:00.000Z', organization_id: 'org_1' },
            { id: 'n2', recipient_id: 'u2', type: 'assignment', title: 'Assigned', body: null, url: null, actor_name: null, is_read: 1, read_at: '2026-02-02T00:00:00.000Z', created_at: '2026-02-01T00:00:00.000Z', organization_id: 'org_1' },
        ]);
        const e = fakeEngine();

        const result = await migrateSysNotificationToEvent({ driver: d.driver, data: e.engine });

        expect(result.status).toBe('migrated');
        expect(result.migrated).toBe(2);

        const inbox = e.inserts.filter((i) => i.object === 'sys_inbox_message');
        const receipts = e.inserts.filter((i) => i.object === 'sys_notification_receipt');
        expect(inbox).toHaveLength(2);
        expect(receipts).toHaveLength(2);

        // Row 1: unread → delivered receipt; inbox keyed by recipient, linked to event.
        expect(inbox[0].row).toMatchObject({ user_id: 'u1', notification_id: 'n1', title: 'You were mentioned', action_url: '/x', organization_id: 'org_1' });
        expect(receipts[0].row).toMatchObject({ notification_id: 'n1', user_id: 'u1', channel: 'inbox', state: 'delivered' });

        // Row 2: read → read receipt carrying read_at.
        expect(receipts[1].row).toMatchObject({ notification_id: 'n2', user_id: 'u2', state: 'read', at: '2026-02-02T00:00:00.000Z' });

        // The event row is rewritten (topic ← type, payload built) and legacy columns nulled.
        const ev = e.updates.filter((u) => u.object === 'sys_notification');
        expect(ev[0].data).toMatchObject({ id: 'n1', topic: 'mention', payload: { title: 'You were mentioned', url: '/x', actorName: 'Ada' } });
        expect(d.updates).toHaveLength(2);
        expect(d.updates[0].sql).toContain('"recipient_id" = NULL');
        expect(d.updates[0].bindings).toEqual(['n1']);
    });

    it('works on a Postgres-style driver where PRAGMA throws (information_schema fallback)', async () => {
        // PRAGMA raises a syntax error on Postgres; columnExists must fall
        // through to information_schema rather than reporting not_applicable.
        const rows = [
            { id: 'n1', recipient_id: 'u1', type: 'mention', title: 'hi', body: null, url: null, actor_name: null, is_read: false, read_at: null, created_at: '2026-01-01T00:00:00.000Z', organization_id: 'org_1' },
        ];
        const updates: Array<{ sql: string; bindings: any[] }> = [];
        const pgDriver = {
            async raw(sql: string, bindings: any[] = []) {
                if (sql.startsWith('PRAGMA')) throw new Error('syntax error at or near "PRAGMA"');
                if (sql.includes('information_schema')) {
                    // bindings = [table, column]; report the column as present.
                    return [{ column_name: bindings[1] }];
                }
                if (sql.startsWith('SELECT id, recipient_id')) return rows;
                if (sql.startsWith('UPDATE')) { updates.push({ sql, bindings }); return []; }
                return [];
            },
        } as any;
        const e = fakeEngine();

        const result = await migrateSysNotificationToEvent({ driver: pgDriver, data: e.engine });

        expect(result.status).toBe('migrated');
        expect(result.migrated).toBe(1);
        expect(e.inserts.map((i) => i.object)).toEqual(['sys_inbox_message', 'sys_notification_receipt']);
    });

    it('is idempotent — no legacy rows means already_done', async () => {
        const d = fakeDriver([]);
        const e = fakeEngine();
        const result = await migrateSysNotificationToEvent({ driver: d.driver, data: e.engine });
        expect(result.status).toBe('already_done');
        expect(e.inserts).toHaveLength(0);
    });

    it('reports not_applicable when the table never had a recipient_id column', async () => {
        const d = fakeDriver([], ['id', 'topic', 'payload', 'severity', 'created_at']);
        const e = fakeEngine();
        const result = await migrateSysNotificationToEvent({ driver: d.driver, data: e.engine });
        expect(result.status).toBe('not_applicable');
    });

    it('errors cleanly when the driver has NEITHER raw() nor execute()', async () => {
        // The totality floor. A driver offering no raw-SQL surface at all must
        // still be refused — that half of the guard is not what was wrong with
        // it. What was wrong is that `raw` was the ONLY surface it accepted, so
        // it also refused every driver this repo ships; see
        // `real-driver-exec-surface.test.ts` for the other half.
        const e = fakeEngine();
        const result = await migrateSysNotificationToEvent({ driver: {} as any, data: e.engine });
        expect(result.status).toBe('error');
        expect(result.error).toContain('.execute(sql, bindings?)');
        expect(result.error).toContain('.raw(sql, bindings?)');
    });

    it('drives a driver that offers only execute(), passing bindings positionally', async () => {
        // A double deliberately shaped like the DECLARED contract
        // (`IDataDriver.execute(command, parameters?, options?)`) rather than
        // like the helper's old assumption. The real-driver coverage lives in
        // `real-driver-exec-surface.test.ts`; this case additionally pins that
        // the second argument arrives as the bindings ARRAY, which is the part a
        // mechanical `raw`->`execute` rename could get wrong silently.
        const seen: Array<{ sql: string; bindings: unknown }> = [];
        const executeOnly = {
            async execute(sql: string, bindings?: unknown[]) {
                seen.push({ sql, bindings });
                if (sql.startsWith('PRAGMA table_info')) {
                    return LEGACY_TABLE_COLUMNS.map((name) => ({ name }));
                }
                if (sql.startsWith('SELECT id, recipient_id')) {
                    return [{ id: 'n1', recipient_id: 'u1', type: 'mention', title: 't', body: null, url: null, actor_name: null, is_read: 0, read_at: null, created_at: '2026-01-01T00:00:00.000Z', organization_id: 'org_1' }];
                }
                return [];
            },
        } as any;
        expect(typeof executeOnly.raw, 'the double must NOT carry a raw()').not.toBe('function');
        const e = fakeEngine();

        const result = await migrateSysNotificationToEvent({ driver: executeOnly, data: e.engine });

        expect(result.status).toBe('migrated');
        expect(result.migrated).toBe(1);
        const update = seen.find((c) => c.sql.startsWith('UPDATE'));
        expect(update?.bindings).toEqual(['n1']);
        // An unbound statement gets an empty array, never `undefined` — the
        // shape `SqlDriver.execute` and TursoDriver both normalize to anyway.
        expect(seen.find((c) => c.sql.startsWith('PRAGMA'))?.bindings).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// [#13998] What this migration WRITES, when the legacy row hands out a `Date`.
//
// `selectLegacyRows` reads through `driver.raw`/`execute` — a door that does
// not run `formatOutput`, so none of its repairs apply. On SQLite the legacy
// stamps come back as canonical ISO TEXT and `String(row.created_at)` is the
// IDENTITY, which is why every case above stayed green while the defect was
// live. On Postgres and MySQL an instant column materialises as a JS `Date`
// (pinned in `driver-sql/src/sql-driver-13567-audit-stamp-materialisation.test.ts`),
// and this migration is one-way: whatever spelling lands is what the platform
// carries afterwards.
//
// `@objectstack/metadata` has no driver dependency and must not grow one — the
// layering runs the other way — so, exactly like the OCC seam's own regression
// suite, the discriminating input here is a HAND-MADE `Date`. That is the whole
// point of these cases: they break the SQLite identity the cases above rely on.
// ---------------------------------------------------------------------------

/** The instant from the production report, kept verbatim (#13567 / #13382). */
const REPORTED_INSTANT = '2026-08-30T10:19:25.947Z';
/** A second instant, so the receipt's `at` cannot pass by matching `created_at`. */
const REPORTED_READ_INSTANT = '2026-08-31T02:03:04.567Z';

/** Canonical audit-timestamp text — what SQLite stores and what must be written. */
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Run `body` with the process pinned to `tz`, then restore.
 *
 * Forced rather than required so these cases are non-vacuous on any runner:
 * Test Core runs at UTC, a developer runs at whatever their laptop is set to.
 * Restoring rather than assuming matters because vitest reuses a worker across
 * files — a leaked `TZ` would silently re-zone whatever runs next in this
 * process. Mirrors `underProcessZone` in the driver-side pin.
 */
async function underProcessZone<T>(tz: string, body: () => Promise<T> | T): Promise<T> {
    const previous = process.env.TZ;
    process.env.TZ = tz;
    try {
        return await body();
    } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
    }
}

describe('#13998 the timestamp spelling written into the new rows', () => {
    it('control — `String(Date)` is NOT the canonical spelling (the input discriminates)', async () => {
        const value = new Date(REPORTED_INSTANT);
        expect(value.getMilliseconds(), 'the fixture is vacuous without sub-second digits').toBe(947);

        const spelled = await underProcessZone('Asia/Shanghai', () => String(value));
        // The prefix only: the trailing `(China Standard Time)` is the one
        // implementation-defined part of `toString`.
        expect(spelled.startsWith('Sun Aug 30 2026 18:19:25 GMT+0800')).toBe(true);
        // Whole seconds in the PROCESS zone: the milliseconds are gone.
        expect(Date.parse(spelled)).toBe(value.getTime() - value.getMilliseconds());
        expect(spelled).not.toBe(REPORTED_INSTANT);
        expect(spelled).not.toMatch(ISO_Z);
        // …and the canonical rendering of the same instant is zone-independent.
        expect(value.toISOString()).toBe(REPORTED_INSTANT);
    });

    it('canonicalises a `Date` created_at/read_at into ISO on inbox, receipt and receipt.at', async () => {
        const createdAt = new Date(REPORTED_INSTANT);
        const readAt = new Date(REPORTED_READ_INSTANT);
        const d = fakeDriver([
            {
                id: 'n1', recipient_id: 'u1', type: 'mention', title: 'You were mentioned',
                body: 'hi', url: '/x', actor_name: 'Ada', is_read: 1,
                // The discriminating input: what Postgres/MySQL actually hand out.
                read_at: readAt, created_at: createdAt, organization_id: 'org_1',
            },
        ]);
        const e = fakeEngine();

        const result = await underProcessZone('Asia/Shanghai', () =>
            migrateSysNotificationToEvent({ driver: d.driver, data: e.engine }));

        expect(result.status).toBe('migrated');
        expect(result.migrated).toBe(1);

        const inbox = e.inserts.find((i) => i.object === 'sys_inbox_message')!;
        const receipt = e.inserts.find((i) => i.object === 'sys_notification_receipt')!;

        // Every written stamp is canonical ISO-Z text — not a `Date`, and not a
        // `Date.prototype.toString` rendering carrying the migrating host's zone.
        for (const [where, written] of [
            ['inbox.created_at', inbox.row.created_at],
            ['receipt.created_at', receipt.row.created_at],
            ['receipt.at', receipt.row.at],
        ] as const) {
            expect(typeof written, `${where} must be written as text`).toBe('string');
            expect(written as string, `${where} must be canonical ISO-Z`).toMatch(ISO_Z);
            // The zone the OLD spelling would have baked in is absent.
            expect(written as string, `${where} must not carry a GMT offset`).not.toContain('GMT');
        }

        // The instants themselves are preserved to the millisecond — the half
        // `String(Date)` silently dropped.
        expect(inbox.row.created_at).toBe(REPORTED_INSTANT);
        expect(receipt.row.created_at).toBe(REPORTED_INSTANT);
        expect(receipt.row.at).toBe(REPORTED_READ_INSTANT);
        // …and `at` is the READ stamp, not `created_at` echoed back.
        expect(receipt.row.at).not.toBe(receipt.row.created_at);

        // The zone was restored rather than leaked into whatever runs next.
        expect(process.env.TZ).not.toBe('Asia/Shanghai');
    });

    it('leaves canonical ISO text exactly as it found it (the SQLite path is unchanged)', async () => {
        const d = fakeDriver([
            {
                id: 'n1', recipient_id: 'u1', type: 'mention', title: 'hi', body: null,
                url: null, actor_name: null, is_read: 1, read_at: REPORTED_READ_INSTANT,
                created_at: REPORTED_INSTANT, organization_id: 'org_1',
            },
        ]);
        const e = fakeEngine();

        const result = await migrateSysNotificationToEvent({ driver: d.driver, data: e.engine });

        expect(result.status).toBe('migrated');
        const inbox = e.inserts.find((i) => i.object === 'sys_inbox_message')!;
        const receipt = e.inserts.find((i) => i.object === 'sys_notification_receipt')!;
        expect(inbox.row.created_at).toBe(REPORTED_INSTANT);
        expect(receipt.row.created_at).toBe(REPORTED_INSTANT);
        expect(receipt.row.at).toBe(REPORTED_READ_INSTANT);
    });
});

// ---------------------------------------------------------------------------
// [#16100] The run receipt in the `sys_migration` deployment ledger.
//
// What a run of this migration may claim under `NOTIFICATION_EVENT_MIGRATION_ID`
// is RULED (maintainer 「同意」 to decision batch #47 item 5, recorded on
// #15710) and the ruling lives on that constant's docblock in
// `@objectstack/spec/system`. The spec side already pins the ruling's TEXT and
// that the receipt shape authorises nothing
// (`packages/spec/src/system/notification-event-migration-ledger.pin.test.ts`);
// these cases pin the RUNTIME half — what this writer actually sends, per
// outcome.
//
// ⚠️ There is no operator-reachable run of this migration today: it has no
// production call site and `os migrate` has no `notification-event`
// sub-command. Until that changes these cases are the ONLY thing that exercises
// the writer, which is why every arm of the matrix is pinned separately rather
// than one happy path standing in for four.
// ---------------------------------------------------------------------------

/** The run's injected clock — every stamp the receipt writes is this instant. */
const RUN_AT = '2026-09-06T07:08:09.000Z';
/** A different instant, so a preserved birth stamp cannot pass by matching it. */
const BIRTH_AT = '2026-03-04T05:06:07.000Z';

type FakeEngineHarness = ReturnType<typeof fakeEngine>;

/** Every write this run sent to the ledger object, in order. */
function ledgerWrites(e: FakeEngineHarness) {
    return [
        ...e.inserts.filter((i) => i.object === LEDGER_OBJECT).map((i) => ({ verb: 'insert' as const, row: i.row })),
        ...e.updates.filter((u) => u.object === LEDGER_OBJECT).map((u) => ({ verb: 'update' as const, row: u.data })),
    ];
}

/** The ledger row as it stands AFTER the run. */
function ledgerRow(e: FakeEngineHarness) {
    return e.stored.get(NOTIFICATION_EVENT_MIGRATION_ID);
}

/** A legacy row, so the run reports `migrated`. */
function legacyRow() {
    return {
        id: 'n1', recipient_id: 'u1', type: 'mention', title: 'hi', body: null, url: null,
        actor_name: null, is_read: 0, read_at: null,
        created_at: '2026-01-01T00:00:00.000Z', organization_id: 'org_1',
    };
}

describe('#16100 the run receipt written into sys_migration', () => {
    it('control: the id and the ledger object are the ones the contract declares', () => {
        // Without this the cases below could all agree with each other about a
        // string neither the reader nor the attestation writer uses.
        expect(NOTIFICATION_EVENT_MIGRATION_ID).toBe('adr-0030-notification-event');
        expect(DATA_MIGRATION_FLAG_OBJECT).toBe(LEDGER_OBJECT);
    });

    it('`migrated` — claims last_run_at AND applied_at, never verified_at', async () => {
        const d = fakeDriver([legacyRow()]);
        const e = fakeEngine({});

        const result = await migrateSysNotificationToEvent({ driver: d.driver, data: e.engine, now: () => RUN_AT });

        expect(result.status).toBe('migrated');
        expect(result.receipt).toEqual({ outcome: 'inserted' });
        const writes = ledgerWrites(e);
        expect(writes.map((w) => w.verb)).toEqual(['insert']);
        expect(writes[0]!.row).toMatchObject({
            id: NOTIFICATION_EVENT_MIGRATION_ID,
            last_run_at: RUN_AT,
            applied_at: RUN_AT,
            verified_at: null,
            blocking: 0,
            details: JSON.stringify({ outcome: 'migrated' }),
        });
    });

    it.each(['already_done', 'not_applicable'] as const)(
        '`%s` — claims last_run_at and NOT applied_at',
        async (outcome) => {
            // `already_done`: the legacy column is there and no legacy row is.
            // `not_applicable`: the column was never there at all.
            const d = outcome === 'already_done'
                ? fakeDriver([])
                : fakeDriver([], ['id', 'topic', 'payload', 'severity', 'created_at']);
            const e = fakeEngine({});

            const result = await migrateSysNotificationToEvent({ driver: d.driver, data: e.engine, now: () => RUN_AT });

            expect(result.status).toBe(outcome);
            expect(result.receipt).toEqual({ outcome: 'inserted' });
            const writes = ledgerWrites(e);
            expect(writes.map((w) => w.verb)).toEqual(['insert']);
            expect(writes[0]!.row).toMatchObject({
                id: NOTIFICATION_EVENT_MIGRATION_ID,
                last_run_at: RUN_AT,
                applied_at: null,
                verified_at: null,
                blocking: 0,
                details: JSON.stringify({ outcome }),
            });
        },
    );

    it('`error` (no raw-SQL surface) — writes NO ledger claim, and does not even read the ledger', async () => {
        const e = fakeEngine({});

        const result = await migrateSysNotificationToEvent({ driver: {} as any, data: e.engine, now: () => RUN_AT });

        expect(result.status).toBe('error');
        expect(result.receipt).toEqual({ outcome: 'not-claimed' });
        expect(ledgerWrites(e)).toEqual([]);
        expect(e.stored.size).toBe(0);
        // Not merely "wrote nothing": an `error` run has no business asking the
        // ledger anything, so the read never happens either.
        expect(e.finds.filter((f) => f.object === LEDGER_OBJECT)).toEqual([]);
    });

    it('`error` (a throw mid-run) — the other error return site claims nothing either', async () => {
        // The first `error` case returns before the try block; this one comes
        // out of the catch, with rows already rewritten. Both must be silent in
        // the ledger, and only a case per return site can say so.
        const failing = {
            async raw(sql: string) {
                if (sql.startsWith('PRAGMA table_info')) return LEGACY_TABLE_COLUMNS.map((name) => ({ name }));
                if (sql.startsWith('SELECT id, recipient_id')) throw new Error('connection reset');
                return [];
            },
        } as any;
        const e = fakeEngine({});

        const result = await migrateSysNotificationToEvent({ driver: failing, data: e.engine, now: () => RUN_AT });

        expect(result.status).toBe('error');
        expect(result.error).toContain('connection reset');
        expect(result.receipt).toEqual({ outcome: 'not-claimed' });
        expect(ledgerWrites(e)).toEqual([]);
    });

    it('details carries exactly `{ outcome }`, JSON-encoded — nothing else', async () => {
        const d = fakeDriver([legacyRow()]);
        const e = fakeEngine({});
        await migrateSysNotificationToEvent({ driver: d.driver, data: e.engine, now: () => RUN_AT });
        expect(JSON.parse(String(ledgerRow(e)!.details))).toEqual({ outcome: 'migrated' });
    });

    it('the receipt authorises nothing — and the control shows the `false` is the null, not the shape', async () => {
        const d = fakeDriver([legacyRow()]);
        const e = fakeEngine({});

        await migrateSysNotificationToEvent({ driver: d.driver, data: e.engine, now: () => RUN_AT });

        // Read back through the SHIPPED reader, not through the row literal:
        // "receipt, not gate" is a claim about what a consumer sees.
        expect(await isDataMigrationVerified(e.engine, NOTIFICATION_EVENT_MIGRATION_ID)).toBe(false);
        // Non-vacuity: the same row with a certificate WOULD authorise, so the
        // `false` above is about `verified_at` and not about an unreadable row.
        e.stored.set(NOTIFICATION_EVENT_MIGRATION_ID, { ...ledgerRow(e)!, verified_at: RUN_AT });
        expect(await isDataMigrationVerified(e.engine, NOTIFICATION_EVENT_MIGRATION_ID)).toBe(true);
    });
});

describe('#16100 the fresh-store case — a birth attestation this writer may not touch', () => {
    /**
     * Seed the row the way a real fresh store gets it: through the SHIPPED
     * producer, `attestFreshDatastore`, which sets `verified_at` at birth for
     * every member of `CREATION_ATTESTED_MIGRATION_IDS` — this id among them.
     * Hand-writing the row here would pin this file's idea of the birth shape
     * instead of the producer's.
     */
    async function freshStore(rows: any[] = [], columns?: string[]) {
        const e = fakeEngine({});
        const attested = await attestFreshDatastore(e.engine, {
            migrationIds: [NOTIFICATION_EVENT_MIGRATION_ID],
        });
        expect(attested, 'the birth attestation did not happen — the case would be vacuous')
            .toEqual([NOTIFICATION_EVENT_MIGRATION_ID]);
        const birth = e.stored.get(NOTIFICATION_EVENT_MIGRATION_ID)!;
        expect(birth.verified_at, 'a fresh store is verified BY BIRTH — nothing to preserve otherwise')
            .toBeTruthy();
        // Re-stamp the birth columns to a distinct instant so a value that
        // merely LOOKS preserved cannot be this run's own stamp echoed back.
        e.stored.set(NOTIFICATION_EVENT_MIGRATION_ID, {
            ...birth, verified_at: BIRTH_AT, last_run_at: BIRTH_AT, created_at: BIRTH_AT, updated_at: BIRTH_AT,
        });
        e.inserts.length = 0;
        e.updates.length = 0;
        e.finds.length = 0;
        const d = columns ? fakeDriver(rows, columns) : fakeDriver(rows);
        return { e, d };
    }

    it('a `not_applicable` run UPDATES the row and never names verified_at or applied_at', async () => {
        // The realistic fresh-store shape: the table was created after the
        // cut-over, so it has no `recipient_id` column at all.
        const { e, d } = await freshStore([], ['id', 'topic', 'payload', 'severity', 'created_at']);

        const result = await migrateSysNotificationToEvent({ driver: d.driver, data: e.engine, now: () => RUN_AT });

        expect(result.status).toBe('not_applicable');
        expect(result.receipt).toEqual({ outcome: 'updated' });

        const writes = ledgerWrites(e);
        expect(writes.map((w) => w.verb)).toEqual(['update']);
        // The payload half: the columns are not sent AT ALL. Asserting the
        // stored value alone would pass on a writer that sent the old value
        // back, which is a different (and unwritable) thing to promise.
        expect(Object.keys(writes[0]!.row).sort()).toEqual(
            ['blocking', 'details', 'id', 'last_run_at', 'updated_at'],
        );
        expect(writes[0]!.row).not.toHaveProperty('verified_at');
        expect(writes[0]!.row).not.toHaveProperty('applied_at');

        // The stored half: the birth certificate survives, untouched and still
        // distinguishable from this run's stamp.
        const row = ledgerRow(e)!;
        expect(row.verified_at).toBe(BIRTH_AT);
        expect(row.applied_at).toBe(null);
        expect(row.last_run_at).toBe(RUN_AT);
        expect(JSON.parse(String(row.details))).toEqual({ outcome: 'not_applicable' });

        // And it still reads as verified — by birth, never by this run.
        expect(await isDataMigrationVerified(e.engine, NOTIFICATION_EVENT_MIGRATION_ID)).toBe(true);
    });

    it('a `migrated` run on a fresh store stamps applied_at and STILL leaves verified_at alone', async () => {
        const { e, d } = await freshStore([legacyRow()]);

        const result = await migrateSysNotificationToEvent({ driver: d.driver, data: e.engine, now: () => RUN_AT });

        expect(result.status).toBe('migrated');
        expect(result.receipt).toEqual({ outcome: 'updated' });
        const writes = ledgerWrites(e);
        expect(writes[0]!.row).toMatchObject({ last_run_at: RUN_AT, applied_at: RUN_AT });
        expect(writes[0]!.row).not.toHaveProperty('verified_at');
        expect(ledgerRow(e)!.verified_at).toBe(BIRTH_AT);
    });

    it('a later non-`migrated` run does not CLEAR an earlier run\'s applied_at', async () => {
        // The other half of "applied_at only on `migrated`": only on `migrated`
        // is it STAMPED — it is never un-stamped, because an earlier backfill
        // really did happen and a later no-op does not undo it.
        const e = fakeEngine({});
        const first = await migrateSysNotificationToEvent({
            driver: fakeDriver([legacyRow()]).driver, data: e.engine, now: () => BIRTH_AT,
        });
        expect(first.status).toBe('migrated');
        expect(ledgerRow(e)!.applied_at).toBe(BIRTH_AT);

        const second = await migrateSysNotificationToEvent({
            driver: fakeDriver([]).driver, data: e.engine, now: () => RUN_AT,
        });

        expect(second.status).toBe('already_done');
        expect(second.receipt).toEqual({ outcome: 'updated' });
        expect(ledgerRow(e)!.applied_at).toBe(BIRTH_AT);
        expect(ledgerRow(e)!.last_run_at).toBe(RUN_AT);
    });
});

describe('#16100 when the claim cannot land, the caller is told', () => {
    it('a host with no object registry reports `no-ledger` and writes nothing', async () => {
        // `fakeEngine()` with NO argument carries no `getObject` — exactly the
        // double every case predating #16100 uses, which is why none of them
        // acquired a ledger write.
        const d = fakeDriver([legacyRow()]);
        const e = fakeEngine();

        const result = await migrateSysNotificationToEvent({ driver: d.driver, data: e.engine, now: () => RUN_AT });

        expect(result.status).toBe('migrated');
        expect(result.receipt.outcome).toBe('no-ledger');
        expect(result.receipt.reason).toContain('getObject');
        expect(e.inserts.map((i) => i.object)).toEqual(['sys_inbox_message', 'sys_notification_receipt']);
    });

    it('an engine without the ledger object registered reports `no-ledger` and names the remedy', async () => {
        const d = fakeDriver([legacyRow()]);
        const e = fakeEngine({ registered: [] });

        const result = await migrateSysNotificationToEvent({ driver: d.driver, data: e.engine, now: () => RUN_AT });

        expect(result.status).toBe('migrated');
        expect(result.receipt.outcome).toBe('no-ledger');
        expect(result.receipt.reason).toContain(DATA_MIGRATION_FLAG_OBJECT);
        expect(result.receipt.reason).toContain('PlatformObjectsPlugin');
        expect(ledgerWrites(e)).toEqual([]);
    });

    it('a ledger write that throws reports `failed` and leaves the migration result intact', async () => {
        // The #4420 shape on this row: the data really was rewritten, every
        // other reading is clean, and the only durable record that it happened
        // is absent. The caller is told, which is what keeps it from being a
        // silent degradation.
        const d = fakeDriver([legacyRow()]);
        const e = fakeEngine({ failWrites: 'readonly transaction' });

        const result = await migrateSysNotificationToEvent({ driver: d.driver, data: e.engine, now: () => RUN_AT });

        expect(result.status).toBe('migrated');
        expect(result.migrated).toBe(1);
        expect(result.receipt).toEqual({ outcome: 'failed', reason: 'readonly transaction' });
        expect(e.stored.size).toBe(0);
    });
});
