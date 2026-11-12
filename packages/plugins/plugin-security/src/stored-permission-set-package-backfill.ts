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
 * The package is the one holder of the name when the backfill runs, asked of
 * the one rule (`resolvePackageScopedHolders`, `@objectstack/core`) over the
 * engine registry's three holder reads — the source objectql's
 * `resolvePackageScopedName` hands the same rule, and the one the security
 * catalog reads permission sets through. ⛔ No second rule, no walk of its
 * own, no first-registered fallback. The caller is the one that wrote the
 * reference (ADR-0150 D3):
 *
 *  - a grant (R1) is the environment's own row, so it is asked as a caller
 *    with no package: the unique holder in the environment;
 *  - a suggestion (R3) is the reference of the package that made it
 *    (`package_id`), so it is asked from THAT package, as
 *    `position.permissionSets` is from its declaring package (D7): its own
 *    set first, then the unique holder in its declared closure. A set only an
 *    unrelated package holds is refused (`outside-closure`), never bound to it
 *    (epic review 6735731423). A row with no `package_id` is asked with no
 *    package.
 *
 * Its answer:
 *
 *  - resolved to a package → the row takes that package;
 *  - resolved to the environment's own set, or the platform's → stays null,
 *    which is its spelling;
 *  - refused (two holders, or none in the caller's reach) → left null, and
 *    every candidate named;
 *  - not-found → no package holds the name: left null, and named.
 *
 * Phase 1's one-holder refusal keeps a permission-set name to one package
 * holder per environment, so a two-holder refusal is what a pre-phase-1 clash
 * left behind. A suggesting package's own set answers at D3's step 1 even
 * beside such a clash: that is D3's answer for the package, not a pick.
 *
 * ## Who reads the column, and who writes it
 *
 * The readers read it (ADR-0150 D8): a row naming a package reads that
 * package's set and no other, and a row naming none resolves by the rule above
 * — so a name the rule refuses confers nothing at read and is never picked
 * (`storedPermissionSetScope`, `@objectstack/core`). Every write after the
 * holders are sealed is stamped by the same rule
 * (`stored-permission-set-package-stamp.ts`); a write before then is bound by
 * this backfill at `kernel:bootstrapped`. A row left null as ambiguous is the
 * operator's to bind ({@link bindCommandFor}). No unique key changes.
 *
 * ## Re-runnable
 *
 * It reads only rows whose `permission_set_package` is null and writes only
 * that column, so a second run binds nothing and reports the same ambiguous
 * and unheld names. A row that names a package is never read as a candidate,
 * so a run can only add a package, never move one.
 *
 * For a suggestion row it also reports a row whose `permission_set_package`
 * differs from its `package_id`: with the suggesting package as the caller,
 * that is a set one of its declared dependencies holds. Every row reads equal
 * today; one that does not is reported, never rewritten.
 *
 * A bind the database or the write seam refuses as a unique violation — the
 * row would be a second row of one key, a grant beside another of the same
 * user, set and organization that already names the holder (#32164) — is
 * reported by id (`duplicated`, at `warn`) and the row is left naming no
 * package; the walk goes on, so one such row never stops every later row
 * from being bound. Any other failed write still ends the run.
 */

import {
  describePackageScopedHolder,
  resolvePackageScopedHolders,
  type PackageScopedRefusalReason,
  type PackageScopedResolution,
} from '@objectstack/core';
import { packageResolutionClosure, type PackageClosureRegistry } from '@objectstack/metadata-core';
import { isUniqueViolationError, keysetWalk } from '@objectstack/types';

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
  /**
   * The column naming the package that wrote the reference, which the rule is
   * asked from (ADR-0150 D3); absent when the row is the environment's own.
   */
  readonly callerColumn?: string;
}

/** The column every reference below gains (ADR-0150 D8). */
export const PERMISSION_SET_PACKAGE_COLUMN = 'permission_set_package';

/** The two stored references to a permission set this plugin owns (ADR-0150 D8 rows R1, R3). */
export const STORED_PERMISSION_SET_REFERENCES: readonly StoredPermissionSetReference[] = Object.freeze([
  { row: 'R1', object: 'sys_user_permission_set', nameColumn: 'permission_set', packageColumn: PERMISSION_SET_PACKAGE_COLUMN },
  {
    row: 'R3',
    object: 'sys_audience_binding_suggestion',
    nameColumn: 'permission_set_name',
    packageColumn: PERMISSION_SET_PACKAGE_COLUMN,
    callerColumn: 'package_id',
  },
]);

/** The suggestion table, whose `package_id` the backfilled column is compared with. */
const SUGGESTION_OBJECT = 'sys_audience_binding_suggestion';

/**
 * [ADR-0150 D10] The operator's fix for a stored reference the rule refuses:
 * the reviewed one-row bind of `os migrate stored-references`, named in every
 * refusal a reader of the column reports. `PACKAGE` is one of the candidates
 * the refusal names.
 */
export function bindCommandFor(object: string, id?: unknown): string {
  const row = typeof id === 'string' || typeof id === 'number' ? String(id) : 'ID';
  return `os migrate stored-references bind --table ${object} --id ${row} --package PACKAGE`;
}

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
  | { readonly kind: 'ambiguous'; readonly reason: PackageScopedRefusalReason; readonly candidates: readonly string[] };

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
      return { kind: 'ambiguous', reason: resolution.reason, candidates: resolution.candidates.map(describePackageScopedHolder) };
    default:
      return { kind: 'unheld' };
  }
}

/** Who holds `name` for `callerPackageId` (`null`: a caller with no package). */
export type PermissionSetHolderOf = (name: string, callerPackageId: string | null) => StoredReferenceHolder;

/**
 * The holder of a permission-set name for the caller that wrote the
 * reference: the one rule over the registry's holder reads (module doc).
 */
export function permissionSetHolderOf(registry: PermissionSetHolderRegistry): PermissionSetHolderOf {
  return (name, callerPackageId) =>
    storedReferenceHolderOf(
      resolvePackageScopedHolders(
        { type: 'permission', name, callerPackageId },
        {
          packageHolders: registry.packageScopedHoldersOf('permission', name, callerPackageId),
          packageItem: (packageId) => registry.getPackageScopedItem('permission', name, packageId),
          environmentItem: () => registry.getEnvironmentScopedItem('permission', name),
        },
        (callerPackageId) => packageResolutionClosure(registry, callerPackageId),
      ),
    );
}

/** A name, the package that wrote it (R3; `null` for a row with none, absent for R1), and how many rows carry it. */
export interface ReferencedName {
  readonly name: string;
  readonly callerPackageId?: string | null;
  readonly rows: number;
}

/** What one run did for one reference, or would do in a dry run. */
export interface StoredReferenceBackfillReport {
  readonly row: StoredPermissionSetReference['row'];
  readonly object: string;
  /** Names whose rows now carry the one package holder (written, or to be written in a dry run). */
  readonly bound: ReadonlyArray<ReferencedName & { readonly packageId: string }>;
  /** Names the rule refused (two holders, or none in the caller's reach): left null, every candidate named. */
  readonly ambiguous: ReadonlyArray<ReferencedName & { readonly reason: PackageScopedRefusalReason; readonly candidates: readonly string[] }>;
  /** Names no package holds: left null. */
  readonly unheld: readonly ReferencedName[];
  /** Names the environment's own item, or the platform's, answers: left null, its spelling. */
  readonly unpackaged: ReadonlyArray<ReferencedName & { readonly holder: 'environment' | 'platform' }>;
  /** Suggestion rows whose `permission_set_package` is not their `package_id` (R3 only); never rewritten. */
  readonly differs: ReadonlyArray<{ readonly id: string; readonly name: string; readonly packageId: string; readonly permissionSetPackage: string }>;
  /**
   * [#32164] Rows the bind would make a second row of one key (a grant of the
   * same user, set and organization already names the holder): the write was
   * refused as a unique violation, the row is left naming no package, and the
   * walk goes on. Each is named by id, so an operator can review the pair.
   */
  readonly duplicated: ReadonlyArray<{ readonly id: string; readonly name: string; readonly packageId: string; readonly callerPackageId?: string | null }>;
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

const tally = <T extends ReferencedName>(into: Map<string, T>, key: string, make: () => T): void => {
  const at = into.get(key);
  into.set(key, { ...(at ?? make()), rows: (at?.rows ?? 0) + 1 });
};

/** One answer per (caller, name). */
const keyOf = (callerPackageId: string | null, name: string): string => JSON.stringify([callerPackageId, name]);

/** The package a row's reference was written by (`null`: none), read from `callerColumn`. */
const callerOf = (row: Row, callerColumn: string | undefined): string | null => {
  if (!callerColumn) return null;
  const v = row[callerColumn];
  return typeof v === 'string' && v !== '' ? v : null;
};

/**
 * Bind every row of `reference` whose package column is null to the one
 * package that holds its name (module doc). Reads by keyset page; writes only
 * the package column, one row at a time, by id.
 */
export async function backfillStoredPermissionSetPackages(
  engine: StoredReferenceBackfillEngine,
  reference: StoredPermissionSetReference,
  holderOf: PermissionSetHolderOf,
  options?: StoredReferenceBackfillOptions,
): Promise<StoredReferenceBackfillReport> {
  const bound = new Map<string, ReferencedName & { packageId: string }>();
  const ambiguous = new Map<string, ReferencedName & { reason: PackageScopedRefusalReason; candidates: readonly string[] }>();
  const unheld = new Map<string, ReferencedName>();
  const unpackaged = new Map<string, ReferencedName & { holder: 'environment' | 'platform' }>();
  const duplicated: Array<{ id: string; name: string; packageId: string; callerPackageId?: string | null }> = [];
  const answers = new Map<string, StoredReferenceHolder>();
  const { object, nameColumn, packageColumn, callerColumn } = reference;
  const fields = ['id', nameColumn, packageColumn, ...(callerColumn ? [callerColumn] : [])];
  /** Who wrote the reference, as the report names it: absent for an environment row (R1). */
  const writer = (caller: string | null) => (callerColumn ? { callerPackageId: caller } : {});

  const walk = keysetWalk<Row>(
    async (query) => {
      const page = await engine.find(object, { ...query, fields, context: SYSTEM_CTX });
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
      const caller = callerOf(row, callerColumn);
      const key = keyOf(caller, name);
      let holder = answers.get(key);
      if (!holder) {
        holder = holderOf(name, caller);
        answers.set(key, holder);
      }
      switch (holder.kind) {
        case 'package': {
          const packageId = holder.packageId;
          if (!options?.dryRun) {
            try {
              await engine.update(object, { id, [packageColumn]: packageId }, { context: SYSTEM_CTX });
            } catch (e: unknown) {
              // [#32164] One row whose bind is a unique violation is reported
              // and left as it stands; the walk goes on, so every other row is
              // still bound (`duplicated`).
              if (!isUniqueViolationError(e)) throw e;
              duplicated.push({ id: String(id), name, packageId, ...writer(caller) });
              break;
            }
          }
          tally(bound, key, () => ({ name, ...writer(caller), rows: 0, packageId }));
          break;
        }
        case 'ambiguous': {
          const { reason, candidates } = holder;
          tally(ambiguous, key, () => ({ name, ...writer(caller), rows: 0, reason, candidates }));
          break;
        }
        case 'unheld':
          tally(unheld, key, () => ({ name, ...writer(caller), rows: 0 }));
          break;
        default: {
          const kind = holder.kind;
          tally(unpackaged, key, () => ({ name, ...writer(caller), rows: 0, holder: kind }));
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
    duplicated,
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
      const packageId = row.package_id;
      const setPackage = typeof stored === 'string' && stored !== ''
        ? stored
        : options?.dryRun ? boundThisRun.get(keyOf(callerOf(row, reference.callerColumn), name))?.packageId : undefined;
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

/** ` as written by <package>` for a reference a package wrote (R3); nothing for an environment row. */
const askedBy = (n: ReferencedName): string => (typeof n.callerPackageId === 'string' ? ` as written by ${n.callerPackageId}` : '');

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
          'keep naming none, a reader resolves each by the one rule (one holder answers, two or more confer nothing), ' +
          'and the next boot tries again.',
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
        report.bound.map((b) => `'${b.name}'${askedBy(b)} → ${b.packageId} (${rowsOf(b.rows)})`).join(', ') + '.',
    );
  }
  if (report.ambiguous.length > 0) {
    logger.warn(
      `[security] ${at}: these permission-set names have no one holder for the package that wrote them (more than ` +
        'one holder, or none it depends on), so none is picked, each row is left naming no package, and a read of it ' +
        'confers nothing — ' +
        report.ambiguous.map((a) => `'${a.name}'${askedBy(a)} (${rowsOf(a.rows)}; ${a.reason}; held by ${a.candidates.join('; ')})`).join(', ') +
        `. List the rows with \`os migrate stored-references\`, review each, and bind one with \`${bindCommandFor(report.object)}\`.`,
      { ambiguous: report.ambiguous },
    );
  }
  if (report.unheld.length > 0) {
    logger.info(
      `[security] ${at}: no package holds these permission-set names, so their rows name no package — ` +
        report.unheld.map((u) => `'${u.name}'${askedBy(u)} (${rowsOf(u.rows)})`).join(', ') + '.',
      { unheld: report.unheld },
    );
  }
  if (report.differs.length > 0) {
    logger.warn(
      `[security] ${at}: these suggestions name a permission set a declared dependency of the suggesting package ` +
        'holds, not the suggesting package itself; nothing is rewritten — ' +
        report.differs.map((d) => `'${d.name}' (suggested by ${d.packageId}, held by ${d.permissionSetPackage})`).join(', ') + '.',
      { differs: report.differs },
    );
  }
  if (report.duplicated.length > 0) {
    logger.warn(
      `[security] ${at}: these rows were left naming no package, because binding each would make it a second row of one ` +
        'key: another row already names the same holder for the same reference (for a grant: the same user, permission ' +
        'set and organization). Review each pair and delete the row that should not stand — ' +
        report.duplicated.map((d) => `row ${d.id}: '${d.name}'${typeof d.callerPackageId === 'string' ? ` as written by ${d.callerPackageId}` : ''} → ${d.packageId}`).join(', ') + '.',
      { duplicated: report.duplicated },
    );
  }
}
