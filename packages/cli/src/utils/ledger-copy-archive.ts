// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataDriver, IObjectQLEngine } from '@objectstack/spec/contracts';

/**
 * The archive half of the `os migrate` ledger-copy rewrites
 * (`audit-mail-bodies`, `audit-key-material`): which archive datasource each
 * copy table declares, whether this boot reached it, and the run over the
 * ones it did. One implementation, so the commands never disagree about what
 * "examined", "none" or "not-connected" means (#24899).
 *
 * What the command did about one declared archive target:
 *
 *  - `examined`: its driver is registered on this boot, and `report` is the run;
 *  - `not-connected`, NOT examined: either the stack config declares a
 *    datasource of that name that this boot attempted and did not connect
 *    (`connection` carries the connect service's retained verdict), or an
 *    active runtime datasource row of that name exists, which `os serve`
 *    connects and this boot does not;
 *  - `unknown`, NOT examined: neither of the above, and the runtime rows could
 *    not be read;
 *  - `none`: no datasource of that name is declared and connected on this boot,
 *    none was attempted, and no active runtime row names one. That is all it
 *    checked: an archive a host registers in code outside the stack config is
 *    not visible here.
 *
 * `not-connected` and `unknown` fail the run.
 */
export interface ArchiveOutcome<Report> {
  datasource: string;
  objects: string[];
  status: 'examined' | 'none' | 'not-connected' | 'unknown';
  report?: Report;
  connection?: { status: string; reason?: string };
}

/**
 * The connect service's retained verdict for a declared datasource named
 * `datasource` that this boot attempted and did not connect, or `undefined`
 * when it connected or was never attempted. Gate (c) `autoConnect` is not a
 * fail-fast trigger, so a declared archive that fails to connect only degrades
 * and leaves no driver behind. The verdicts are the ones
 * `findDeclaredDatasourceDrivers` reads.
 */
function declaredConnectFailure(kernel: unknown, datasource: string): { status: string; reason?: string } | undefined {
  let states: unknown;
  try {
    states = (kernel as { getService?: (n: string) => any })?.getService?.('datasource-connection')?.listConnectionStates?.();
  } catch {
    return undefined;
  }
  const state = (Array.isArray(states) ? states : []).find((s: { name?: unknown }) => s?.name === datasource) as
    | { status?: unknown; reason?: unknown; availability?: unknown }
    | undefined;
  if (!state || state.availability === 'available') return undefined;
  return {
    status: String(state.status),
    ...(typeof state.reason === 'string' && state.reason !== '' ? { reason: state.reason } : {}),
  };
}

/**
 * Does the database hold an active runtime datasource row named `datasource`?
 * Runtime datasources are `sys_metadata` rows of type `datasource` — the
 * store `os serve`'s datasource admin rehydrates its pools from at boot. Ids
 * only are read; a refused read answers `unknown`, never `none`.
 */
async function runtimeDatasourceRowStatus(
  engine: Pick<IObjectQLEngine, 'find'>,
  datasource: string,
): Promise<'none' | 'not-connected' | 'unknown'> {
  try {
    const rows = await engine.find(
      'sys_metadata',
      { where: { type: 'datasource', name: datasource, state: 'active' }, fields: ['id'], limit: 1 },
      { context: { isSystem: true } },
    );
    return Array.isArray(rows) && rows.length > 0 ? 'not-connected' : 'none';
  } catch {
    return 'unknown';
  }
}

/**
 * Each copy table's declared archive target, then `run` through that
 * datasource's driver — the registry the Archiver itself resolves
 * `archive.to` against (`engine.datasource(name)`). A target this boot did not
 * connect is classified, never run and never reported clean.
 *
 * `reads` answers the runtime-datasource-row probe; pass the command's
 * absent-table read view, so a table the read-only boot measured absent reads
 * as no rows.
 */
export async function examineArchiveTargets<Table extends string, Report extends { failures: number }>(opts: {
  engine: Pick<IObjectQLEngine, 'getObject' | 'getDriverByName'>;
  kernel: unknown;
  reads: Pick<IObjectQLEngine, 'find'>;
  tables: readonly Table[];
  run: (driver: IDataDriver, objects: Table[]) => Promise<Report>;
}): Promise<ArchiveOutcome<Report>[]> {
  const targets = new Map<string, Table[]>();
  for (const object of opts.tables) {
    const to = (opts.engine.getObject(object) as { lifecycle?: { archive?: { to?: unknown } } } | undefined)
      ?.lifecycle?.archive?.to;
    if (typeof to !== 'string' || to === '') continue;
    targets.set(to, [...(targets.get(to) ?? []), object]);
  }
  const archive: ArchiveOutcome<Report>[] = [];
  for (const [datasource, objects] of targets) {
    const driver = opts.engine.getDriverByName?.(datasource);
    if (driver) {
      archive.push({ datasource, objects, status: 'examined', report: await opts.run(driver, objects) });
      continue;
    }
    // Not connected on this boot. A declaration this boot attempted and did
    // not connect, or a runtime datasource row of that name (an archive
    // `os serve` connects and this boot cannot): NOT examined.
    const connection = declaredConnectFailure(opts.kernel, datasource);
    if (connection) {
      archive.push({ datasource, objects, status: 'not-connected', connection });
      continue;
    }
    archive.push({ datasource, objects, status: await runtimeDatasourceRowStatus(opts.reads, datasource) });
  }
  return archive;
}

/** The failures the archive half adds: each examined run's own, plus one per target NOT examined. */
export function archiveFailureCount(archive: ReadonlyArray<ArchiveOutcome<{ failures: number }>>): number {
  return archive.reduce(
    (n, a) => n + (a.report?.failures ?? 0) + (a.status === 'not-connected' || a.status === 'unknown' ? 1 : 0),
    0,
  );
}
