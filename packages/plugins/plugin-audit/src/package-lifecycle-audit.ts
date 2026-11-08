// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31186] The `package_uninstall` row in the compliance ledger: one durable
 * row per package uninstall, about the package itself.
 *
 * ## The gap this closes
 *
 * An uninstall left a ledger row for each metadata item it removed (the CRUD
 * mirror's `delete` rows, credited to the caller since #31023), and nothing
 * about the package. The package's own row lives in `sys_packages`, which
 * `@objectstack/service-package` deletes with raw SQL through
 * `engine.execute`: no hook fires on that path, so no writer ever saw it, with
 * or without an actor. An administrator asking "who uninstalled this app, and
 * when" had to infer it from a burst of item deletes, and a package that
 * shipped no stored metadata left no trace at all.
 *
 * ## Who calls it
 *
 * The uninstall verb, `ObjectStackProtocolImplementation#deletePackage` in
 * `@objectstack/metadata-protocol` — the one path every uninstall of a stored
 * package takes: the `DELETE /api/v1/packages/:id` door, the in-process
 * callers (the unmanaged-import rollback, the paired-customization install's
 * undo, a host's own tool calling the verb). It resolves this writer through
 * the `audit` service slot (beside `recordAuthEvent`) and hands over an EVENT,
 * never a row: the row shape is this package's, for the reason
 * `auth-event-audit.ts` gives ("a second package hand-assembling ledger rows
 * would be a second de-facto definition of that shape"). The verb calls it
 * once, after the package's stored row is gone; an uninstall the verb refused
 * writes nothing, because nothing was uninstalled.
 *
 * ## The row
 *
 *  - `action: 'package_uninstall'`;
 *  - `actor`: the principal the verb was called for (the door passes the
 *    request's authenticated user, ADR-0146 D1); `user_id`: the same value
 *    when it is a user id, never a `svc:` service principal, which no
 *    `sys_user` row carries (the ledger's `actor` field description);
 *  - no `object_name` / `record_id`: `sys_packages` is not an object, so the
 *    row is about no record, and the ledger's record read gate serves it
 *    under the ledger's own grant (`ledgerRowAboutNoRecordWhere`);
 *  - `tenant_id` NULL: an uninstall is environment-wide (ADR-0131 D6/D12), so
 *    the row is about no organization — a deployment-level row, served to the
 *    platform administrator alone (#26750, ruling A;
 *    `audit-log-read-visibility.ts`);
 *  - no `old_value` / `new_value`: an uninstall is not a field diff;
 *  - `metadata`: `package_id`, `version` (the installed version the verb
 *    found, or null), `environment_id` (the environment the verb's protocol
 *    is bound to, or null on a host bound to none), `keep_data` (whether the
 *    object tables were kept), `items_removed` / `items_failed` (the stored
 *    metadata items the verb removed and could not remove) and `outcome`
 *    (`complete`, or `partial` when an item stayed behind).
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import { isMissingTableError } from '@objectstack/types';
import {
  auditFailureCauseKey,
  auditFailureCauseSummary,
  createFieldPresenceProbe,
} from './audit-writers.js';
import type { AuthEventAuditLogger } from './auth-event-audit.js';

/** The `sys_audit_log.action` value this writer emits for an uninstall. */
export const PACKAGE_UNINSTALL_AUDIT_ACTION = 'package_uninstall' as const;

/**
 * [#30964, cloud#3624 ruling A「两边审计」] The `sys_audit_log.action` value
 * this writer emits for an UNMANAGED install: one row per copy the
 * environment attempted, whether it landed or not.
 *
 * ## Who calls it
 *
 * The install-local door's unmanaged branch (`installUnmanaged` in
 * `@objectstack/cloud-connection`), once per `importUnmanagedPackage` it ran:
 * the `POST /api/v1/marketplace/install-local` door, and the copy the
 * `POST /api/v1/cloud-connection/install` door hands it on a control plane's
 * unmanaged grant. Only the environment knows whether the copy succeeded, so
 * the control plane's own row (its decision) and this one (the result) are
 * the two halves of the ruling's "both sides audited".
 *
 * ## The row
 *
 *  - `action: 'package_unmanaged_import'`;
 *  - `actor` / `user_id` as for an uninstall: the installer the door admitted;
 *  - no `object_name` / `record_id` and `tenant_id` NULL: the copy is a new
 *    environment base (ADR-0131 D6), so the row is a deployment-level row, as
 *    `package_uninstall`'s is;
 *  - `metadata`: `package_id` and `version` (the source package and the
 *    version it was copied from), `environment_id` (null when the door knows
 *    none), `target_package_id` and `namespace` (the new base and its
 *    namespace; null when the copy failed before naming them),
 *    `source_namespace` (the namespace a rename came from, or null),
 *    `copied_count`, and `outcome` (`success` or `failure`); a failure adds
 *    the answer's `error_code` and HTTP `status`, never its message (a refusal
 *    message can quote package content).
 */
export const PACKAGE_UNMANAGED_IMPORT_AUDIT_ACTION = 'package_unmanaged_import' as const;

/**
 * Every package lifecycle action this writer records. Closed literal union, for
 * the reason `auth-event-audit.ts` gives: the ledger's `action` field is
 * `readonly`, so nothing validates a stored value.
 */
export type PackageLifecycleAuditAction =
  | typeof PACKAGE_UNINSTALL_AUDIT_ACTION
  | typeof PACKAGE_UNMANAGED_IMPORT_AUDIT_ACTION;

/** One package lifecycle event, in the vocabulary of what HAPPENED. The caller builds it; this writer turns it into a row. */
export type PackageLifecycleAuditEvent = PackageUninstallAuditEvent | PackageUnmanagedImportAuditEvent;

/**
 * [#30964] One unmanaged copy the environment attempted
 * ({@link PACKAGE_UNMANAGED_IMPORT_AUDIT_ACTION}).
 */
export interface PackageUnmanagedImportAuditEvent {
  action: typeof PACKAGE_UNMANAGED_IMPORT_AUDIT_ACTION;
  /** The source package's id (its manifest id). */
  packageId: string;
  /** The source version copied; absent when the door read none. */
  version?: string;
  /** The environment the copy ran in; absent when the door knows none. */
  environmentId?: string;
  /** The installer the door admitted: a user id, or a `svc:` principal. */
  actor?: string;
  /** The new base's id; absent when the copy failed before naming it. */
  targetPackageId?: string;
  /** The new base's namespace; absent when the copy failed before naming it. */
  namespace?: string;
  /** The namespace a rename came from (#30794); absent when the copy kept it. */
  sourceNamespace?: string;
  /** Items the copy wrote. */
  copiedCount?: number;
  /** Whether the copy landed. */
  outcome: 'success' | 'failure';
  /** A failed copy's machine code, as the door answered it. */
  errorCode?: string;
  /** A failed copy's HTTP status, as the door answered it. */
  status?: number;
}

/**
 * One package uninstall, in the vocabulary of what HAPPENED. The verb builds
 * it; this writer turns it into a row.
 */
export interface PackageUninstallAuditEvent {
  action: typeof PACKAGE_UNINSTALL_AUDIT_ACTION;
  /** The package's id (its manifest id). */
  packageId: string;
  /** The version the verb found installed; absent when it found none. */
  version?: string;
  /** The environment the verb's protocol is bound to; absent on a host bound to none. */
  environmentId?: string;
  /** The principal the verb was called for: a user id, or a `svc:` principal. */
  actor?: string;
  /** The caller asked to keep each object's physical table. */
  keepData?: boolean;
  /** Stored metadata items the verb removed. */
  itemsRemoved?: number;
  /** Stored metadata items the verb could not remove. */
  itemsFailed?: number;
}

/** What {@link createPackageLifecycleAuditWriter} adds to the `audit` slot. */
export interface PackageLifecycleAuditWriter {
  /**
   * Record one package lifecycle event in `sys_audit_log`. Never throws — an
   * audit write must never change the answer an uninstall or an install
   * gets — and reports a lost row loudly, once per cause.
   */
  recordPackageLifecycleEvent(event: PackageLifecycleAuditEvent): Promise<void>;
}

export interface PackageLifecycleAuditWriterOptions {
  /** Resolve the data engine at CALL time — see `AuthEventAuditSinkOptions.getEngine`. */
  getEngine(): IDataEngine | undefined;
  logger?: AuthEventAuditLogger;
}

/** The prefix the ledger's `actor` field names for a service principal. */
const SERVICE_PRINCIPAL_PREFIX = 'svc:';

/** JSON that cannot throw on a cyclic/odd value — same rule as the CRUD writer. */
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function nonEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
}

/**
 * The row for one event — exported so the shape is pinned without an engine.
 * `objectHasField` answers whether the deployed ledger has the
 * conditionally-present `actor` column (`createFieldPresenceProbe`).
 */
export function buildPackageLifecycleAuditRow(
  event: PackageLifecycleAuditEvent,
  objectHasField: (objectName: string, field: string) => boolean = () => true,
): Record<string, unknown> {
  const actor = nonEmpty(event.actor);
  const userId = actor && !actor.startsWith(SERVICE_PRINCIPAL_PREFIX) ? actor : undefined;
  if (event.action === PACKAGE_UNMANAGED_IMPORT_AUDIT_ACTION) {
    const failed = event.outcome !== 'success';
    const importMetadata: Record<string, unknown> = {
      package_id: event.packageId,
      version: nonEmpty(event.version) ?? null,
      environment_id: nonEmpty(event.environmentId) ?? null,
      target_package_id: nonEmpty(event.targetPackageId) ?? null,
      namespace: nonEmpty(event.namespace) ?? null,
      source_namespace: nonEmpty(event.sourceNamespace) ?? null,
      copied_count: count(event.copiedCount),
      outcome: failed ? 'failure' : 'success',
      ...(failed
        ? {
            error_code: nonEmpty(event.errorCode) ?? null,
            status: typeof event.status === 'number' && Number.isInteger(event.status) ? event.status : null,
          }
        : {}),
    };
    const importRow: Record<string, unknown> = {
      action: PACKAGE_UNMANAGED_IMPORT_AUDIT_ACTION,
      user_id: userId ?? null,
      // The copy is a new environment base, not a record.
      object_name: null,
      record_id: null,
      old_value: null,
      new_value: null,
      // [ADR-0131 D6] An environment base is environment-wide: a deployment-level row.
      tenant_id: null,
      metadata: safeStringify(importMetadata),
    };
    if (objectHasField('sys_audit_log', 'actor')) importRow.actor = actor ?? null;
    return importRow;
  }
  const itemsFailed = count(event.itemsFailed);
  const metadata: Record<string, unknown> = {
    package_id: event.packageId,
    version: nonEmpty(event.version) ?? null,
    environment_id: nonEmpty(event.environmentId) ?? null,
    keep_data: event.keepData === true,
    items_removed: count(event.itemsRemoved),
    items_failed: itemsFailed,
    outcome: itemsFailed > 0 ? 'partial' : 'complete',
  };
  const row: Record<string, unknown> = {
    action: PACKAGE_UNINSTALL_AUDIT_ACTION,
    user_id: userId ?? null,
    // `sys_packages` is not an object: the row is about no record.
    object_name: null,
    record_id: null,
    old_value: null,
    new_value: null,
    // [ADR-0131 D6/D7/D12] An uninstall is environment-wide, so the row is
    // about no organization: a deployment-level row.
    tenant_id: null,
    metadata: safeStringify(metadata),
  };
  if (objectHasField('sys_audit_log', 'actor')) {
    // ADR-0014 D2's principal label, two-valued as the CRUD mirror writes it.
    row.actor = actor ?? null;
  }
  return row;
}

/** Create the package lifecycle writer for the `audit` service slot. */
export function createPackageLifecycleAuditWriter(
  opts: PackageLifecycleAuditWriterOptions,
): PackageLifecycleAuditWriter {
  const { getEngine, logger } = opts;
  let probe: ((objectName: string, field: string) => boolean) | undefined;
  let probedEngine: IDataEngine | undefined;

  /**
   * Report a lost row — once per CAUSE (`auditFailureCauseKey`), the rule and
   * the reasons `auth-event-audit.ts` records for its own sink. A durability
   * degradation, so `error`, falling back to `warn`, never to silence.
   */
  const reportedCauses = new Set<string>();
  const reportWriteFailure = (event: PackageLifecycleAuditEvent, err: unknown): void => {
    const detail = String((err as any)?.message ?? err);
    try {
      const cause = auditFailureCauseKey('sys_audit_log', err);
      if (reportedCauses.has(cause)) {
        logger?.debug?.('Package lifecycle audit write failed (already reported)', {
          packageId: event.packageId,
          err: detail,
          cause,
        });
        return;
      }
      reportedCauses.add(cause);
      const message =
        `Package lifecycle audit write FAILED (${auditFailureCauseSummary(err, detail)}) — the compliance trail ` +
        `is now INCOMPLETE. The ${event.action} of '${event.packageId}' itself completed and was answered exactly ` +
        'as it would have been without the ledger, so nothing downstream looks broken; only the `sys_audit_log` ' +
        'row recording WHO did it to the package, and when, never landed, and nothing retries it. Every later ' +
        'package lifecycle event failing THIS WAY loses its row the same way (this CAUSE is reported ONCE — raise ' +
        'the log level to `debug` to see the rest; a DIFFERENT cause gets its own `error` line). ' +
        (isMissingTableError(err, 'sys_audit_log')
          ? 'Fix: confirm `sys_audit_log` is reachable from the connection this write ran on — its ADR-0057 ' +
            '§3.6 lifecycle class routes it to the dedicated `telemetry` datasource whenever one is registered, ' +
            'so a "no such table" here usually means the write ran against a DIFFERENT datasource than the ' +
            'one the table was created in. Set `OS_TELEMETRY_DB=0` to keep every lifecycle-classed object on ' +
            'the primary datasource.'
          : 'Fix: resolve the driver fault quoted at the head of this line on the connection this write ran ' +
            'on — every package lifecycle event that hits it loses its row until it is resolved.');
      if (logger?.error) {
        logger.error(message, err instanceof Error ? err : new Error(detail), { packageId: event.packageId });
      } else {
        logger?.warn?.(message, { packageId: event.packageId, err: detail });
      }
    } catch {
      /* logging must never break the uninstall's answer */
    }
  };

  /**
   * Write the ledger row. A NAMED callee so `pnpm check:durability-log-level`
   * anchors on it (`DURABILITY_CRITICAL_CALLEES`): a later edit cannot walk
   * the failure report above back down to `warn`.
   */
  const persistPackageLifecycleAuditRow = async (
    engine: IDataEngine,
    row: Record<string, unknown>,
  ): Promise<void> => {
    await engine.insert('sys_audit_log', row, { context: { isSystem: true } });
  };

  return {
    async recordPackageLifecycleEvent(event: PackageLifecycleAuditEvent): Promise<void> {
      if (
        !event
        || (event.action !== PACKAGE_UNINSTALL_AUDIT_ACTION && event.action !== PACKAGE_UNMANAGED_IMPORT_AUDIT_ACTION)
        || !nonEmpty(event.packageId)
      ) {
        return;
      }
      const engine = getEngine();
      if (!engine) return;
      if (probe === undefined || probedEngine !== engine) {
        probe = createFieldPresenceProbe(engine);
        probedEngine = engine;
      }
      const row = buildPackageLifecycleAuditRow(event, probe);
      try {
        await persistPackageLifecycleAuditRow(engine, row);
      } catch (err) {
        // #5226's class on the package seam: a DURABILITY degradation — the
        // package is gone, the system looks normal, and the row that says who
        // removed it is simply absent.
        reportWriteFailure(event, err);
      }
    },
  };
}
