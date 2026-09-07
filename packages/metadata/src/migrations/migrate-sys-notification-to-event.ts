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
 *
 * A completed run also records itself in the `sys_migration` deployment ledger
 * under `NOTIFICATION_EVENT_MIGRATION_ID`, per the ruled claim matrix carried
 * on that constant (#16100) — see "The run receipt" below. That row is a
 * RECEIPT an operator reads, never a gate.
 */

import type { IDataDriver, IDataEngine } from '@objectstack/spec/contracts';
import {
    DATA_MIGRATION_FLAG_OBJECT,
    NOTIFICATION_EVENT_MIGRATION_ID,
} from '@objectstack/spec/system';

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

/**
 * What one run recorded in the `sys_migration` deployment ledger (#16100).
 *
 * This directory reports to its CALLER and to nobody else — no module under
 * `packages/metadata/src/migrations` takes a logger — so the ledger claim's
 * own fate is reported the same way the migration's is. That is also the third
 * legal answer to AGENTS.md's degradation rule: a failure handed to the caller
 * does not "look normal from the outside", because the caller was told.
 *
 *  - `inserted` / `updated` — the claim landed, as a new row or over the row
 *    that was already there.
 *  - `not-claimed` — nothing was owed. An `error` run writes no ledger claim
 *    at all (the ruled matrix), so this is the correct, complete outcome for
 *    it and never a failure.
 *  - `no-ledger` — a claim was owed and there is nowhere to put it: the host
 *    is not an engine that carries the ledger, or `sys_migration` is not
 *    registered on this kernel. `reason` says which.
 *  - `failed` — a claim was owed, the write was attempted, and it threw. The
 *    data migration itself still did what `status` says it did; what is
 *    missing is the durable record that it ran. `reason` carries the error.
 */
export interface SysNotificationMigrationReceipt {
    outcome: 'inserted' | 'updated' | 'not-claimed' | 'no-ledger' | 'failed';
    /** Why no claim landed — present on `no-ledger` and `failed` only. */
    reason?: string;
}

export interface SysNotificationMigrationResult {
    status: 'migrated' | 'already_done' | 'not_applicable' | 'error';
    /** Number of legacy rows split into inbox + receipt + event. */
    migrated: number;
    error?: string;
    /**
     * What this run claimed in the `sys_migration` ledger under
     * {@link NOTIFICATION_EVENT_MIGRATION_ID}. Always present: writing the
     * receipt is part of what a run DOES, and a caller that cannot tell "the
     * claim landed" from "the claim was never attempted" is the unanswerable
     * state the ledger row exists to remove.
     */
    receipt: SysNotificationMigrationReceipt;
}

export interface SysNotificationMigrationOptions {
    driver: IDataDriver;
    data: IDataEngine;
    /** Defaults to `() => new Date().toISOString()`. */
    now?(): string;
}

/** What the migration itself decided, before the ledger claim is written. */
type MigrationOutcome = Omit<SysNotificationMigrationResult, 'receipt'>;

export async function migrateSysNotificationToEvent(
    opts: SysNotificationMigrationOptions,
): Promise<SysNotificationMigrationResult> {
    const now = opts.now ?? (() => new Date().toISOString());
    const outcome = await runNotificationEventMigration(opts, now);
    // ONE exit, so the ruled matrix is applied to the outcome exactly once and
    // a `return` added inside the runner tomorrow cannot bypass it. `now()` is
    // read again HERE on purpose: the claim's stamp is when the run FINISHED,
    // not when it started, and a caller injecting `now` can pin both.
    const receipt = await recordNotificationEventReceipt(opts.data, outcome.status, now());
    return { ...outcome, receipt };
}

async function runNotificationEventMigration(
    opts: SysNotificationMigrationOptions,
    now: () => string,
): Promise<MigrationOutcome> {
    const { data } = opts;

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
// The run receipt (#16100) — the ruled ledger-claim matrix
// ---------------------------------------------------------------------------
//
// What a run of this migration may claim under `NOTIFICATION_EVENT_MIGRATION_ID`
// is RULED (maintainer 「同意」 to decision batch #47 item 5), and the ruling is
// carried in that constant's own docblock in `@objectstack/spec/system`. This
// file is the runtime half: the runner receives the data engine and is the only
// place that knows the four-valued outcome, so it is the only place the claim
// can be written from.
//
// ⛔ RECEIPT, NOT GATE. Nothing reads a row under this id as a precondition and
// nothing may — a gate would need the self-check this migration does not have.
// The row is what an operator reads, in the shape `sys-migration.object.ts`
// already documents for the #8686 seed-tenancy repair (`verified_at: null`,
// `blocking: 0` by construction), which is exactly the shape
// `isDataMigrationFlagVerified` answers `false` to.

/** The row-effect one outcome is entitled to. */
interface LedgerClaim {
    /** Write a claim for this outcome at all? */
    readonly claims: boolean;
    /** Stamp `applied_at` with this run's timestamp? */
    readonly appliesBackfill: boolean;
}

/**
 * The ruled matrix, TOTAL over the result union rather than derived from it.
 *
 * A mapped type keyed by `status` is the point: a fifth outcome added to
 * {@link SysNotificationMigrationResult} makes this object literal a COMPILE
 * ERROR instead of silently inheriting whichever arm a ternary happened to
 * fall into. The ledger claim of a new outcome has to be decided, not
 * inherited.
 *
 * `verified_at` is absent from this table on purpose: it is not a per-outcome
 * decision, it is a column this migration NEVER writes in any direction. See
 * {@link buildNotificationEventClaim}.
 */
const LEDGER_CLAIM: {
    readonly [S in SysNotificationMigrationResult['status']]: LedgerClaim;
} = {
    migrated: { claims: true, appliesBackfill: true },
    already_done: { claims: true, appliesBackfill: false },
    not_applicable: { claims: true, appliesBackfill: false },
    // An `error` run writes NO ledger claim at all — it does not know what it
    // did, so it may not say.
    error: { claims: false, appliesBackfill: false },
};

/**
 * The engine surface the receipt needs, duck-typed.
 *
 * `IDataEngine` declares `find`/`insert`/`update` but NOT `getObject`, and
 * "is the ledger registered on this kernel?" cannot be asked without it — the
 * same question, asked the same way, as `readDataMigrationFlag`
 * (`@objectstack/platform-objects`) and `resolveSeedTenancyLedger`
 * (`@objectstack/metadata-protocol`). Probing rather than requiring keeps a
 * remote or virtual engine that carries no object registry from being refused
 * the migration itself over bookkeeping.
 */
interface MigrationLedger {
    getObject(name: string): unknown;
    find(object: string, query: Record<string, unknown>, options?: Record<string, unknown>): Promise<any[]>;
    insert(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
    update(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

const LEDGER_METHODS = ['getObject', 'find', 'insert', 'update'] as const;

/** The ledger seam on this engine, or `undefined` where the host is not one. */
function resolveMigrationLedger(data: IDataEngine): MigrationLedger | undefined {
    const candidate = data as unknown as Record<string, unknown>;
    for (const method of LEDGER_METHODS) {
        if (typeof candidate[method] !== 'function') return undefined;
    }
    return candidate as unknown as MigrationLedger;
}

/**
 * The columns one outcome's claim writes, split by whether a row is already
 * there — pure, so the matrix is testable without an engine.
 *
 * The split is the whole reading, and it is what the fresh-store case needs:
 *
 *  - **`verified_at` is never written in either direction.** On an INSERT the
 *    claim spells `null` — the documented receipt shape, and the absence of a
 *    certificate rather than a claim about one. On an UPDATE the key is
 *    OMITTED, so a value that is already there survives untouched. That is not
 *    a nicety: this id is in `CREATION_ATTESTED_MIGRATION_IDS`, so a store
 *    created after the cut-over already carries a row whose `verified_at` was
 *    set by `attestFreshDatastore` at BIRTH, for a fact this run neither
 *    earned nor disproved. Sending `verified_at` at all would either forge
 *    that certificate or revoke it.
 *  - **`applied_at` follows the same rule for the same reason.** It is
 *    stamped only on `migrated`; on the other two outcomes the key is omitted
 *    from an UPDATE, so an EARLIER `migrated` run's stamp — a true fact about
 *    this deployment — is preserved rather than cleared by a later
 *    `already_done`. On an INSERT there is no earlier run, so it spells
 *    `null`.
 *  - **`blocking: 0` always.** Blocking means "the gate must stay closed" and
 *    nothing gates on this id; nothing here counts discrepancies either.
 *  - **`details`** carries `{ outcome }` verbatim, JSON-encoded, which is what
 *    the column holds for every other writer.
 *  - **`advisory`, `deviation_observed_at`, `deviation_detail`** are not
 *    written. Nothing here produces an advisory finding, and the deviation
 *    columns belong to ADR-0104's escape-hatch protocol, which this migration
 *    does not participate in. Writing a column no path here ever produces is
 *    the declared-≠-enforced shape.
 */
function buildNotificationEventClaim(
    status: SysNotificationMigrationResult['status'],
    now: string,
    exists: boolean,
): Record<string, unknown> {
    const claim = LEDGER_CLAIM[status];
    const row: Record<string, unknown> = {
        id: NOTIFICATION_EVENT_MIGRATION_ID,
        last_run_at: now,
        blocking: 0,
        details: JSON.stringify({ outcome: status }),
        updated_at: now,
    };
    if (claim.appliesBackfill) row.applied_at = now;
    if (!exists) {
        // A brand-new row: there is no prior value to preserve, so the two
        // columns this migration never claims are spelled as the absence they
        // are, and the row gets its creation stamp.
        row.applied_at = claim.appliesBackfill ? now : null;
        row.verified_at = null;
        row.created_at = now;
    }
    return row;
}

/**
 * Record this run under `NOTIFICATION_EVENT_MIGRATION_ID`, and report what
 * became of the claim.
 *
 * ⛔ Never throws. The migration's own outcome is the answer this function's
 * caller asked for; a bookkeeping failure must not destroy it. The failure is
 * not swallowed either — it comes back as {@link SysNotificationMigrationReceipt},
 * which is the reporting channel every module in this directory already uses.
 */
async function recordNotificationEventReceipt(
    data: IDataEngine,
    status: SysNotificationMigrationResult['status'],
    now: string,
): Promise<SysNotificationMigrationReceipt> {
    if (!LEDGER_CLAIM[status].claims) return { outcome: 'not-claimed' };

    const ledger = resolveMigrationLedger(data);
    if (!ledger) {
        return {
            outcome: 'no-ledger',
            reason:
                `the \`data\` engine carries no object registry (${LEDGER_METHODS.join('/')}), so ` +
                `${DATA_MIGRATION_FLAG_OBJECT} cannot be reached from here`,
        };
    }

    try {
        if (!ledger.getObject(DATA_MIGRATION_FLAG_OBJECT)) {
            return {
                outcome: 'no-ledger',
                reason:
                    `${DATA_MIGRATION_FLAG_OBJECT} is not registered on this kernel — compose ` +
                    'PlatformObjectsPlugin, which carries the deployment ledger',
            };
        }
        const context = { isSystem: true };
        const rows = await ledger.find(
            DATA_MIGRATION_FLAG_OBJECT,
            { where: { id: NOTIFICATION_EVENT_MIGRATION_ID }, limit: 1 },
            { context },
        );
        const exists = rows?.[0]?.id === NOTIFICATION_EVENT_MIGRATION_ID;
        const row = buildNotificationEventClaim(status, now, exists);
        // One row per migration id — a re-run overwrites its own claim rather
        // than appending; `sys_migration_journal` is where per-RUN history lives.
        if (exists) {
            await ledger.update(DATA_MIGRATION_FLAG_OBJECT, row, { context });
            return { outcome: 'updated' };
        }
        await ledger.insert(DATA_MIGRATION_FLAG_OBJECT, row, { context });
        return { outcome: 'inserted' };
    } catch (err: any) {
        return { outcome: 'failed', reason: err?.message ?? String(err) };
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
