// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16312] The `sys_notification` → event migration keeps the ORIGINAL
 * notification instant, measured through the REAL `sys_stamp_audit_insert`
 * hook.
 *
 * ## Why this file exists, and why it is not in `packages/metadata`
 *
 * The migration under test lives in
 * `packages/metadata/src/migrations/migrate-sys-notification-to-event.ts` and
 * its own suite drives it through a **fake engine double** whose `insert`
 * records the payload directly. That double is faithful about DISPATCH — its
 * write verbs route through `assertEngineUpdateDispatch` /
 * `assertEngineDeleteDispatch`, so it cannot accept a call `ObjectQL` would
 * refuse — and **silent about the before phase**: it runs no hooks at all.
 *
 * The defect lived in exactly that seam. `sys_stamp_audit_insert` used to read
 * `record.created_at = record.created_at ?? now` on EVERY insert, so the
 * migration's back-dated `created_at` survived by accident. #15964 ruled that
 * laundering out (maintainer ruling 2026-09-06, decision batch #54, option A):
 * an ordinary create now stamps `now`, and preservation is DECLARED through
 * `context.preserveAudit`. This migration never declared it — and the sibling
 * suite stayed `23 passed` on both sides of that change, because a double that
 * runs no hooks cannot tell the two behaviours apart.
 *
 * ⇒ a test that still uses that double proves nothing here, however well its
 * assertions read. This one boots a REAL kernel: `ObjectQLPlugin` registers
 * the shipped audit hooks, `MessagingServicePlugin` registers and provisions
 * `sys_notification` / `sys_inbox_message` / `sys_notification_receipt`, and
 * `SqliteWasmDriver` is a real driver running real SQLite in-process.
 *
 * ⚠️ It is in `packages/runtime` and not next to the code it tests because
 * **`@objectstack/objectql` depends on `@objectstack/metadata`** — the edge a
 * test-only import would close is a cycle turbo rejects, which is the same
 * constraint `migrations/real-driver-exec-surface.test.ts` records in its own
 * header and the reason `date-bucket-parity-turso` moved out of its driver
 * package. `@objectstack/runtime` is the nearest package that depends on BOTH
 * halves, and it already owns this domain (`src/domains/notifications.ts`,
 * `notification-schema-conformance.integration.test.ts`).
 *
 * ## The three readings, and why the first two are load-bearing
 *
 * `hook is live` and `the declared channel is open` are ANTI-VACUITY controls.
 * Without them a green `the migration preserves` is indistinguishable from a
 * fixture where no hook ran — which is precisely the failure mode this file
 * exists to close, so it must not be able to recur one level up. Delete the
 * `preserveAudit` flag from the migration and only the third goes red; delete
 * the audit hook from the engine and the FIRST goes red, by name.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { MessagingServicePlugin } from '@objectstack/service-messaging';
import { migrateSysNotificationToEvent } from '@objectstack/metadata/migrations';
import type { IDataEngine } from '@objectstack/spec/contracts';

import { DriverPlugin } from './driver-plugin.js';

const EVENT_OBJECT = 'sys_notification';
const INBOX_OBJECT = 'sys_inbox_message';
const RECEIPT_OBJECT = 'sys_notification_receipt';

/**
 * The legacy inbox columns ADR-0030 removed from the object. A deployment that
 * predates the cut-over still carries them, so the fixture puts them back onto
 * the table the plugin provisions — which is what the migration's own
 * `columnExists` probe is written to find.
 */
const LEGACY_COLUMNS: ReadonlyArray<readonly [string, string]> = [
    ['recipient_id', 'TEXT'],
    ['type', 'TEXT'],
    ['title', 'TEXT'],
    ['body', 'TEXT'],
    ['url', 'TEXT'],
    ['actor_name', 'TEXT'],
    ['is_read', 'INTEGER'],
    ['read_at', 'TEXT'],
];

/**
 * Deliberately years in the past. The whole verdict is "is this instant, or the
 * instant the migration ran, on the row?" — so the two must never be within a
 * clock-skew of each other, and `expect(...).not.toBe(RUN_WINDOW)` is not what
 * discriminates: the positive assertion is.
 */
const NOTIFICATION_INSTANT = '2019-03-04T05:06:07.891Z';
const READ_INSTANT = '2019-03-05T06:07:08.912Z';

/** `Date.parse` of a stored value, whatever spelling the driver handed back. */
function instantOf(value: unknown): number {
    if (value instanceof Date) return value.getTime();
    return Date.parse(String(value));
}

describe('[#16312] the sys_notification migration preserves the original audit timeline', () => {
    let kernel: ObjectKernel;
    let driver: SqliteWasmDriver;
    let data: IDataEngine;
    /** Raw SQL through the driver's own surface — the same door an operator has. */
    let sql: (statement: string, bindings?: unknown[]) => Promise<any>;
    /** Wall clock read just before the migration runs; the value the defect writes. */
    let runWindowStart = 0;

    beforeAll(async () => {
        kernel = new ObjectKernel({ logger: { level: 'silent' } });
        driver = new SqliteWasmDriver({ filename: ':memory:' });
        await kernel.use(new DriverPlugin(driver));
        await kernel.use(new ObjectQLPlugin());
        // Inline delivery: this file never calls `emit()`, but the plugin's
        // table provisioning is what puts the three objects on the database.
        await kernel.use(new MessagingServicePlugin({ reliableDelivery: false }));
        await kernel.bootstrap();

        data = kernel.getService<IDataEngine>('objectql');
        sql = (statement, bindings) => (driver as any).execute(statement, bindings ?? []);

        // Put the pre-ADR-0030 inbox columns back on the provisioned table.
        for (const [column, type] of LEGACY_COLUMNS) {
            await sql(`ALTER TABLE "${EVENT_OBJECT}" ADD COLUMN "${column}" ${type}`);
        }

        // One legacy row, written through raw SQL exactly as the old shape left
        // it — no engine, no hooks, so `created_at` is the notification's own
        // instant and nothing has had a chance to restamp it.
        await sql(
            `INSERT INTO "${EVENT_OBJECT}" (id, recipient_id, type, title, body, url, actor_name, is_read, read_at, created_at) ` +
                `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                'ntf_legacy_16312',
                'usr_16312',
                'task.assigned',
                'Legacy notification',
                'body text',
                '/records/1',
                'Ada',
                1,
                READ_INSTANT,
                NOTIFICATION_INSTANT,
            ],
        );

        runWindowStart = Date.now();
        const result = await migrateSysNotificationToEvent({ driver, data });
        expect(result.status).toBe('migrated');
        expect(result.migrated).toBe(1);
    }, 120_000);

    afterAll(async () => {
        if (kernel) {
            await Promise.race([
                kernel.shutdown(),
                new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
            ]);
        }
    }, 30_000);

    /**
     * ANTI-VACUITY CONTROL — the shipped audit hook really runs on this engine.
     *
     * An ordinary insert carrying a back-dated `created_at` and NO write
     * context must come back stamped with the write instant. This is the
     * assertion the fake-engine double in `packages/metadata` cannot make, and
     * it is what makes the third case below a measurement rather than a
     * restatement of the fixture.
     */
    it('control — the real audit hook is live here: an ordinary insert is restamped `now`', async () => {
        const before = Date.now();
        await data.insert(INBOX_OBJECT, {
            user_id: 'usr_control_ordinary',
            notification_id: 'ntf_control_ordinary',
            topic: 'control',
            title: 'ordinary create',
            severity: 'info',
            created_at: NOTIFICATION_INSTANT,
        });
        const rows = await sql(
            `SELECT created_at FROM "${INBOX_OBJECT}" WHERE user_id = ?`,
            ['usr_control_ordinary'],
        );
        const stored = instantOf(firstRow(rows).created_at);
        expect(stored).not.toBe(Date.parse(NOTIFICATION_INSTANT));
        expect(stored).toBeGreaterThanOrEqual(before - 1000);
    });

    /**
     * ANTI-VACUITY CONTROL — the historical-import channel is open on THIS
     * write path, for THIS object.
     *
     * `preserveAudit` is a fossil with a ruling behind it (#3493, reaffirmed by
     * #15964): it is the declared channel for reinstating an original timeline,
     * not a bypass of audit. The 2026-08-08 ruling narrowed the create-side
     * READONLY-strip exemption to `isSystem` only — but `staticReadonlyInsertSubject`
     * exits early for a `sys_`-prefixed or `managedBy` object, so no strip runs
     * on these two at all and no `preserveAudit is UPDATE-only` warning is owed.
     * That reasoning is what this case turns into a measurement.
     */
    it('control — `context.preserveAudit` keeps a supplied created_at on this object', async () => {
        await data.insert(
            INBOX_OBJECT,
            {
                user_id: 'usr_control_preserve',
                notification_id: 'ntf_control_preserve',
                topic: 'control',
                title: 'declared historical create',
                severity: 'info',
                created_at: NOTIFICATION_INSTANT,
            },
            { context: { preserveAudit: true } },
        );
        const rows = await sql(
            `SELECT created_at FROM "${INBOX_OBJECT}" WHERE user_id = ?`,
            ['usr_control_preserve'],
        );
        expect(instantOf(firstRow(rows).created_at)).toBe(Date.parse(NOTIFICATION_INSTANT));
    });

    /**
     * THE CARD. Both migrated rows carry the NOTIFICATION's instant, not the
     * migration's.
     *
     * RED before the fix: the two writes passed no options bag at all, so the
     * audit hook took the ordinary branch and stamped the migration instant on
     * every migrated inbox row and receipt — an entire bell history flattened
     * to "all arrived today".
     */
    it('the migrated inbox row keeps the notification instant, not the migration instant', async () => {
        const rows = await sql(
            `SELECT created_at FROM "${INBOX_OBJECT}" WHERE notification_id = ?`,
            ['ntf_legacy_16312'],
        );
        expect(instantOf(firstRow(rows).created_at)).toBe(Date.parse(NOTIFICATION_INSTANT));
    });

    it('the migrated receipt keeps the notification instant on created_at and the read instant on `at`', async () => {
        const rows = await sql(
            `SELECT created_at, at FROM "${RECEIPT_OBJECT}" WHERE notification_id = ?`,
            ['ntf_legacy_16312'],
        );
        const row = firstRow(rows);
        expect(instantOf(row.created_at)).toBe(Date.parse(NOTIFICATION_INSTANT));
        // `at` is an ordinary declared field, so no audit hook was ever going
        // to touch it. Asserted anyway: it is the half of the receipt's
        // timeline that was ALREADY correct, and a change that "fixed"
        // `created_at` by moving both to one value would be caught here.
        expect(instantOf(row.at)).toBe(Date.parse(READ_INSTANT));
    });

    /**
     * The source row survives the migration with its own `created_at` intact —
     * the fact that makes a bad run recoverable rather than terminal. It is
     * asserted here because the migration REWRITES this row (`data.update` to
     * the event shape, then a raw `SET … = NULL` over the legacy columns), and
     * `created_at` is in neither of those two sets.
     */
    it('the source sys_notification row is rewritten in place and keeps its own created_at', async () => {
        const rows = await sql(
            `SELECT created_at, topic, recipient_id FROM "${EVENT_OBJECT}" WHERE id = ?`,
            ['ntf_legacy_16312'],
        );
        const row = firstRow(rows);
        expect(instantOf(row.created_at)).toBe(Date.parse(NOTIFICATION_INSTANT));
        // Rewritten, not skipped: the event shape landed and the legacy
        // recipient is gone, so this row really did go through both writes.
        expect(row.topic).toBe('task.assigned');
        expect(row.recipient_id).toBeNull();
        // ⇒ and it still predates the run. This is the seat's re-grading input
        // stated as an assertion: a bad run is recoverable because the source
        // instant is still here to backfill FROM.
        expect(instantOf(row.created_at)).toBeLessThan(runWindowStart);
    });
});

/** knex wraps some results as `[rows]`; normalize both shapes and take the first. */
function firstRow(result: any): any {
    const list = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    return list[0];
}
