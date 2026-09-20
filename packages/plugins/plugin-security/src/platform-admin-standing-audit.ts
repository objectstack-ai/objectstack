// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18412] `platform_admin_standing_change` — the durable record of WHO held
 * platform-administrator standing on this deployment, and from when.
 *
 * ## What this exists for
 *
 * Platform-admin standing moved from a STORED GRANT ROW to CONFIG-DERIVED,
 * request-time resolution (#11663 re-anchor, ADR-0131). The migration is right
 * and it silently dropped a property the row had: the row carried its own
 * history — who held standing, since when, and what a revocation looked like.
 * Config carries none of that. After the migration, 「three months ago this
 * account performed an admin action; what made them an administrator at that
 * moment?」 is answerable only from the deployment's environment-variable
 * history, which the product does not keep and an auditor cannot read.
 *
 * `sys_audit_log` already records the ACTIONS. What had no writer is the BASIS
 * of the authority behind them. This module is that writer's row shape.
 *
 * ## One entry per CHANGE of standing, plus the first-boot baseline
 *
 * The boot already computes the answer — `resolvePlatformAdminStanding` builds
 * the per-entry summary and the walled bootstrap logs it at `info`. A row per
 * boot would be noise on a frequently restarted rig, so the boot compares the
 * resolved standing against the last snapshot ALREADY on the ledger and writes
 * only when the two differ. The first boot after this lands finds no prior row
 * and writes the baseline once, which is what makes every later row a readable
 * DELTA rather than an isolated assertion.
 *
 * The comparison is over the serialized snapshot rather than over a hand-picked
 * subset of fields: a change in the declared spelling, in whether the account
 * exists, in whether it is verified, or in WHICH account holds standing is a
 * change of standing, and the snapshot is the only place all four are stated
 * together.
 *
 * ## ⛔ Why this module is PURE, and the engine calls are not in it
 *
 * Every function here takes data and returns data. The ledger read and the
 * ledger insert stay in `bootstrap-platform-admin.ts`, on that file's existing
 * `tryFind` / `tryInsert` doors, for two reasons that are not style:
 *
 *  - that file already states the ordering discipline a `limit`-ed read needs
 *    (an unordered read with a cap returns whichever rows the driver produced
 *    first, not the first N), and a second read door here would be a second
 *    copy of that lesson;
 *  - the row shape is the contract this card makes true, so it is built in one
 *    place a test can call directly, instead of being assembled inside the boot
 *    where a pin would have to reconstruct it by hand.
 */

import type { PlatformAdminStandingEntry } from './platform-admin-service.js';

/**
 * The `sys_audit_log.action` value this record carries.
 *
 * ⛔ Spelled `snake_case` and dotless, matching Prime Directive #3 (machine
 * names) and every incumbent value on the enum (`config_change`, `import`) —
 * the ruling's illustrative `platform_admin_standing.changed` carried a dot and
 * was written 「e.g.」.
 *
 * Named here rather than inline at the insert, for the reason `READ_AUDIT_ACTION`
 * states in `plugin-audit/src/read-audit.ts`: every `sys_audit_log` field is
 * `readonly: true` and `validateRecord` skips readonly fields, so the `action`
 * enum validates NOTHING in either direction. A misspelled action is accepted
 * silently and no test watching for a throw can see it; a closed literal is the
 * only structural protection available.
 *
 * ⚠️ The enum member itself lives in `@objectstack/plugin-audit`
 * (`objects/sys-audit-log.object.ts`), which this package does NOT depend on —
 * `plugin-audit` is OPTIONAL and neither package depends on the other. The two
 * spellings are tied together by that package's
 * `sys-audit-log-retired-actions.test.ts`, whose `ACTIONS_WITH_WRITERS`
 * inventory names THIS file as the writer and fails if the enum and the
 * inventory disagree. This is the same two-package shape `config_change`
 * already has (`service-settings/src/config-change-audit.ts`).
 */
export const PLATFORM_ADMIN_STANDING_ACTION = 'platform_admin_standing_change';

/**
 * The object this record is ABOUT.
 *
 * Standing is held by `sys_user` rows — a declared address confers it only once
 * an account exists AND verifies — so `sys_user` is the object an auditor
 * filters on. `record_id` is null: the row is RUN-LEVEL, covering every declared
 * entry at once, the same shape `plugin-auth`'s `import` row and
 * `service-settings`' `config_change` row already use.
 */
export const PLATFORM_ADMIN_STANDING_OBJECT_NAME = 'sys_user';

/** The platform audit ledger this record lands on. */
export const PLATFORM_ADMIN_STANDING_LEDGER = 'sys_audit_log';

/** One entry of a recorded snapshot — the serialized form of one declared address. */
export interface PlatformAdminStandingSnapshotEntry {
  email: string;
  declaredSpelling: string;
  registered: boolean;
  verified: boolean;
  /** The account that holds standing, or `null` when none does. */
  userId: string | null;
}

/**
 * Project the resolved standing onto the shape that is STORED.
 *
 * Key order is fixed and `userId` is normalized to an explicit `null` rather
 * than left absent: the change detector compares serialized snapshots, so a
 * present-vs-absent key would read as a change of standing when nothing about
 * standing moved. Declaration order is preserved — it is the operator's own
 * order and it is what the log line already shows.
 */
export function platformAdminStandingSnapshot(
  standing: readonly PlatformAdminStandingEntry[],
): PlatformAdminStandingSnapshotEntry[] {
  return standing.map((s) => ({
    email: s.email,
    declaredSpelling: s.declaredSpelling,
    registered: s.registered,
    verified: s.verified,
    userId: s.userId ?? null,
  }));
}

/** Serialize a snapshot for storage and for comparison. One spelling for both. */
export function serializePlatformAdminStandingSnapshot(
  snapshot: readonly PlatformAdminStandingSnapshotEntry[],
): string {
  try {
    return JSON.stringify(snapshot);
  } catch {
    return String(snapshot);
  }
}

/**
 * Did standing CHANGE against the last recorded snapshot?
 *
 * `previousSerialized` is the `new_value` of the most recent row already on the
 * ledger, or `null` when there is none — the first-boot baseline case, which
 * always writes.
 *
 * ⛔ Compared as the stored STRING, not by re-parsing: what the next boot must
 * agree with is the bytes a previous boot wrote. Re-parsing would let a change
 * in how this module serializes read as a change in who administers the
 * deployment, which is the one direction this record must not be wrong in.
 */
export function platformAdminStandingChanged(
  previousSerialized: string | null,
  nextSerialized: string,
): boolean {
  return previousSerialized !== nextSerialized;
}

/** Inputs the row builder cannot derive on its own. */
export interface PlatformAdminStandingRowInput {
  /** The standing just resolved at boot. */
  snapshot: readonly PlatformAdminStandingSnapshotEntry[];
  /** The last recorded snapshot's stored string, or `null` on the baseline row. */
  previousSerialized: string | null;
  /** Does the registered `sys_audit_log` schema declare `organization_id`? */
  declaresOrganizationId: boolean;
  /** Does it declare `actor`? */
  declaresActor: boolean;
}

/**
 * Build the `sys_audit_log` row for one change of platform-admin standing.
 *
 * Exported rather than assembled inside the boot so a pin tests the WRITER's
 * row instead of a hand-written copy of it — the same reason
 * `buildConfigChangeAuditSink` is exported from `service-settings`.
 */
export function buildPlatformAdminStandingRow(
  input: PlatformAdminStandingRowInput,
): Record<string, unknown> {
  const serialized = serializePlatformAdminStandingSnapshot(input.snapshot);
  const baseline = input.previousSerialized === null;
  const holders = input.snapshot.filter((e) => e.userId !== null).length;

  const row: Record<string, unknown> = {
    action: PLATFORM_ADMIN_STANDING_ACTION,
    // ⛔ Both null, and neither is a placeholder. This row is written by the
    // BOOT, before any request exists: no `sys_user` performed it and no
    // service principal did either. `actor` is two-valued under ADR-0118 D1/D5
    // — a `sys_user` id, or null for the system — so null IS the system here.
    user_id: null,
    object_name: PLATFORM_ADMIN_STANDING_OBJECT_NAME,
    // Run-level: the row covers every declared entry at once. See
    // `PLATFORM_ADMIN_STANDING_OBJECT_NAME`.
    record_id: null,
    // The DELTA, stated as both sides. `old_value` is null on the baseline row
    // and only there, so 「is this the first record on this deployment?」 is
    // answerable from the row itself rather than from a scan of the ledger.
    old_value: input.previousSerialized,
    new_value: serialized,
    // ⛔ NULL, deliberately — see the block on `organization_id` below. This is
    // the schema-declared "tenant context" lookup and this fact has no tenant.
    tenant_id: null,
    metadata: serializePlatformAdminStandingMetadata({
      event: baseline
        ? 'platform_admin_standing.baseline'
        : 'platform_admin_standing.changed',
      declared: input.snapshot.length,
      holders,
    }),
  };

  // ⭐ THE DECLARED EXCEPTION — ⛔ do not "repair" this to a non-NULL value.
  //
  // This row carries `organization_id: null`, and that is the RULED shape, not
  // an oversight and not a gap waiting for an owner.
  //
  // ADR-0131 §1.5 「The rejected middle: a platform organization」 considered
  // inventing an organization to own deployment-level rows and rejected it in
  // its own words: 「it is the natural repair and the wrong one … exists only to
  // give NULL a new name」. There is no platform organization on this tree, by
  // that decision. Stamping some tenant's id instead would be a lie — this is a
  // fact about the whole deployment, filed behind one tenant's wall — and one
  // row per organization is the fan-out §1.5 names as wrong. The first-boot
  // BASELINE settles it structurally: it is written before any `sys_organization`
  // row exists, so at that instant there is no id in the world to stamp.
  //
  // The maintainer ruled this directly (#18412, director batch #153 item 2,
  // 「其他同意」 2026-09-18): the earlier clause requiring a non-NULL
  // organization was WITHDRAWN as an error, and this entry 「follows the tree's
  // existing deployment-level writing (`organization` NULL), exactly as the four
  // writers above do」 — `plugin-audit`'s `audit-writers.ts` and `read-audit.ts`,
  // its `auth-event-audit.ts`, and `service-settings`' `config-change-audit.ts`,
  // every one of which stamps `tenantId ?? null`. ADR-0131 D7 will later drop
  // this column from `sys_audit_log` outright; NULL is how that shape is
  // expressed until it does.
  //
  // Conditionally stamped for the same mechanical reason every other writer
  // states: the SchemaRegistry injects `organization_id` only where the object
  // and the posture admit it, and stamping a column the table lacks makes the
  // INSERT fail outright.
  if (input.declaresOrganizationId) row.organization_id = null;
  if (input.declaresActor) row.actor = null;

  return row;
}

/** `metadata` is a stored string on this object — one serializer, guarded. */
function serializePlatformAdminStandingMetadata(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Read the stored snapshot off a ledger row, or `null` when there is none.
 *
 * Tolerates a row whose `new_value` is absent or not a string — a ledger row is
 * stored data and this code must not throw on a shape it did not write. A row
 * that cannot be read answers `null`, which means the next boot writes a
 * BASELINE rather than skipping: a missing comparison must not silence the
 * record.
 */
export function readRecordedStandingSnapshot(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const value = (row as { new_value?: unknown }).new_value;
  return typeof value === 'string' ? value : null;
}
