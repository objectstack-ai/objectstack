// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32460] The runtime-owned indexes `os migrate apply` builds beside the DDL
 * it performs, as `os migrate plan` lists them.
 *
 * ## The gap this closes
 *
 * `metadata-protocol` builds `sys_user_permission_set`'s package-less guard,
 * `uniq_sys_user_permission_set_packageless` (ADR-0150 D4), when a schema-sync
 * pass's DDL is done (`objectql:schema-synced`). `os migrate apply` holds that
 * pass's DDL back until the operator confirms, then performs it and announces
 * the pass (`DeferSchemaDdlPlugin.announceSchemaSynced` in `schema-migrate.ts`),
 * and the announcement builds the guard. The plan listed the grant table apply
 * creates and said nothing about the index apply then builds on it, so the plan
 * an operator reads before applying was silent about DDL the apply ran.
 *
 * ## Which indexes: the ones apply builds, and only those
 *
 * The runtime-index preflight (`runtimeIndexProbes` in `metadata-protocol`)
 * describes every runtime-owned index. All but one are built at `kernel:ready`
 * by the platform migrations of a serving boot, which every one-shot CLI boot
 * declares off (`runPlatformMigrations: false`), so `apply` never builds them:
 * the activation ledger's package-less index is one of those. The maintainer's
 * ruling of 2026-08-22, recorded in that module's header, keeps them out of the
 * plan (the plan describes work `apply` will do) and reports what blocks them
 * through `os migrate duplicates`. The grant guard is built at schema sync
 * whatever that gate says, which is why `apply` builds it, and why it is listed
 * here. {@link SCHEMA_SYNC_INDEX_OWNERS} names it by the migration that builds
 * it; an index a later migration builds on `objectql:schema-synced` joins it
 * there.
 *
 * ## When apply builds it: the plan says the same
 *
 * - Only beside DDL apply performs. Apply announces the pass from its flush, and
 *   it flushes only when the boot deferred DDL (a skip-sync boot leaves its
 *   primary to its serving boot) and the plan lists a change to perform; with
 *   nothing to apply it returns before the flush. Either way this lists nothing.
 * - Not where it already stands: the build reads the catalog first and sends no
 *   DDL, so a standing index is no step. The same catalog statement answers here.
 * - Not on a table that is not there and that the same apply does not create:
 *   the build finds no table and does nothing.
 * - Refused where rows the index would hold to one already collide (ADR-0120
 *   D4: the build refuses and touches no row). The step says so, with the count.
 *
 * Read-only: every statement is the owner's (the preflight's own runner and the
 * guard's own catalog statement), and every one is a `SELECT`.
 */

import chalk from 'chalk';
import type { PendingSchemaWork } from '@objectstack/driver-sql';
import { operatorFacingErrorText } from '@objectstack/types';

/** One runtime-owned index `os migrate apply` would build, as the plan lists it. */
export interface SchemaSyncIndexStep {
  /** The exported migration function that builds it. */
  migration: string;
  table: string;
  index: string;
  /** The index's key parts, in key order. */
  keyParts: string[];
  /** The row subset the index covers, or `null` when it covers every row. */
  rowScope: string | null;
  /**
   * - `build`: apply builds it.
   * - `blocked`: apply's build is refused, because rows the index would hold to
   *   one already collide; it leaves every row as it is.
   * - `unreadable`: whether it already stands could not be read; apply builds it
   *   if it is missing.
   */
  status: 'build' | 'blocked' | 'unreadable';
  /** Present (`true`) when the table is one this same apply creates first. */
  onCreatedTable?: true;
  /** On `blocked`: how many key values collide, and how many rows hold them. */
  duplicateKeys?: number;
  duplicateRows?: number;
  /** On `unreadable`: why. */
  detail?: string;
}

type MetadataProtocol = typeof import('@objectstack/metadata-protocol');

/** How to ask a database about one index a schema-sync migration builds. */
interface SchemaSyncIndexOwner {
  /** The raw-SQL seam (and dialect) behind the index's table, resolved as its build resolves it. */
  seam: (mp: MetadataProtocol, engine: unknown) => { exec: (sql: string) => Promise<unknown>; client?: string } | undefined;
  /** The build's own catalog statement: a row when the index stands; `undefined` for a dialect it has none for. */
  presenceSql: (mp: MetadataProtocol, client?: string) => string | undefined;
}

/**
 * The indexes built on `objectql:schema-synced`, which `os migrate apply`
 * therefore builds, keyed by the migration that builds each (module doc).
 * Everything else about each one is read from its `runtimeIndexProbes` entry.
 */
const SCHEMA_SYNC_INDEX_OWNERS: Readonly<Record<string, SchemaSyncIndexOwner>> = {
  ensureUserPermissionSetPackagelessIndex: {
    seam: (mp, engine) => mp.resolveUserPermissionSetIndexSeam(engine),
    presenceSql: (mp, client) => mp.buildUserPermissionSetPackagelessIndexPresenceSql(client),
  },
};

/** The migrations {@link collectSchemaSyncIndexes} reads, for the pin that holds the list to its rule. */
export const SCHEMA_SYNC_INDEX_MIGRATIONS: readonly string[] = Object.keys(SCHEMA_SYNC_INDEX_OWNERS);

export interface CollectSchemaSyncIndexesInput {
  /** The boot's schema sync (`SchemaStack.schemaSync`): only a deferred boot's apply announces the pass. */
  schemaSync: 'deferred' | 'performed' | 'skipped';
  /** Whether the plan lists any change (drift or pending work): apply flushes only then. */
  applyPerformsWork: boolean;
  /** The work the boot held back: a `create_table` here is a table the same apply creates. */
  pending: readonly PendingSchemaWork[];
  /** The ObjectQL engine, through which each index's seam is resolved. */
  engine: unknown;
}

/**
 * Every index `os migrate apply` would build beside its DDL on this database,
 * in the order {@link SCHEMA_SYNC_INDEX_OWNERS} names them. `[]` when apply
 * builds none: each one already stands, its table is not there, or apply
 * performs no DDL at all (module doc, "When apply builds it").
 */
export async function collectSchemaSyncIndexes(input: CollectSchemaSyncIndexesInput): Promise<SchemaSyncIndexStep[]> {
  if (input.schemaSync !== 'deferred' || !input.applyPerformsWork) return [];
  const mp = await import('@objectstack/metadata-protocol');
  const created = new Set(input.pending.filter((w) => w.kind === 'create_table').map((w) => w.table));

  const steps: SchemaSyncIndexStep[] = [];
  for (const [migration, owner] of Object.entries(SCHEMA_SYNC_INDEX_OWNERS)) {
    const seam = owner.seam(mp, input.engine);
    const probe = mp.runtimeIndexProbes({ client: seam?.client }).find((p) => p.migration === migration);
    if (!probe) {
      throw new Error(
        `The runtime-index preflight describes no index built by ${migration}, so this plan cannot say what ` +
        '"os migrate apply" builds beside its DDL. Upgrade @objectstack/metadata-protocol and @objectstack/cli together.',
      );
    }
    const step = { migration, table: probe.table, index: probe.index, keyParts: [...probe.keyParts], rowScope: probe.rowScope };

    // The same apply creates the table and then builds the index on it: an
    // empty table holds no collision.
    if (created.has(probe.table)) {
      steps.push({ ...step, status: 'build', onCreatedTable: true });
      continue;
    }
    // No raw-SQL driver behind the table: the build has no seam either and builds nothing.
    if (!seam) continue;

    const [preflight] = (await mp.collectRuntimeIndexPreflight(seam.exec, { client: seam.client }))
      .filter((p) => p.migration === migration);
    if (!preflight || preflight.status === 'table-absent') continue;
    if (preflight.status === 'unreadable') {
      steps.push({ ...step, status: 'unreadable', ...(preflight.detail ? { detail: preflight.detail } : {}) });
      continue;
    }
    // A colliding key cannot sit under a standing unique index over the same
    // key and rows, so `blocked` already says the index is missing.
    if (preflight.status === 'blocked') {
      steps.push({
        ...step,
        status: 'blocked',
        duplicateKeys: preflight.groups.length,
        duplicateRows: preflight.groups.reduce((n, g) => n + g.rowCount, 0),
      });
      continue;
    }

    const sql = owner.presenceSql(mp, seam.client);
    if (sql === undefined) {
      steps.push({
        ...step,
        status: 'unreadable',
        detail: `there is no catalog statement for the ${seam.client ? `'${seam.client}'` : 'unnamed'} dialect`,
      });
      continue;
    }
    let result: unknown;
    try {
      result = await seam.exec(sql);
    } catch (error) {
      steps.push({ ...step, status: 'unreadable', detail: operatorFacingErrorText(error) });
      continue;
    }
    if (result === null || result === undefined) {
      steps.push({ ...step, status: 'unreadable', detail: 'the raw-SQL seam returned no result set' });
      continue;
    }
    // Present: the build sends no DDL, so there is no step.
    if (mp.normalizeRows(result).length > 0) continue;
    steps.push({ ...step, status: 'build' });
  }
  return steps;
}

/** `unique (a, b, c) WHERE scope` — the index as the plan names it. */
function describeIndexShape(step: SchemaSyncIndexStep): string {
  return `unique (${step.keyParts.join(', ')})${step.rowScope ? ` WHERE ${step.rowScope}` : ''}`;
}

/**
 * The plan's section for {@link collectSchemaSyncIndexes}: a heading and one
 * line per index, or nothing when apply builds none. Placed after the held-back
 * work and before the drift, the order `os migrate apply` performs them in: its
 * flush runs the held-back DDL and then builds these, and the drift comes after.
 */
export function renderSchemaSyncIndexes(steps: readonly SchemaSyncIndexStep[]): string[] {
  if (steps.length === 0) return [];
  const lines = [`  ${chalk.bold('Runtime-owned indexes (built when you apply, after the work above)')}`];
  for (const step of steps) {
    const name = `${step.table}.${step.index}`;
    const shape = describeIndexShape(step);
    if (step.status === 'build') {
      const where = step.onCreatedTable ? ', on the table created above' : '';
      lines.push(`    ${chalk.cyan('+')} ${chalk.cyan(name)} ${chalk.dim(`[${shape}${where}]`)}`);
    } else if (step.status === 'blocked') {
      lines.push(
        `    ${chalk.red('✗')} ${chalk.red(name)} ${chalk.dim(`[${shape}]`)} ` +
        `— refused when you apply: ${step.duplicateKeys ?? '?'} key value(s) are held by ${step.duplicateRows ?? '?'} row(s), ` +
        'more than one each. Apply changes none of those rows and performs the rest of the plan. ' +
        'List them with: os migrate duplicates',
      );
    } else {
      lines.push(
        `    ${chalk.yellow('?')} ${chalk.yellow(name)} ${chalk.dim(`[${shape}]`)} ` +
        `— whether it already stands could not be read${step.detail ? ` (${step.detail})` : ''}; ` +
        'apply builds it if it is missing',
      );
    }
  }
  lines.push('');
  return lines;
}
