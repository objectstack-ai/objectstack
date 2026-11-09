// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D8 rows R1 and R3, D10] The stored references to a permission set
 * gain the package that holds the set, beside its name — backfilled at boot.
 *
 * A grant (`sys_user_permission_set.permission_set`) and an audience-binding
 * suggestion (`sys_audience_binding_suggestion.permission_set_name`) name a
 * permission set by name. A permission set is behavioural metadata
 * (ADR-0150 D1 bucket 2), identified by `(package, name)`, so each reference
 * gains a second column, `permission_set_package`: two facts, two columns
 * (ADR-0126 §4), ⛔ never a re-encoded literal.
 *
 * ## Where the answer comes from
 *
 * The package is the one holder of the name in this environment when the
 * backfill runs, asked of the one rule (`resolvePackageScopedHolders`,
 * `@objectstack/core`) as a caller with no package, over the engine
 * registry's three holder reads — the source objectql's
 * `resolvePackageScopedName` hands the same rule, and the one the security
 * catalog reads permission sets through. ⛔ No second rule, no walk of its
 * own, no first-registered fallback:
 *
 *  - resolved to a package → the row takes that package;
 *  - resolved to the environment's own set, or the platform's → stays null,
 *    which is its spelling;
 *  - refused → the ambiguous set: left null, and every candidate named;
 *  - not-found → no package holds the name: left null, and named.
 *
 * Phase 1's one-holder refusal keeps a permission-set name to one package
 * holder per environment, so the ambiguous set is what a pre-phase-1 clash
 * left behind.
 *
 * ## What it does not change
 *
 * No reader or writer moves onto the column (ADR-0150 red line 3): the
 * authorization resolver still reads a grant by name, a suggestion is still
 * confirmed by name, and no writer stamps the column — a row written after a
 * boot is bound by the next one. The readers that will read it are the
 * permission-set children that follow (the B child for permission sets; S4's
 * upgrade report). No unique key changes.
 *
 * ## Re-runnable
 *
 * It reads only rows whose `permission_set_package` is null and writes only
 * that column, so a second run binds nothing and reports the same ambiguous
 * and unheld names. A row that names a package is never read as a candidate,
 * so a run can only add a package, never move one.
 *
 * For a suggestion row it also reports a row whose `permission_set_package`
 * differs from its `package_id` (the package that made the suggestion, which
 * is the package that ships the set): every row reads equal today, and one
 * that does not is reported, never rewritten.
 */

import {
  describePackageScopedHolder,
  resolvePackageScopedHolders,
  type PackageScopedResolution,
} from '@objectstack/core';
import { packageResolutionClosure, type PackageClosureRegistry } from '@objectstack/metadata-core';
import { keysetWalk } from '@objectstack/types';

/** One stored reference to a permission set (ADR-0150 D8). */
export interface StoredPermissionSetReference {
  /** The ADR-0150 D8 row. */
  readonly row: 'R1' | 'R3';
  /** The table. */
  readonly object: string;
  /** The column naming the set. */
  readonly nameColumn: string;
  /** The column this backfill fills. */
  readonly packageColumn: string;
}

/** The column every reference below gains (ADR-0150 D8). */
export const PERMISSION_SET_PACKAGE_COLUMN = 'permission_set_package';

/** The two stored references to a permission set this plugin owns (ADR-0150 D8 rows R1, R3). */
export const STORED_PERMISSION_SET_REFERENCES: readonly StoredPermissionSetReference[] = Object.freeze([
  { row: 'R1', object: 'sys_user_permission_set', nameColumn: 'permission_set', packageColumn: PERMISSION_SET_PACKAGE_COLUMN },
  { row: 'R3', object: 'sys_audience_binding_suggestion', nameColumn: 'permission_set_name', packageColumn: PERMISSION_SET_PACKAGE_COLUMN },
]);

/** The suggestion table, whose `package_id` the backfilled column is compared with. */
const SUGGESTION_OBJECT = 'sys_audience_binding_suggestion';

/** Infrastructure rows, written and read the way the platform's own passes do. */
const SYSTEM_CTX = { isSystem: true } as const;

/** Rows per page of the walk. */
const PAGE_SIZE = 500;

/** Who holds a referenced name, as the backfill reads the rule's answer. */
export type StoredReferenceHolder =
  | { readonly kind: 'package'; readonly packageId: string }
  | { readonly kind: 'environment' }
  | { readonly kind: 'platform' }
  | { readonly kind: 'unheld' }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly string[] };

/** The registry reads the rule is asked over — ObjectQL's `SchemaRegistry` carries every one. */
export interface PermissionSetHolderRegistry extends PackageClosureRegistry {
  packageScopedHoldersOf(type: string, name: string, callerPackageId?: string | null): readonly string[];
  getPackageScopedItem(type: string, name: string, packageId: string): unknown;
  getEnvironmentScopedItem(type: string, name: string): unknown;
}

/** Does `registry` carry the holder reads (a test stand-in or a registry-less host may not)? */
export function isPermissionSetHolderRegistry(registry: unknown): registry is PermissionSetHolderRegistry {
  const r = registry as Partial<Record<keyof PermissionSetHolderRegistry, unknown>> | null | undefined;
  return (
    typeof r?.packageScopedHoldersOf === 'function' &&
    typeof r.getPackageScopedItem === 'function' &&
    typeof r.getEnvironmentScopedItem === 'function'
  );
}

/** The rule's answer, as the backfill reads it (module doc). */
export function storedReferenceHolderOf(resolution: PackageScopedResolution): StoredReferenceHolder {
  switch (resolution.status) {
    case 'resolved':
      return resolution.holder.kind === 'package' ? { kind: 'package', packageId: resolution.holder.packageId } : { kind: resolution.holder.kind };
    case 'refused':
      return { kind: 'ambiguous', candidates: resolution.candidates.map(describePackageScopedHolder) };
    default:
      return { kind: 'unheld' };
  }
}

/**
 * The holder of a permission-set name for a caller with no package: the one
 * rule over the registry's holder reads (module doc).
 */
export function permissionSetHolderOf(registry: PermissionSetHolderRegistry): (name: string) => StoredReferenceHolder {
  return (name) =>
    storedReferenceHolderOf(
      resolvePackageScopedHolders(
        { type: 'permission', name, callerPackageId: null },
        {
          packageHolders: registry.packageScopedHoldersOf('permission', name, null),
          packageItem: (packageId) => registry.getPackageScopedItem('permission', name, packageId),
          environmentItem: () => registry.getEnvironmentScopedItem('permission', name),
        },
        (callerPackageId) => packageResolutionClosure(registry, callerPackageId),
      ),
    );
}

/** A name and how many rows carry it. */
export interface ReferencedName {
  readonly name: string;
  readonly rows: number;
}

/** What one run did for one reference, or would do in a dry run. */
export interface StoredReferenceBackfillReport {
  readonly row: StoredPermissionSetReference['row'];
  readonly object: string;
  /** Names whose rows now carry the one package holder (written, or to be written in a dry run). */
  readonly bound: ReadonlyArray<ReferencedName & { readonly packageId: string }>;
  /** Names two or more holders hold: left null, every candidate named. */
  readonly ambiguous: ReadonlyArray<ReferencedName & { readonly candidates: readonly string[] }>;
  /** Names no package holds: left null. */
  readonly unheld: readonly ReferencedName[];
  /** Names the environment's own item, or the platform's, answers: left null, its spelling. */
  readonly unpackaged: ReadonlyArray<ReferencedName & { readonly holder: 'environment' | 'platform' }>;
  /** Suggestion rows whose `permission_set_package` is not their `package_id` (R3 only); never rewritten. */
  readonly differs: ReadonlyArray<{ readonly id: string; readonly name: string; readonly packageId: string; readonly permissionSetPackage: string }>;
}

/** The engine slice the backfill reads and writes through. */
export interface StoredReferenceBackfillEngine {
  find(object: string, options?: unknown): Promise<unknown>;
  update(object: string, data: unknown, options?: unknown): Promise<unknown>;
}

/** Options for {@link backfillStoredPermissionSetPackages}. */
export interface StoredReferenceBackfillOptions {
  /** Report what would be bound and write nothing. */
  readonly dryRun?: boolean;
}

type Row = Record<string, unknown>;

const tally = <T extends ReferencedName>(into: Map<string, T>, name: string, make: () => T): void => {
  const at = into.get(name);
  into.set(name, { ...(at ?? make()), rows: (at?.rows ?? 0) + 1 });
};

/**
 * Bind every row of `reference` whose package column is null to the one
 * package that holds its name (module doc). Reads by keyset page; writes only
 * the package column, one row at a time, by id.
 */
export async function backfillStoredPermissionSetPackages(
  engine: StoredReferenceBackfillEngine,
  reference: StoredPermissionSetReference,
  holderOf: (name: string) => StoredReferenceHolder,
  options?: StoredReferenceBackfillOptions,
): Promise<StoredReferenceBackfillReport> {
  const bound = new Map<string, ReferencedName & { packageId: string }>();
  const ambiguous = new Map<string, ReferencedName & { candidates: readonly string[] }>();
  const unheld = new Map<string, ReferencedName>();
  const unpackaged = new Map<string, ReferencedName & { holder: 'environment' | 'platform' }>();
  const answers = new Map<string, StoredReferenceHolder>();
  const { object, nameColumn, packageColumn } = reference;

  const walk = keysetWalk<Row>(
    async (query) => {
      const page = await engine.find(object, { ...query, fields: ['id', nameColumn, packageColumn], context: SYSTEM_CTX });
      return Array.isArray(page) ? (page as Row[]) : [];
    },
    { where: { [packageColumn]: null }, pageSize: PAGE_SIZE },
  );
  for await (const page of walk.pages()) {
    for (const row of page) {
      // Only a row with no package is a candidate; the filter is the driver's,
      // and this re-check keeps a driver that reads it loosely from moving one.
      if (row[packageColumn] !== null && row[packageColumn] !== undefined) continue;
      const id = row.id;
      const name = row[nameColumn];
      // A row with nothing to address it by, or a grant that names no set
      // (the catalog reference report names those), is left as it stands.
      if (id === null || id === undefined || typeof name !== 'string' || name === '') continue;
      let holder = answers.get(name);
      if (!holder) {
        holder = holderOf(name);
        answers.set(name, holder);
      }
      switch (holder.kind) {
        case 'package': {
          if (!options?.dryRun) {
            await engine.update(object, { id, [packageColumn]: holder.packageId }, { context: SYSTEM_CTX });
          }
          const packageId = holder.packageId;
          tally(bound, name, () => ({ name, rows: 0, packageId }));
          break;
        }
        case 'ambiguous': {
          const candidates = holder.candidates;
          tally(ambiguous, name, () => ({ name, rows: 0, candidates }));
          break;
        }
        case 'unheld':
          tally(unheld, name, () => ({ name, rows: 0 }));
          break;
        default: {
          const kind = holder.kind;
          tally(unpackaged, name, () => ({ name, rows: 0, holder: kind }));
        }
      }
    }
  }

  const differs = object === SUGGESTION_OBJECT ? await suggestionRowsThatDiffer(engine, reference, bound, options) : [];
  return {
    row: reference.row,
    object,
    bound: [...bound.values()],
    ambiguous: [...ambiguous.values()],
    unheld: [...unheld.values()],
    unpackaged: [...unpackaged.values()],
    differs,
  };
}

/**
 * Suggestion rows whose set's package is not the package that suggested it
 * (module doc). Read over every row that carries a set package — the rows this
 * run bound included, as they will read once written — so a second run reports
 * the same rows.
 */
async function suggestionRowsThatDiffer(
  engine: StoredReferenceBackfillEngine,
  reference: StoredPermissionSetReference,
  boundThisRun: ReadonlyMap<string, { packageId: string }>,
  options?: StoredReferenceBackfillOptions,
): Promise<StoredReferenceBackfillReport['differs']> {
  const { object, nameColumn, packageColumn } = reference;
  const out: Array<StoredReferenceBackfillReport['differs'][number]> = [];
  const walk = keysetWalk<Row>(
    async (query) => {
      const page = await engine.find(object, { ...query, fields: ['id', nameColumn, packageColumn, 'package_id'], context: SYSTEM_CTX });
      return Array.isArray(page) ? (page as Row[]) : [];
    },
    { pageSize: PAGE_SIZE },
  );
  for await (const page of walk.pages()) {
    for (const row of page) {
      const name = row[nameColumn];
      if (typeof name !== 'string' || name === '') continue;
      // A dry run wrote nothing: read the row as the run would have left it.
      const stored = row[packageColumn];
      const setPackage = typeof stored === 'string' && stored !== '' ? stored : options?.dryRun ? boundThisRun.get(name)?.packageId : undefined;
      const packageId = row.package_id;
      if (setPackage === undefined || typeof packageId !== 'string' || setPackage === packageId) continue;
      out.push({ id: String(row.id), name, packageId, permissionSetPackage: setPackage });
    }
  }
  return out;
}

/** The registry slice the boot run reads, beyond the holder reads. */
type BootRegistry = { readonly bareNameHoldersAreSealed?: boolean; getObject?(name: string): unknown };

/** The logger slice the boot run writes to. */
export interface StoredReferenceBackfillLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

const rowsOf = (n: number): string => `${n} row${n === 1 ? '' : 's'}`;

/**
 * Run the backfill once for this boot, for each reference whose table this
 * composition carries, and say what it did (module doc). Never fatal: a table
 * that cannot be read or written keeps its rows as they were — the state every
 * reader already handles — and the next boot tries again.
 *
 * It runs only once the registry's bare-name holders are sealed
 * (`kernel:bootstrapped`): before that, a package of this boot could still
 * register and change who holds a name, and binding then would record an
 * answer the boot can still contradict.
 */
export async function backfillStoredPermissionSetPackagesAtBoot(
  engine: Partial<StoredReferenceBackfillEngine> | undefined,
  registry: unknown,
  logger: StoredReferenceBackfillLogger,
): Promise<StoredReferenceBackfillReport[] | undefined> {
  if (!engine || typeof engine.find !== 'function' || typeof engine.update !== 'function') return undefined;
  if (!isPermissionSetHolderRegistry(registry)) return undefined;
  const boot = registry as unknown as BootRegistry;
  if (boot.bareNameHoldersAreSealed !== true) return undefined;
  const holderOf = permissionSetHolderOf(registry);
  const reports: StoredReferenceBackfillReport[] = [];
  for (const reference of STORED_PERMISSION_SET_REFERENCES) {
    let carried = false;
    try {
      carried = Boolean(boot.getObject?.(reference.object));
    } catch {
      carried = false; // a registry that cannot answer is not an answer
    }
    if (!carried) continue;
    let report: StoredReferenceBackfillReport;
    try {
      report = await backfillStoredPermissionSetPackages(engine as StoredReferenceBackfillEngine, reference, holderOf);
    } catch (e: unknown) {
      logger.warn(
        `[security] the ${reference.object}.${reference.packageColumn} backfill did not finish: rows that name no package ` +
          'keep naming none, every reader still reads the set by name as before, and the next boot tries again.',
        { error: e instanceof Error ? e.message : String(e) },
      );
      continue;
    }
    reports.push(report);
    logStoredReferenceBackfill(report, logger);
  }
  return reports;
}

/** What a run says (module doc): bound and unheld at `info`, the ambiguous set and a differing suggestion at `warn`. */
export function logStoredReferenceBackfill(report: StoredReferenceBackfillReport, logger: StoredReferenceBackfillLogger): void {
  const at = `${report.object}.${PERMISSION_SET_PACKAGE_COLUMN}`;
  if (report.bound.length > 0) {
    logger.info(
      `[security] ${at}: rows now name the package that holds their permission set (ADR-0150 D8) — ` +
        report.bound.map((b) => `'${b.name}' → ${b.packageId} (${rowsOf(b.rows)})`).join(', ') + '.',
    );
  }
  if (report.ambiguous.length > 0) {
    logger.warn(
      `[security] ${at}: more than one holder holds these permission-set names, so none is picked and each row is ` +
        'left naming no package. Every reader still reads the set by name, as before — ' +
        report.ambiguous.map((a) => `'${a.name}' (${rowsOf(a.rows)}; held by ${a.candidates.join('; ')})`).join(', ') + '.',
      { ambiguous: report.ambiguous },
    );
  }
  if (report.unheld.length > 0) {
    logger.info(
      `[security] ${at}: no package holds these permission-set names, so their rows name no package — ` +
        report.unheld.map((u) => `'${u.name}' (${rowsOf(u.rows)})`).join(', ') + '.',
      { unheld: report.unheld },
    );
  }
  if (report.differs.length > 0) {
    logger.warn(
      `[security] ${at}: these suggestions name a permission set another package holds than the package that made ` +
        'the suggestion; nothing is rewritten — ' +
        report.differs.map((d) => `'${d.name}' (suggested by ${d.packageId}, held by ${d.permissionSetPackage})`).join(', ') + '.',
      { differs: report.differs },
    );
  }
}
