// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13338 — how many users lose an access when a Setup catalog item is
 * switched off: the count the deactivation confirm names.
 *
 * Read when the confirm opens, from the server's assignment rows, through the
 * console's data source (`useAdapter`), the same reads the item's own holders
 * section makes, so the confirm and that section count the same people:
 *
 * - a **position** is held through its `sys_user_position` rows, by the
 *   position's name (`PositionHoldersSection`);
 * - a **permission set** is held directly through its `sys_user_permission_set`
 *   rows, by the set's name, and through every position whose registry
 *   definition lists the set (`AssignedUsersSection`, ADR-0131 D4). A set bound
 *   to the `everyone` anchor is held by every signed-in member: that is said,
 *   not counted.
 *
 * One person is counted once, however many rows they hold. A page the server
 * reports as longer than one read is said as a lower bound, never as the total.
 *
 * A permission set whose name more than one package holds (objectstack#32537,
 * ADR-0150 D4) is counted for the one holder the confirm switches: the same
 * reads, each grant and position read by the rule the resolver reads it with
 * (`permission-set-holder.ts`). A position whose declaring package holds no set
 * of the name is judged by that package's dependencies on the server; it is
 * counted, so the confirm never says fewer people than lose the access.
 * ⛔ A refused read rejects: the caller says the count could not be read, never
 * "0 users" (objectui#12706).
 */

import { positionsDistributing } from './AssignedUsersSection.js';
import { holderPackageOf, storedGrantHolders, type PermissionSetHolding } from './permission-set-holder.js';

/** Which catalog types the deactivation confirm counts holders for. */
export const HOLDER_COUNTED_TYPES = ['permission', 'position'] as const;

export function countsCatalogHolders(type: string): boolean {
  return (HOLDER_COUNTED_TYPES as readonly string[]).includes(type);
}

/** How many rows one read asks for; a longer answer is said as a lower bound. */
const HOLDER_PAGE_SIZE = 1000;

export interface CatalogHolderCount {
  /** Distinct users who hold the item, as far as the reads reached. */
  count: number;
  /** The server holds more rows than one read returned: `count` is a lower bound. */
  truncated: boolean;
  /** A permission set bound to the `everyone` anchor: every signed-in member holds it. */
  everyone: boolean;
}

/** The slice of a `DataSource` this module reads. */
export interface HolderReadSource {
  find(resource: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** The slice of the metadata store this module reads. */
export interface HolderMetadataSource {
  ensureType(type: string): Promise<unknown[]>;
}

/** The rows of a `find()` answer, read as `QueryResult` declares them (`data`); fakes answer with an array. */
function rowsOf(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const data = (res as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

/** Did the server hold more rows than this answer carries? */
function truncatedAnswer(res: unknown, rows: readonly unknown[]): boolean {
  if (Array.isArray(res)) return rows.length >= HOLDER_PAGE_SIZE;
  const r = res as { hasMore?: unknown; total?: unknown } | null;
  if (r?.hasMore === true) return true;
  if (typeof r?.total === 'number' && r.total > rows.length) return true;
  return rows.length >= HOLDER_PAGE_SIZE;
}

async function readUserIds(
  source: HolderReadSource,
  object: string,
  filter: Record<string, unknown>,
  into: Set<string>,
  keep: (row: Record<string, unknown>) => boolean = () => true,
): Promise<boolean> {
  const res = await source.find(object, { $filter: filter, $top: HOLDER_PAGE_SIZE });
  const rows = rowsOf(res);
  for (const row of rows) {
    const uid = row?.user_id;
    if (uid !== undefined && uid !== null && uid !== '' && keep(row)) into.add(String(uid));
  }
  return truncatedAnswer(res, rows);
}

/** The audience anchors: implicit memberships, never enumerated. */
const ANCHOR_POSITIONS = new Set(['everyone', 'guest']);

/**
 * How many users hold `name` of `type` — for a permission set, `holding`'s set
 * of the name when the page passes one (module doc). Rejects when there is no
 * data source or any read is refused.
 */
export async function readCatalogHolderCount(
  source: HolderReadSource | null | undefined,
  metadata: HolderMetadataSource,
  type: string,
  name: string,
  holding?: PermissionSetHolding,
): Promise<CatalogHolderCount> {
  if (!source) throw new Error('No data source to read the holders from.');
  const users = new Set<string>();
  if (type === 'position') {
    const truncated = await readUserIds(source, 'sys_user_position', { position: name }, users);
    return { count: users.size, truncated, everyone: false };
  }
  if (type !== 'permission') throw new Error(`No holders to count for metadata type '${type}'`);
  const heldHere = holding
    ? (grant: Record<string, unknown>) =>
        storedGrantHolders(holderPackageOf(grant.permission_set_package), holding.holders).includes(holding.packageId)
    : undefined;
  let truncated = await readUserIds(source, 'sys_user_permission_set', { permission_set: name }, users, heldHere);
  const distributing = positionsDistributing(await metadata.ensureType('position'), name, holding);
  const everyone = distributing.includes('everyone');
  const positions = distributing.filter((p) => !ANCHOR_POSITIONS.has(p));
  if (positions.length > 0) {
    truncated =
      (await readUserIds(source, 'sys_user_position', { position: { $in: positions } }, users)) || truncated;
  }
  return { count: users.size, truncated, everyone };
}
