// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Migration: sys_notification (per-user inbox) → notification event (ADR-0030)
 *
 * ADR-0030 re-models `sys_notification` from a per-user *inbox* into the L2
 * *event* (one row per `emit`). This migration preserves users' existing bell
 * notifications across the cut-over by splitting each legacy row into the new
 * layered model:
 *
 *   legacy sys_notification row (recipient_id, type, title, body, url,
 *       actor_name, is_read, read_at, …)
 *     │
 *     ├─► sys_inbox_message      (L5 in-app materialization, keyed by user)
 *     ├─► sys_notification_receipt (L5 read-state: 'read' if is_read else 'delivered')
 *     └─► the sys_notification row itself is rewritten to the event shape
 *         (topic ← type, payload ← {title,body,url,actor_name}) and its legacy
 *         inbox columns are cleared.
 *
 * Idempotent: it acts only on rows that still carry the legacy shape
 * (`recipient_id IS NOT NULL`); a second run is a no-op. Safe when the legacy
 * columns were never present (a fresh install created directly in the new
 * shape) — it reports `not_applicable`.
 *
 * Usage:
 *   import { migrateSysNotificationToEvent } from '@objectstack/metadata/migrations';
 *   await migrateSysNotificationToEvent({ driver, data });
 *
 * `driver` provides raw access to read legacy columns the re-modeled schema no
 * longer projects and to clear them — through the surface `IDataDriver`
 * declares, `execute(sql, bindings?)`, falling back to `raw(sql, bindings?)`
 * (see `./driver-exec.ts`); `data` (IDataEngine) performs the
 * structured inbox/receipt writes and the event rewrite so ids, JSON fields and
 * tenant stamping are handled uniformly across drivers.
 */

import type { IDataDriver, IDataEngine } from '@objectstack/spec/contracts';

import { type DriverExec, driverExecRefusal, resolveDriverExec } from './driver-exec.js';

const EVENT_OBJECT = 'sys_notification';
const INBOX_OBJECT = 'sys_inbox_message';
const RECEIPT_OBJECT = 'sys_notification_receipt';

/** Legacy inbox columns cleared once a row is rewritten to the event shape. */
const LEGACY_COLUMNS = [
    'recipient_id',
    'type',
    'title',
    'body',
    'url',
    'actor_name',
    'is_read',
    'read_at',
] as const;

export interface SysNotificationMigrationResult {
    status: 'migrated' | 'already_done' | 'not_applicable' | 'error';
    /** Number of legacy rows split into inbox + receipt + event. */
    migrated: number;
    error?: string;
}

export interface SysNotificationMigrationOptions {
    driver: IDataDriver;
    data: IDataEngine;
    /** Defaults to `() => new Date().toISOString()`. */
    now?(): string;
}

export async function migrateSysNotificationToEvent(
    opts: SysNotificationMigrationOptions,
): Promise<SysNotificationMigrationResult> {
    const { data } = opts;
    const now = opts.now ?? (() => new Date().toISOString());

    const exec = resolveDriverExec(opts.driver);
    if (!exec) {
        return {
            status: 'error',
            migrated: 0,
            error: driverExecRefusal('migrateSysNotificationToEvent'),
        };
    }

    // No legacy `recipient_id` column → the table never held the inbox shape.
    if (!(await columnExists(exec, EVENT_OBJECT, 'recipient_id'))) {
        return { status: 'not_applicable', migrated: 0 };
    }

    // Only null-out columns that actually exist on this deployment.
    const presentLegacy: string[] = [];
    for (const col of LEGACY_COLUMNS) {
        if (await columnExists(exec, EVENT_OBJECT, col)) presentLegacy.push(col);
    }

    let migrated = 0;
    try {
        const rows = await selectLegacyRows(exec);
        if (rows.length === 0) return { status: 'already_done', migrated: 0 };

        for (const row of rows) {
            const id = String(row.id);
            const recipientId = row.recipient_id != null ? String(row.recipient_id) : null;
            if (!recipientId) continue; // defensive — guarded by the SELECT filter
            const orgId = row.organization_id != null ? String(row.organization_id) : null;
            const createdAt = row.created_at != null ? canonicalTimestampText(row.created_at) : now();
            const title = row.title != null ? String(row.title) : (row.type != null ? String(row.type) : 'Notification');
            const isRead = row.is_read === true || row.is_read === 1 || row.is_read === '1';
            // One topic for both the inbox row and the rewritten event, so the
            // materialization and its L2 event never disagree (empty/null legacy
            // `type` → 'legacy').
            const eventTopic = row.type != null && String(row.type).length > 0 ? String(row.type) : 'legacy';

            // L5 in-app materialization.
            await data.insert(INBOX_OBJECT, {
                user_id: recipientId,
                notification_id: id,
                topic: eventTopic,
                title,
                body_md: row.body ?? null,
                severity: 'info',
                action_url: row.url ?? null,
                organization_id: orgId,
                created_at: createdAt,
            });

            // L5 receipt (read-state spine).
            await data.insert(RECEIPT_OBJECT, {
                notification_id: id,
                delivery_id: null,
                user_id: recipientId,
                channel: 'inbox',
                state: isRead ? 'read' : 'delivered',
                at: isRead && row.read_at != null ? canonicalTimestampText(row.read_at) : createdAt,
                organization_id: orgId,
                created_at: createdAt,
            });

            // Rewrite the row itself to the L2 event shape (engine handles JSON).
            await data.update(
                EVENT_OBJECT,
                {
                    id,
                    topic: eventTopic,
                    severity: 'info',
                    payload: {
                        title: row.title ?? null,
                        body: row.body ?? null,
                        url: row.url ?? null,
                        actorName: row.actor_name ?? null,
                    },
                },
                { where: { id } },
            );

            // Clear the legacy inbox columns so the row no longer matches the
            // migration filter (idempotency) and carries no stale recipient.
            if (presentLegacy.length > 0) {
                const setClause = presentLegacy.map((c) => `"${c}" = NULL`).join(', ');
                await exec(`UPDATE "${EVENT_OBJECT}" SET ${setClause} WHERE id = ?`, [id]);
            }

            migrated += 1;
        }

        return { status: 'migrated', migrated };
    } catch (err: any) {
        return { status: 'error', migrated, error: err?.message ?? String(err) };
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * The canonical text spelling of a timestamp read back out of the legacy table.
 *
 * `selectLegacyRows` reads through `driver.raw`/`execute`, which hands the
 * dialect client's own materialisation straight back — that door does not run
 * `formatOutput`, so none of its repairs apply here on any dialect:
 *
 *  - `created_at` is a BUILTIN audit column, so it is never in `datetimeFields`
 *    and no declared-field coercion reaches it; `formatOutput` repairs it only
 *    inside its `if (this.isSqlite)` arm (`repairNaiveUtcAuditTimestamp` over
 *    `AUDIT_TIMESTAMP_COLUMNS`).
 *  - `read_at` is a LEGACY column ADR-0030 removed from the object, so it is
 *    not declared either — it can never enter `datetimeFields`, and it is not
 *    an audit column, so no arm of `formatOutput` could reach it even at the
 *    record read door.
 *
 * On SQLite both arrive as canonical ISO text and `String()` is the identity —
 * which is why every test in this directory stayed green. On Postgres and
 * MySQL an instant column materialises as a JS `Date`
 * (`withPostgresCalendarDayAsText` leaves the instant types alone deliberately;
 * pinned in `sql-driver-13567-audit-stamp-materialisation.test.ts`), and
 * `String(date)` spells
 *
 *   Sun Aug 30 2026 18:19:25 GMT+0800 (China Standard Time)
 *
 * — whole seconds in the MIGRATING HOST's zone, with the milliseconds gone.
 * This migration is one-way and this value is WRITTEN, so that spelling is what
 * the platform would carry afterwards: either accepted and stored skewed and
 * de-precisioned, or rejected outright, since the trailing zone name is in no
 * dialect's timestamp grammar (#13998).
 *
 * Canonicalising HERE, at the consumer that writes, is deliberate and is the
 * only shape that could also repair an already-migrated deployment (#13973
 * option A). It is not a tolerant alias: `Date` and ISO text are two
 * materialisations of ONE instant, not two spellings of a key. Matches the
 * repo's existing correct form at `metadata-protocol/src/protocol.ts` (the
 * `occurred_at` read in `readMetadataAuditEvents`); anything that is neither a
 * string nor a `Date` keeps its previous `String()` rendering unchanged rather
 * than having a unit guessed for it on a one-way write path.
 */
function canonicalTimestampText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    return String(value);
}

async function selectLegacyRows(exec: DriverExec): Promise<any[]> {
    const result: any[] = await exec(
        `SELECT id, recipient_id, type, title, body, url, actor_name, is_read, read_at, created_at, organization_id ` +
            `FROM "${EVENT_OBJECT}" WHERE recipient_id IS NOT NULL`,
    );
    // knex wraps some results as `[rows]`; normalize both shapes.
    if (Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) {
        return result[0];
    }
    return Array.isArray(result) ? result : [];
}

async function columnExists(exec: DriverExec, table: string, column: string): Promise<boolean> {
    // SQLite path: PRAGMA table_info. On Postgres/others this raises a syntax
    // error — swallow it *locally* and fall through to information_schema (the
    // outer-catch version of this would never reach the fallback, making the
    // migration silently no-op on every non-SQLite DB).
    try {
        const rows: any = await exec(`PRAGMA table_info("${table}")`);
        const list: any[] = Array.isArray(rows)
            ? (Array.isArray(rows[0]) ? rows[0] : rows)
            : [];
        if (list.length > 0 && list.some((r: any) => r?.name != null)) {
            return list.some((r: any) => r?.name === column);
        }
    } catch {
        /* not SQLite — fall through to information_schema */
    }
    // Postgres / others.
    try {
        const result: any = await exec(
            `SELECT column_name FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
            [table, column],
        );
        const list: any[] = Array.isArray(result)
            ? (Array.isArray(result[0]) ? result[0] : result)
            : [];
        return list.length > 0;
    } catch {
        return false;
    }
}
