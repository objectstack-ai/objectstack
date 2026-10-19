// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D10 item 5 · #23429 E1] The question `os migrate apply` asks
 * before it drops an `organization_id` column: has the organization-ownership
 * ceremony verified on this database?
 *
 * A v18 runtime declares no organization column on the ceremony's
 * column-drop tables (the D7 tables, the platform's and the ones a deployment
 * declares platform-global, and the `sys_metadata` family), so the drift
 * report lists each physical one as an unmapped, destructive column and
 * names `os migrate apply --allow-destructive` as its remedy. Applied ahead of
 * the ceremony, that drop skips its promotion and report steps, turns every
 * legacy organization row into an environment row, and leaves no physical
 * column for the v18 boot refusal to find — so the server starts with the
 * marker never written. D10 item 5 forbids exactly that escape hatch. So the
 * drop of `organization_id` on any table the ceremony plans waits for the
 * ceremony's verified marker, as `sys_account.issuer` (#17440) and
 * `sys_comment.reactions` (#23281) wait for theirs. ⛔ No flag stands it down.
 *
 * ## Which tables: every `organization_id` drop the drift offers (#23684)
 *
 * The ceremony's table set is the database's, not a list's: its plan meets
 * every physical table that carries `organization_id`, with the platform
 * inventory's row, a host fate supplement's row, the application-object fate,
 * or a refusal by name (`organization-ownership-plan.ts`). The drift can offer
 * to drop only a column that is physically there. So every `organization_id`
 * drop it offers is on a table the ceremony plans, and this gate holds back
 * every one: the platform inventory's tables, the objects a deployment
 * declares platform-global (ADR-0131 D7), and the objects a host's fate
 * supplement names, a file `os migrate apply` is never handed. The v18 boot
 * refusal judges the same population, every object that declares no
 * organization column, not the inventory.
 *
 * Reading the drift rather than a composed table list keeps one source: no
 * second copy of the ceremony's inventory composition, and no part of the
 * answer this command could fail to read.
 */

import type { MigrationFlagEngine } from '@objectstack/platform-objects/system';
import type { DataMigrationFlag } from '@objectstack/spec/system';

/** The column the ceremony owns the drop of. */
export const ORGANIZATION_COLUMN = 'organization_id';

/** The tables whose `organization_id` drop is among `intended`, sorted: every one, since the ceremony plans each table that carries the column. */
export function ceremonyOrganizationColumnDrops(
  intended: ReadonlyArray<{ table: string; op?: { type?: string; column?: string } }>,
): string[] {
  const tables = new Set<string>();
  for (const d of intended) {
    if (d.op?.type === 'drop_column' && d.op.column === ORGANIZATION_COLUMN) tables.add(d.table);
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
