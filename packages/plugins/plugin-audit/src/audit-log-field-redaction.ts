// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21155] sys_audit_log FIELD redaction: the compliance ledger serves a parent
 * record's field value only to a reader the security service answers may be
 * served that field unmasked.
 *
 * ## The defect this closes
 *
 * The CRUD mirror (`audit-writers.ts`) writes one ledger row per record write,
 * ONCE, as the system. Two of its columns are JSON snapshots of the parent
 * record (`object_name`):
 *
 *  - `create` — `new_value`: the record as created;
 *  - `update` — `old_value` / `new_value`: each changed field, both sides;
 *  - `delete` — `old_value`: the record as deleted.
 *
 * Every door onto the ledger reads it through the engine — the Setup "Audit
 * Logs" object view, the console's audit-log browser and a record page's
 * history tab all list `sys_audit_log` through the generic data API — under the
 * LEDGER's own object grant and tenant wall. A reader whose sets grant the
 * ledger read was therefore served every snapshot key, including a parent field
 * the data plane serves the same reader masked, gated off by
 * `requiredPermissions`, or not at all because a set it holds withholds it.
 *
 * ## The rule, and why at READ time
 *
 * Ledger readers are not field-unrestricted by default: a snapshot takes the
 * same read-time narrowing the activity stream's recorded change takes
 * (`activity-field-redaction.ts`), through the security service's own field
 * answer. An auditor who must see every field is granted that through a set
 * that unmasks those fields; the ledger is not exempted.
 *
 * Read time, not write time, for the activity stream's reasons: the writer
 * cannot know the reader, and a permission set that withholds a field is
 * runtime state, so the row at rest stays the complete record of what changed.
 * The fields a reader is served unmasked are NOT derived here — they are
 * `resolveServedFields`, shared with the activity redaction in
 * `served-fields.ts`. ⛔ No second derivation of masking lives in this package.
 *
 * ## What is redacted, and how
 *
 *  - Only a row of a RECORD-WRITE action ({@link LEDGER_RECORD_WRITE_ACTIONS},
 *    the vocabulary the mirror's `actionFor` returns) carries a parent's field
 *    map in its snapshots. Each snapshot key the reader is not served is
 *    DROPPED, key by key — the approval snapshot's shape. Dropped, not masked:
 *    the contract publishes WHICH fields are masked, not the masked value.
 *  - A record-write row's snapshot that is not a JSON object cannot be judged
 *    key by key, so it is dropped whole (fail closed).
 *  - A row of any other action is served as written. Measured per writer on
 *    the tree this landed on: `read`, `login`, `logout` and `import` rows
 *    write no snapshot; a `config_change` row's snapshot is a DIGEST of the
 *    setting, never its value (`service-settings`' `config-change-audit.ts`);
 *    a `platform_admin_standing_change` row's is the deployment's
 *    administrator roster (`plugin-security`). None is a parent record's field
 *    map, and narrowing them by a parent's field set would only delete their
 *    own vocabulary.
 *  - `metadata` is not narrowed: the mirror records only the delegated-write
 *    attribution there.
 *
 * ## Fail closed
 *
 * An unexpected failure strips both snapshot columns from every row of the
 * read rather than serving them unredacted. A row that names no parent object,
 * or whose action cannot be read, has nothing to judge its snapshots by and
 * loses them. The security service's own "no answer" (no service wired, or an
 * unresolvable read projection — an object no longer registered) passes rows
 * through, exactly as the activity stream, the approval snapshot and the data
 * plane itself do; a reader the service cannot answer MASKING for is served no
 * field (`resolveServedFields` in `served-fields.ts`).
 *
 * System-context reads (the platform-admin standing boot reading its last
 * roster) and context-less programmatic calls are not redacted, as for the
 * activity stream.
 *
 * Out of this seam: `count` serves no value; a filter, group or aggregate over
 * the stored snapshot text answers at rest, before any read-time redaction —
 * the activity stream's open predicate question, not this one's.
 */

import {
  dropUnservedKeys,
  ensureJudgedColumnsProjected,
  isRecord,
  servedFieldsPerRead,
  type FieldRedactionLogger,
  type FieldVisibilitySource,
} from './served-fields.js';
import type { ActivityMiddlewareEngine } from './activity-read-visibility.js';

const LEDGER_OBJECT = 'sys_audit_log';
const SEAM = 'audit log field redaction';

/**
 * The ledger actions whose rows the CRUD mirror writes: a record write, whose
 * snapshots are the parent record's field map. `audit-writers.ts`' `actionFor`
 * is typed by this list, so the mirror cannot emit a record-write action this
 * seam does not judge.
 */
export const LEDGER_RECORD_WRITE_ACTIONS = ['create', 'update', 'delete'] as const;
export type LedgerRecordWriteAction = (typeof LEDGER_RECORD_WRITE_ACTIONS)[number];

/** The ledger's snapshot columns. */
const SNAPSHOT_COLUMNS = ['old_value', 'new_value'] as const;

/** What a snapshot is judged by: its parent object, and its row's action. */
const JUDGED_BY = ['object_name', 'action'] as const;

/** Object machine-name shape (`ObjectSchema.name` in packages/spec). */
const OBJECT_NAME_RE = /^[a-z_][a-z0-9_]*$/;

const RECORD_WRITE = new Set<string>(LEDGER_RECORD_WRITE_ACTIONS);

/** Drop both snapshot columns — the fail-closed answer for one row. */
function stripSnapshots(row: Record<string, unknown>): void {
  for (const col of SNAPSHOT_COLUMNS) delete row[col];
}

/**
 * Redact the snapshot columns of the ledger rows one read is about to hand
 * back, as `context`. Mutates the rows in place (they are the read's own
 * result objects). Exported for direct testing.
 */
export async function redactAuditLogRows(
  rows: unknown,
  security: FieldVisibilitySource | undefined,
  context: unknown,
  logger?: FieldRedactionLogger,
): Promise<void> {
  const list = (Array.isArray(rows) ? rows : rows ? [rows] : []) as unknown[];
  if (list.length === 0) return;
  const servedFor = servedFieldsPerRead(security, context, logger, SEAM);

  for (const item of list) {
    if (!isRecord(item)) continue;
    const row = item;
    if (!SNAPSHOT_COLUMNS.some((col) => row[col] !== undefined && row[col] !== null)) continue;

    const action = row.action;
    if (typeof action !== 'string') {
      stripSnapshots(row);
      continue;
    }
    if (!RECORD_WRITE.has(action)) continue;

    const object = row.object_name;
    if (typeof object !== 'string' || !OBJECT_NAME_RE.test(object)) {
      stripSnapshots(row);
      continue;
    }
    const answer = await servedFor(object);
    if (answer === undefined) continue;
    const served = new Set(answer.map(String));

    for (const col of SNAPSHOT_COLUMNS) {
      const raw = row[col];
      if (raw === undefined || raw === null) continue;
      let snapshot: unknown;
      try {
        snapshot = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        snapshot = undefined;
      }
      if (!isRecord(snapshot)) {
        delete row[col];
        continue;
      }
      // Untouched bytes for a reader served every key.
      if (dropUnservedKeys(snapshot, served)) row[col] = JSON.stringify(snapshot);
    }
  }
}

/**
 * Install the `sys_audit_log` field-redaction middleware. `getSecurity` is
 * resolved on every read: the security plugin may register after this one.
 * Inert on an engine without the middleware seam; `AuditPlugin` says so.
 */
export function installAuditLogFieldRedaction(
  engine: ActivityMiddlewareEngine,
  getSecurity: () => FieldVisibilitySource | undefined,
  logger: FieldRedactionLogger,
): void {
  if (typeof engine.registerMiddleware !== 'function') return;
  engine.registerMiddleware(
    async (ctx, next) => {
      if ((ctx.operation !== 'find' && ctx.operation !== 'findOne') || !ctx.context || ctx.context.isSystem) {
        return next();
      }
      const added = ensureJudgedColumnsProjected(ctx.ast, SNAPSHOT_COLUMNS, JUDGED_BY);
      await next();
      const list = (Array.isArray(ctx.result) ? ctx.result : ctx.result ? [ctx.result] : []) as unknown[];
      try {
        await redactAuditLogRows(list, getSecurity(), ctx.context, logger);
      } catch (err) {
        // A redaction failure must never fall open into a leak.
        logger.warn(
          `[audit] ${SEAM} failed — serving the rows without their before/after snapshots ` +
            `(${(err as Error)?.message ?? err})`,
        );
        for (const row of list) if (isRecord(row)) stripSnapshots(row);
      }
      if (added.length) for (const row of list) if (isRecord(row)) for (const col of added) delete row[col];
    },
    { object: LEDGER_OBJECT },
  );
}
