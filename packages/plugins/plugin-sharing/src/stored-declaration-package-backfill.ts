// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D8 rows R5, R6 and R13, D10] The stored references to a declared
 * sharing rule, queue or assignment rule gain the package that holds it,
 * beside its name — backfilled at boot.
 *
 * | Row | Table . name column | Gains | Rows asked |
 * |:--|:--|:--|:--|
 * | R5 | `sys_sharing_rule.name` | `package_id` | managed rows (`managed_by` package or platform); an organization's own rule (`admin`) is never asked |
 * | R6 | `sys_queue_member.queue` | `queue_package` | every row; position recipients stay bare (ADR-0150 D7) |
 * | R13 | `sys_assignment_cursor.rule` | `rule_package` | every row |
 *
 * Each is behavioural metadata (ADR-0150 D1 bucket 2), identified by
 * `(package, name)`, so each reference gains a second column: two facts, two
 * columns (ADR-0126 §4), ⛔ never a re-encoded literal.
 *
 * ## Where the answer comes from
 *
 * The package is the one holder of the name in this environment when the
 * backfill runs: objectql's {@link resolvePackageScopedName} (ADR-0150 D3,
 * the one rule every reader of the epic shares), asked as a caller with no
 * package, over the whole registry. ⛔ No second rule, no walk of its own, no
 * first-registered fallback:
 *
 *  - resolved to a package → the row takes that package;
 *  - resolved to the environment's own item, or the platform's → stays null,
 *    which is its spelling;
 *  - refused → the ambiguous set: left null, and every candidate named;
 *  - not-found → no package holds the name (an organization's own queue,
 *    or a name nothing declares any more): left null, and named.
 *
 * None of the three types has a phase-1 backstop, so two packages may each
 * declare one name today; such a name is the ambiguous set here, as it is a
 * refusal for the readers (`package-scoped-declarations.ts`).
 *
 * ## What it does not change
 *
 * No reader or writer moves onto the columns (ADR-0150 red line 3): the rule
 * set, the queue service and the assignment engine still read by name, and no
 * writer stamps the columns — a row written after a boot is bound by the next
 * one. The readers that will read them are the trailing children of these
 * types (their B children; S4's upgrade report). No unique key changes.
 *
 * ## Re-runnable
 *
 * It reads only rows whose package column is null and writes only that
 * column, so a second run binds nothing and reports the same ambiguous and
 * unheld names. A row that names a package is never read as a candidate, so a
 * run can only add a package, never move one.
 */

import { describePackageScopedHolder, resolvePackageScopedName, type PackageScopedRegistry } from '@objectstack/objectql';
import { keysetWalk } from '@objectstack/types';
import { isPackageScopedRegistry, type SharingDeclarationType } from './package-scoped-declarations.js';

/** One stored reference to a declared item (ADR-0150 D8). */
export interface StoredDeclarationReference {
  /** The ADR-0150 D8 row. */
  readonly row: 'R5' | 'R6' | 'R13';
  /** The declared type the name is of. */
  readonly type: SharingDeclarationType;
  /** The table. */
  readonly object: string;
  /** The column naming the item. */
  readonly nameColumn: string;
  /** The column this backfill fills. */
  readonly packageColumn: string;
  /** The rows asked, beyond "the package column is null" (R5: managed rows only). */
  readonly where?: Record<string, unknown>;
}

/** The three stored references this plugin owns (ADR-0150 D8 rows R5, R6, R13). */
export const STORED_DECLARATION_REFERENCES: readonly StoredDeclarationReference[] = Object.freeze([
  {
    row: 'R5',
    type: 'sharing_rule',
    object: 'sys_sharing_rule',
    nameColumn: 'name',
    packageColumn: 'package_id',
    where: { managed_by: { $in: ['package', 'platform'] } },
  },
  { row: 'R6', type: 'queue', object: 'sys_queue_member', nameColumn: 'queue', packageColumn: 'queue_package' },
  { row: 'R13', type: 'assignment_rule', object: 'sys_assignment_cursor', nameColumn: 'rule', packageColumn: 'rule_package' },
]);

/** Infrastructure rows, written and read the way the plugin's other boot passes do. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** Rows per page of the walk. */
const PAGE_SIZE = 500;

/** Who holds a referenced name, as the backfill reads the rule's answer. */
export type StoredDeclarationHolder =
  | { readonly kind: 'package'; readonly packageId: string }
  | { readonly kind: 'environment' }
  | { readonly kind: 'platform' }
  | { readonly kind: 'unheld' }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly string[] };

/** The holder of a declared name for a caller with no package: the one rule (module doc). */
export function declaredHolderOf(registry: PackageScopedRegistry): (type: SharingDeclarationType, name: string) => StoredDeclarationHolder {
  return (type, name) => {
    // [#32183] A binding never moves with a reversible disable: every holder.
    const answer = resolvePackageScopedName(registry, { type, name, callerPackageId: null, includeDisabledPackages: true });
    switch (answer.status) {
      case 'resolved':
        return answer.holder.kind === 'package' ? { kind: 'package', packageId: answer.holder.packageId } : { kind: answer.holder.kind };
      case 'refused':
        return { kind: 'ambiguous', candidates: answer.candidates.map(describePackageScopedHolder) };
      default:
        return { kind: 'unheld' };
    }
  };
}

/** A name and how many rows carry it. */
export interface ReferencedName {
  readonly name: string;
  readonly rows: number;
}

/** What one run did for one reference, or would do in a dry run. */
export interface StoredDeclarationBackfillReport {
  readonly row: StoredDeclarationReference['row'];
  readonly object: string;
  readonly packageColumn: string;
  /** Names whose rows now carry the one package holder (written, or to be written in a dry run). */
  readonly bound: ReadonlyArray<ReferencedName & { readonly packageId: string }>;
  /** Names two or more holders hold: left null, every candidate named. */
  readonly ambiguous: ReadonlyArray<ReferencedName & { readonly candidates: readonly string[] }>;
  /** Names no package holds: left null. */
  readonly unheld: readonly ReferencedName[];
  /** Names the environment's own item, or the platform's, answers: left null, its spelling. */
  readonly unpackaged: ReadonlyArray<ReferencedName & { readonly holder: 'environment' | 'platform' }>;
}

/** The engine slice the backfill reads and writes through. */
export interface StoredDeclarationBackfillEngine {
  find(object: string, options?: unknown): Promise<unknown>;
  update(object: string, data: unknown, options?: unknown): Promise<unknown>;
}

/** Options for {@link backfillStoredDeclarationPackages}. */
export interface StoredDeclarationBackfillOptions {
  /** Report what would be bound and write nothing. */
  readonly dryRun?: boolean;
}

type Row = Record<string, unknown>;

const tally = <T extends ReferencedName>(into: Map<string, T>, name: string, make: () => T): void => {
  const at = into.get(name);
  into.set(name, { ...(at ?? make()), rows: (at?.rows ?? 0) + 1 });
};

/**
 * Bind every asked row of `reference` whose package column is null to the one
 * package that holds its name (module doc). Reads by keyset page; writes only
 * the package column, one row at a time, by id.
 */
export async function backfillStoredDeclarationPackages(
  engine: StoredDeclarationBackfillEngine,
  reference: StoredDeclarationReference,
  holderOf: (type: SharingDeclarationType, name: string) => StoredDeclarationHolder,
  options?: StoredDeclarationBackfillOptions,
): Promise<StoredDeclarationBackfillReport> {
  const bound = new Map<string, ReferencedName & { packageId: string }>();
  const ambiguous = new Map<string, ReferencedName & { candidates: readonly string[] }>();
  const unheld = new Map<string, ReferencedName>();
  const unpackaged = new Map<string, ReferencedName & { holder: 'environment' | 'platform' }>();
  const answers = new Map<string, StoredDeclarationHolder>();
  const { object, nameColumn, packageColumn, type } = reference;
  const unbound = { [packageColumn]: null };

  const walk = keysetWalk<Row>(
    async (query) => {
      const page = await engine.find(object, { ...query, fields: ['id', nameColumn, packageColumn], context: SYSTEM_CTX });
      return Array.isArray(page) ? (page as Row[]) : [];
    },
    { where: reference.where ? { $and: [unbound, reference.where] } : unbound, pageSize: PAGE_SIZE },
  );
  for await (const page of walk.pages()) {
    for (const row of page) {
      // Only a row with no package is a candidate; the filter is the driver's,
      // and this re-check keeps a driver that reads it loosely from moving one.
      if (row[packageColumn] !== null && row[packageColumn] !== undefined) continue;
      const id = row.id;
      const name = row[nameColumn];
      if (id === null || id === undefined || typeof name !== 'string' || name === '') continue;
      let holder = answers.get(name);
      if (!holder) {
        holder = holderOf(type, name);
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
  return {
    row: reference.row,
    object,
    packageColumn,
    bound: [...bound.values()],
    ambiguous: [...ambiguous.values()],
    unheld: [...unheld.values()],
    unpackaged: [...unpackaged.values()],
  };
}

/** The registry slice the boot run reads, beyond the resolver's. */
type BootRegistry = { readonly bareNameHoldersAreSealed?: boolean; getObject?(name: string): unknown };

/** The logger slice the boot run writes to. */
export interface StoredDeclarationBackfillLogger {
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
export async function backfillStoredDeclarationPackagesAtBoot(
  engine: Partial<StoredDeclarationBackfillEngine> | undefined,
  registry: unknown,
  logger: StoredDeclarationBackfillLogger,
): Promise<StoredDeclarationBackfillReport[] | undefined> {
  if (!engine || typeof engine.find !== 'function' || typeof engine.update !== 'function') return undefined;
  if (!isPackageScopedRegistry(registry)) return undefined;
  const boot = registry as unknown as BootRegistry;
  if (boot.bareNameHoldersAreSealed !== true) return undefined;
  const holderOf = declaredHolderOf(registry);
  const reports: StoredDeclarationBackfillReport[] = [];
  for (const reference of STORED_DECLARATION_REFERENCES) {
    let carried = false;
    try {
      carried = Boolean(boot.getObject?.(reference.object));
    } catch {
      carried = false; // a registry that cannot answer is not an answer
    }
    if (!carried) continue;
    let report: StoredDeclarationBackfillReport;
    try {
      report = await backfillStoredDeclarationPackages(engine as StoredDeclarationBackfillEngine, reference, holderOf);
    } catch (e: unknown) {
      logger.warn(
        `[sharing] the ${reference.object}.${reference.packageColumn} backfill did not finish: rows that name no package ` +
          'keep naming none, every reader still reads the name as before, and the next boot tries again.',
        { error: e instanceof Error ? e.message : String(e) },
      );
      continue;
    }
    reports.push(report);
    logStoredDeclarationBackfill(report, logger);
  }
  return reports;
}

/** What a run says (module doc): bound and unheld at `info`, the ambiguous set at `warn`. */
export function logStoredDeclarationBackfill(report: StoredDeclarationBackfillReport, logger: StoredDeclarationBackfillLogger): void {
  const at = `${report.object}.${report.packageColumn}`;
  if (report.bound.length > 0) {
    logger.info(
      `[sharing] ${at}: rows now name the package that holds the item they name (ADR-0150 D8) — ` +
        report.bound.map((b) => `'${b.name}' → ${b.packageId} (${rowsOf(b.rows)})`).join(', ') + '.',
    );
  }
  if (report.ambiguous.length > 0) {
    logger.warn(
      `[sharing] ${at}: more than one holder holds these names, so none is picked and each row is left naming no ` +
        'package. Every reader still reads the name as before — ' +
        report.ambiguous.map((a) => `'${a.name}' (${rowsOf(a.rows)}; held by ${a.candidates.join('; ')})`).join(', ') + '.',
      { ambiguous: report.ambiguous },
    );
  }
  if (report.unheld.length > 0) {
    logger.info(
      `[sharing] ${at}: no package holds these names, so their rows name no package — ` +
        report.unheld.map((u) => `'${u.name}' (${rowsOf(u.rows)})`).join(', ') + '.',
      { unheld: report.unheld },
    );
  }
}
