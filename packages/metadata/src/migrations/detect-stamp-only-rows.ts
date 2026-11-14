// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Read-only detector: the `sys_metadata` rows that name their package by the
 * registry's `_packageId` stamp alone, each with the history evidence of how
 * the stamp got there (#32985; maintainer decision 2026-11-14 on #32985).
 *
 * ## Why
 *
 * `@objectstack/metadata` 17.0.0 through 18.3.0 — on a host whose
 * `MetadataPlugin` declares its `packageId`, primed eagerly with no
 * `artifactSource`, with a `DatabaseLoader` — saved every package-less row its
 * boot pass read back into the database stamped with the host's package
 * (`_packageId`, `_provenance`), with a new version and a history row. Such an
 * environment row then reads as the host's: listed as the host's item, a
 * phantom holder of its name (a bare read of a name a package also holds is
 * refused `409`), and deleted by `unregisterPackage(host)` until that door
 * kept such rows (#32985); an 18.4.0 boot also bound the `package_id` column of such a row of a type
 * stored per `(package, name)` to the host. From the row alone it cannot be
 * told from a row of the host's own item, which carries the same stamp. Its
 * history can: the environment's row was created without the stamp and an
 * update added it.
 *
 * ## What it reports
 *
 * Every row whose stored body names a package by `_packageId` alone — no
 * `packageId`, no legacy `package` (`stampOnlyPackageOf`) — and whose
 * `package_id` column is empty or names that same package, with a verdict
 * read from the row's own history, walked back from the row's `checksum`
 * through each history row's `previous_checksum`:
 *
 *  - `stamp-added` — a recorded version named no package and the next one
 *    added the stamp: the environment's row a boot stamped. `onlyStampAdded`
 *    says whether that version changed nothing else (the boot's signature).
 *  - `stamped-since-create` — the row's first recorded version is its create,
 *    and it already carried the stamp: the package's own row. A row of this
 *    verdict whose column is bound is not reported (every row a package's
 *    save writes on a current release is of that shape); one whose column is
 *    empty is, since `unregisterPackage` keeps it until forced.
 *  - `undetermined` — the history does not reach back far enough to tell
 *    (none kept, trimmed, or a row written by another writer), or the history
 *    table is not provisioned (`history: 'unavailable'`).
 *
 * ## What it never does
 *
 * It takes a driver's `find` and nothing else, so it cannot write through the
 * handle it is given, and it changes no row: who owns a row is not decided
 * here. A read failure other than an unprovisioned history table is thrown.
 *
 * ## The manual recipe, for a row reported `stamp-added`
 *
 * On a backup first. The row's current body is the environment's item plus
 * the two keys the boot added: remove `_packageId` and `_provenance` from the
 * stored body (`metadata`) and, if an 18.4.0 boot bound its column, set
 * `package_id` back to empty, in one update of that row. Leave a row reported
 * `undetermined` as it is unless its owner is known otherwise:
 * `unregisterPackage` keeps it, and `migrateDatabaseLoaderRowPackages` and the
 * boot leave its column unbound.
 *
 * Usage:
 *   import { detectStampOnlyRows } from '@objectstack/metadata/migrations';
 *   const report = await detectStampOnlyRows(driver, { packageId: 'com.acme.host' });
 */

import type { DriverQuery } from '@objectstack/spec/contracts';
import { isMissingTableError } from '@objectstack/types';
import { isPackageCaller, storedItemPackageId } from '../package-slotted-store.js';
import { parsedStoredBody, stampOnlyPackageOf } from '../stamp-only-row.js';

/** The one read this detector makes; an `IDataDriver` is one. */
export interface StampOnlyRowReadStore {
  find(table: string, query: DriverQuery): Promise<Record<string, unknown>[]>;
}

/** How the stamp got onto a reported row, as its history tells it (see the module doc). */
export type StampOnlyRowVerdict = 'stamp-added' | 'stamped-since-create' | 'undetermined';

/** One reported row and its evidence. */
export interface StampOnlyRowFinding {
  id: string;
  type: string;
  name: string;
  /** The package the body's `_packageId` stamp names. */
  packageId: string;
  /** The row's `package_id` column: `null` when empty, else the stamp's package (an 18.4.0 boot's bind). */
  column: string | null;
  /** The writer the row's `source` column names. */
  source: string | null;
  version: number | null;
  verdict: StampOnlyRowVerdict;
  /** `unavailable`: the history table is not provisioned. */
  history: 'read' | 'unavailable';
  /** The versions of the row's history chain, oldest first. */
  historyVersions: number[];
  /** `stamp-added`: the last recorded version that named no package. */
  unstampedVersion?: number;
  /** `stamp-added`: the version that added the stamp. */
  stampedVersion?: number;
  /** `stamp-added`: whether that version changed nothing but `_packageId` and `_provenance`. */
  onlyStampAdded?: boolean;
}

/** What {@link detectStampOnlyRows} found. */
export interface StampOnlyRowsReport {
  /** `sys_metadata` rows read. */
  scanned: number;
  /** The rows reported, in the table's read order. */
  rows: StampOnlyRowFinding[];
}

export interface StampOnlyRowsOptions {
  /** Report only rows stamped with this package (the host's). */
  packageId?: string;
  tableName?: string;
  historyTableName?: string;
}

/** The two keys the boot pass's stamp adds (`applyProtection`). */
const STAMP_KEYS: ReadonlySet<string> = new Set(['_packageId', '_provenance']);

/** Report the stamp-only rows with their history evidence. Read-only; see the module doc. */
export async function detectStampOnlyRows(
  store: StampOnlyRowReadStore,
  options?: StampOnlyRowsOptions,
): Promise<StampOnlyRowsReport> {
  const table = options?.tableName ?? 'sys_metadata';
  const historyTable = options?.historyTableName ?? 'sys_metadata_history';
  const rows = await store.find(table, {});
  const report: StampOnlyRowsReport = { scanned: rows.length, rows: [] };

  for (const row of rows) {
    const packageId = stampOnlyPackageOf(parsedStoredBody(row.metadata));
    if (packageId === undefined) continue;
    if (options?.packageId !== undefined && packageId !== options.packageId) continue;
    const column = typeof row.package_id === 'string' && isPackageCaller(row.package_id) ? row.package_id : null;
    if (column !== null && column !== packageId) continue;

    const chain = await historyChain(store, historyTable, row);
    const finding: StampOnlyRowFinding = {
      id: String(row.id),
      type: String(row.type),
      name: String(row.name),
      packageId,
      column,
      source: typeof row.source === 'string' ? row.source : null,
      version: typeof row.version === 'number' ? row.version : row.version == null ? null : Number(row.version),
      verdict: 'undetermined',
      history: chain === undefined ? 'unavailable' : 'read',
      historyVersions: (chain ?? []).map((entry) => entry.version),
    };
    if (chain !== undefined) judge(finding, chain);
    if (finding.verdict === 'stamped-since-create' && column !== null) continue;
    report.rows.push(finding);
  }
  return report;
}

interface HistoryEntry {
  version: number;
  operation: string;
  checksum: string;
  previous: string | null;
  body: unknown;
}

/**
 * The row's history, oldest first: from the row's `checksum` back through each
 * entry's `previous_checksum`, so another holder's rows of the name are never
 * read as this row's. `undefined` when the history table is not provisioned.
 */
async function historyChain(store: StampOnlyRowReadStore, historyTable: string, row: Record<string, unknown>): Promise<HistoryEntry[] | undefined> {
  let recorded: Record<string, unknown>[];
  try {
    recorded = await store.find(historyTable, { where: { type: row.type, name: row.name } });
  } catch (error) {
    if (!isMissingTableError(error, historyTable)) throw error;
    return undefined;
  }
  const entries: HistoryEntry[] = recorded
    .filter((entry) => typeof entry.checksum === 'string')
    .map((entry) => ({
      version: Number(entry.version) || 0,
      operation: String(entry.operation_type ?? ''),
      checksum: entry.checksum as string,
      previous: typeof entry.previous_checksum === 'string' ? entry.previous_checksum : null,
      body: parsedStoredBody(entry.metadata),
    }));
  const chain: HistoryEntry[] = [];
  const seen = new Set<string>();
  let cursor: string | null = typeof row.checksum === 'string' ? row.checksum : null;
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const at = entries.filter((entry) => entry.checksum === cursor).sort((a, b) => b.version - a.version)[0];
    if (!at) break;
    chain.unshift(at);
    cursor = at.previous;
  }
  return chain;
}

/** Fill `finding`'s verdict from the row's history chain (see the module doc). */
function judge(finding: StampOnlyRowFinding, chain: HistoryEntry[]): void {
  const stamped = chain.findIndex((entry) => storedItemPackageId(entry.body) === finding.packageId);
  if (stamped === -1) return;
  if (stamped === 0) {
    if (chain[0]!.operation === 'create') finding.verdict = 'stamped-since-create';
    return;
  }
  const before = chain[stamped - 1]!;
  if (storedItemPackageId(before.body) !== undefined) return;
  finding.verdict = 'stamp-added';
  finding.unstampedVersion = before.version;
  finding.stampedVersion = chain[stamped]!.version;
  finding.onlyStampAdded = sameJson(withoutStampKeys(before.body), withoutStampKeys(chain[stamped]!.body));
}

function withoutStampKeys(body: unknown): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
  return Object.fromEntries(Object.entries(body).filter(([key]) => !STAMP_KEYS.has(key)));
}

/** Whether two parsed bodies are the same JSON value, key order aside. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(b, key)
    && sameJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
