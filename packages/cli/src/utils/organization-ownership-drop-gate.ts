// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D10 item 5 · #23429 E1] The question `os migrate apply` asks
 * before it drops an `organization_id` column: has the organization-ownership
 * ceremony verified on this database?
 *
 * A v18 runtime declares no organization column on the ceremony's
 * column-drop tables (the D7 tables and the `sys_metadata` family), so the
 * drift report lists each physical one as an unmapped, destructive column and
 * names `os migrate apply --allow-destructive` as its remedy. Applied ahead of
 * the ceremony, that drop skips its promotion and report steps, turns every
 * legacy organization row into an environment row, and leaves no physical
 * column for the v18 boot refusal to find — so the server starts with the
 * marker never written. D10 item 5 forbids exactly that escape hatch. So the
 * drop of `organization_id` on any table in the ceremony's inventory waits for
 * the ceremony's verified marker, as `sys_account.issuer` (#17440) and
 * `sys_comment.reactions` (#23281) wait for theirs. ⛔ No flag stands it down.
 */

import type { MigrationFlagEngine } from '@objectstack/platform-objects/system';
import type { DataMigrationFlag } from '@objectstack/spec/system';
import { ORGANIZATION_OWNERSHIP_INVENTORY } from './organization-ownership-inventory.js';

/** The column the ceremony owns the drop of. */
export const ORGANIZATION_COLUMN = 'organization_id';

/** Every table the ceremony's inventory names. */
const CEREMONY_TABLES: ReadonlySet<string> = new Set(ORGANIZATION_OWNERSHIP_INVENTORY.map((entry) => entry.object));

/** The tables whose `organization_id` drop is among `intended`, sorted. */
export function ceremonyOrganizationColumnDrops(
  intended: ReadonlyArray<{ table: string; op?: { type?: string; column?: string } }>,
): string[] {
  const tables = new Set<string>();
  for (const d of intended) {
    if (d.op?.type === 'drop_column' && d.op.column === ORGANIZATION_COLUMN && CEREMONY_TABLES.has(d.table)) tables.add(d.table);
  }
  return [...tables].sort();
}

/**
 * Is the ceremony's run verified on this database? Fails toward retention: no
 * `sys_migration` object, no row, an unreadable row or an unverified one all
 * answer `verified: false`.
 */
export async function readOrganizationOwnershipMarker(
  engine: MigrationFlagEngine,
): Promise<{ verified: boolean; flag: DataMigrationFlag | null }> {
  const { readDataMigrationFlag } = await import('@objectstack/platform-objects/system');
  const { isDataMigrationFlagVerified, ORGANIZATION_OWNERSHIP_MIGRATION_ID } = await import('@objectstack/spec/system');
  const flag = await readDataMigrationFlag(engine, ORGANIZATION_OWNERSHIP_MIGRATION_ID);
  return { verified: isDataMigrationFlagVerified(flag), flag };
}
