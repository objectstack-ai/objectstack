// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D10, child S4] The upgrade report of the stored references the
 * package-column backfills (D8, children S2 and S3) left naming no package
 * because the one rule refused them, and the reviewed bind that writes one
 * operator-chosen package into one such row.
 *
 * ## What it reads
 *
 * Each row of {@link STORED_PACKAGE_REFERENCES} is one D8 reference: a table,
 * the column naming the item, the package column the boot backfill fills, the
 * rows the backfill asks, and (R3 only) the column naming the package that
 * wrote the reference. A row whose package column is still null is asked the
 * one ADR-0150 D3 rule — objectql's {@link resolvePackageScopedName}, the
 * exact question its backfill asked, from the same caller — and is reported
 * only when the rule REFUSES it:
 *
 *  - `ambiguous`: two or more holders the caller can reach
 *    (`ambiguous-in-environment` / `ambiguous-in-closure`);
 *  - `environment-only`: a package caller's name only an environment-authored
 *    item holds (D3 (a); R3 and the picklist references only);
 *  - `outside-closure`: a package caller's name only packages outside its
 *    declared dependency closure hold (D3 (c); likewise).
 *
 * A resolved row is not a finding: the next boot's backfill binds a package
 * holder, and an environment or platform holder's null is its spelling. A name
 * nothing holds is not one either: there is nothing to choose between.
 *
 * Beside the stored rows it lists the packaged fields whose picklist the rule
 * refuses (D8 R17, the one reference inside an item body that has a reader
 * today: `SchemaRegistry.findOutsideClosurePicklistReferences`) and the names
 * the boot's holder seal found held twice (`sealBareNameHolders`, D10's
 * "sealed clash"). Neither is bindable: a body or a declaration is the
 * author's to fix.
 *
 * It also names each installed package whose namespace spells a literal
 * segment of the address grammar (`trigger`, `hooks`, `global`, … — ADR-0150
 * D5, child G1), judged by the install door's own
 * `validateNamespaceNotAddressLiteral`. The boot keeps such a package with one
 * warning, so this is where an operator sees it: its items are read with
 * `?package=ID`, and only a rename of its namespace gives them qualified
 * addresses. Not bindable either: a namespace is the author's to change.
 *
 * It lists, last, each customization pair's member row of a bundled type
 * whose readers consult `(package, name)` (an email template's locale) that
 * two or more holders of the name could own: two packages of one App share
 * the App's pair, and a row Studio added there declares no `overrides` naming
 * the base it customizes. Each such holder's exact read refuses the row,
 * naming every one (`pairMemberOwners`, `@objectstack/metadata-protocol`; the
 * epic ruling on #31699 F2). Not bindable by `bind`: the row's package column
 * already names the pair. A row declaring its base (`overrides.package`) is
 * served by that base only, but the save gate refuses that declaration on a
 * member the base does not ship (`declared_package_ships_no_such_item`,
 * #28777), so no door binds an added member to one base today: the row stays
 * refused, and listed here, until it is deleted.
 *
 * Beside them it lists each package-less `sys_metadata` row of such a type
 * (any type whose readers consult `(package, name)`, not only a bundled one)
 * whose name two or more packages hold: the row is the customization of one
 * holder and cannot say which (ADR-0150 D4), so each holder's exact read
 * refuses it and the list scoped to a holder leaves it out
 * (`packageLessRowOwners`, `@objectstack/metadata-protocol`; epic ruling
 * 6761802819 on #31699). Where one holder ships the item, the fix is saving
 * the customization into that holder's pair declaring it and deleting the
 * row; otherwise no door binds it to one package today.
 *
 * ## A database this release has not booted yet
 *
 * The release that carries D8 adds each package column at its first boot and
 * then runs the backfill. Before that boot, a database written by an earlier
 * release has the D8 tables without their package columns, and the report's
 * boot is read-only, so it adds none. Such a table is read as nothing bound
 * yet: every row names no package, exactly the state the backfill starts from,
 * so each row is asked the one rule and reported only when the rule refuses
 * it. The findings are therefore the rows the first boot's backfill will
 * leave null. Only a package column the caller MEASURED missing
 * (`packageColumnAbsent`: the held-back sync's `add_columns`, a fact about the
 * database) is read this way. ⛔ No refused read is ever recognised as this
 * state: any other missing column, and any other driver error, is still
 * thrown and reported.
 *
 * ## What it never does
 *
 * - **Resolution never loosens.** No first-registered fallback, no guess: every
 *   answer is the rule's, and every refusal names every candidate.
 * - **The report writes nothing.**
 * - **The bind never picks.** It writes exactly the package the operator
 *   names, into exactly one row, and only when the rule — asked again at write
 *   time — still refuses that row as ambiguous and still names that package
 *   among its candidates. A stale report binds nothing; a bound row is never
 *   moved; a second run writes 0 rows. There is no bind-all.
 *
 * ADR anchors: ADR-0150 D3, D8, D10.
 */

import type { PackageScopedHolder, PackageScopedResolution } from '@objectstack/core';
import { PACKAGE_SCOPED_READ_TYPES, resolvePackageScopedName, type PackageScopedRegistry } from '@objectstack/objectql';
import { keysetWalk } from '@objectstack/types';
import { isCustomizationPackage, validateNamespaceNotAddressLiteral } from '@objectstack/spec/kernel';
import { ITEM_KEY_DISCRIMINATORS, installedManifestsOf } from '@objectstack/metadata-core';
import { packageLessRowOwners, pairMemberOwners } from '@objectstack/metadata-protocol';

/** The D3 types a stored reference names. */
type ReferencedType = 'permission' | 'sharing_rule' | 'queue' | 'assignment_rule' | 'flow' | 'connector' | 'email_template';

/** One stored reference to a package-scoped item (ADR-0150 D8). */
export interface StoredPackageReference {
  /** The ADR-0150 D8 row. */
  readonly d8: 'R1' | 'R3' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'R11' | 'R13' | 'R20';
  /** The type the name is of. */
  readonly type: ReferencedType;
  /** The table. */
  readonly table: string;
  /** The column naming the item. */
  readonly nameColumn: string;
  /** The column the boot backfill fills; R10 has none (its key is the reference). */
  readonly packageColumn?: string;
  /** The rows the backfill asks, beyond "the package column is null". */
  readonly where?: Record<string, unknown>;
  /** The column naming the package that wrote the reference (R3); absent: a caller with no package. */
  readonly callerColumn?: string;
}

/**
 * The stored references S2 and S3 backfilled, in D8 order, each with the rows
 * and the caller its backfill uses (`stored-permission-set-package-backfill.ts`,
 * `stored-declaration-package-backfill.ts`, `stored-process-package-backfill.ts`,
 * `stored-reference-package-backfill.ts`, `flow-dispatch-key-package-backfill.ts`,
 * `stored-template-package-backfill.ts`).
 */
export const STORED_PACKAGE_REFERENCES: readonly StoredPackageReference[] = Object.freeze([
  { d8: 'R1', type: 'permission', table: 'sys_user_permission_set', nameColumn: 'permission_set', packageColumn: 'permission_set_package' },
  {
    d8: 'R3', type: 'permission', table: 'sys_audience_binding_suggestion', nameColumn: 'permission_set_name',
    packageColumn: 'permission_set_package', callerColumn: 'package_id',
  },
  {
    d8: 'R5', type: 'sharing_rule', table: 'sys_sharing_rule', nameColumn: 'name', packageColumn: 'package_id',
    where: { managed_by: { $in: ['package', 'platform'] } },
  },
  { d8: 'R6', type: 'queue', table: 'sys_queue_member', nameColumn: 'queue', packageColumn: 'queue_package' },
  {
    d8: 'R7', type: 'flow', table: 'sys_approval_request', nameColumn: 'process_name', packageColumn: 'process_package',
    where: { status: { $in: ['pending', 'returned'] } },
  },
  { d8: 'R8', type: 'flow', table: 'sys_automation_run', nameColumn: 'flow_name', packageColumn: 'flow_package', where: { status: 'paused' } },
  { d8: 'R9', type: 'flow', table: 'sys_flow_credential', nameColumn: 'flow_name', packageColumn: 'flow_package' },
  { d8: 'R10', type: 'flow', table: 'sys_flow_dispatch', nameColumn: 'id' },
  { d8: 'R11', type: 'connector', table: 'sys_connector_connection', nameColumn: 'connector_name', packageColumn: 'connector_package' },
  { d8: 'R13', type: 'assignment_rule', table: 'sys_assignment_cursor', nameColumn: 'rule', packageColumn: 'rule_package' },
  { d8: 'R20', type: 'email_template', table: 'sys_email_template', nameColumn: 'name', packageColumn: 'package_id' },
]);

/** Why the rule refused a reference (module doc). */
export type StoredReferenceRefusal = 'ambiguous' | 'environment-only' | 'outside-closure';

/** A candidate the rule named, spelled by its address (ADR-0150 D5). */
export type ReferenceCandidate =
  | { readonly holder: 'package'; readonly packageId: string; readonly address: string }
  | { readonly holder: 'environment'; readonly address: string }
  | { readonly holder: 'platform' }
  /** [#32412] A stack's residual (ADR-0130 D4); the registry's rule never names one, the job binder's refusal does. */
  | { readonly holder: 'residual'; readonly ownerId: string };

/** One stored row the rule refused. */
export interface StoredReferenceFinding {
  readonly d8: StoredPackageReference['d8'];
  readonly table: string;
  readonly id: string;
  readonly column: string;
  /** The column a bind writes; absent for R10 (report only). */
  readonly packageColumn?: string;
  readonly name: string;
  /** The package the rule was asked from (R3); absent: a caller with no package. */
  readonly callerPackageId?: string;
  readonly reason: StoredReferenceRefusal;
  readonly candidates: readonly ReferenceCandidate[];
}

/** One packaged field whose picklist the rule refuses (D8 R17). */
export interface PicklistReferenceFinding {
  readonly d8: 'R17';
  readonly object: string;
  readonly field: string;
  readonly packageId: string;
  readonly name: string;
  readonly reason: StoredReferenceRefusal;
  readonly candidates: readonly ReferenceCandidate[];
}

/** One name the boot's holder seal found held twice (ADR-0150 D10). */
export interface SealedClashFinding {
  readonly type: string;
  readonly name: string;
  readonly candidates: readonly string[];
}

/** One installed package whose namespace spells an address literal (ADR-0150 D5, child G1). */
export interface LiteralNamespaceFinding {
  readonly packageId: string;
  readonly namespace: string;
  /** The install door's sentence (`validateNamespaceNotAddressLiteral`), verbatim. */
  readonly message: string;
}

/** One pair member row two or more holders of the name could own (module doc; epic ruling on #31699 F2). */
export interface PairMemberFinding {
  readonly table: 'sys_metadata';
  readonly id: string;
  readonly type: string;
  readonly name: string;
  /** The bundle member the row stores (an email template's locale). */
  readonly member: string | null;
  /** The customization package the row is bound to. */
  readonly pairId: string;
  /** Every holder the row could be the added member of. */
  readonly candidates: readonly ReferenceCandidate[];
}

/** One package-less row two or more holders of the name could own (module doc; epic ruling 6761802819 on #31699). */
export interface PackageLessRowFinding {
  readonly table: 'sys_metadata';
  readonly id: string;
  readonly type: string;
  readonly name: string;
  /** The bundle member the row stores (an email template's locale), else `null`. */
  readonly member: string | null;
  /** Every holder the row could be the customization of. */
  readonly candidates: readonly ReferenceCandidate[];
}

/** The report (module doc). */
export interface StoredPackageReferenceReport {
  readonly stored: readonly StoredReferenceFinding[];
  readonly picklists: readonly PicklistReferenceFinding[];
  readonly sealedClashes: readonly SealedClashFinding[];
  readonly literalNamespaces: readonly LiteralNamespaceFinding[];
  readonly pairMembers: readonly PairMemberFinding[];
  readonly packageLessRows: readonly PackageLessRowFinding[];
  /** D8 tables this composition does not carry, so not read. */
  readonly tablesNotCarried: readonly string[];
  /** D8 tables the boot measured absent from the database: nothing stored, read as no rows. */
  readonly tablesAbsent: readonly string[];
}

/** The engine slice the report and the bind read and write through. */
export interface StoredReferenceEngine {
  find(object: string, options?: unknown): Promise<unknown>;
  update(object: string, data: unknown, options?: unknown): Promise<unknown>;
}

/** The registry slice: the resolver's reads, the table check, and the readers the report lists. */
export type StoredReferenceRegistry = PackageScopedRegistry & {
  getObject?(name: string): unknown;
  readsByPackage?(type: string): boolean;
  getAllPackages?(): ReadonlyArray<{ manifest?: { id?: unknown; namespace?: unknown } }>;
  findOutsideClosurePicklistReferences?(): ReadonlyArray<{ object: string; field: string; picklist: string; packageId?: string }>;
  picklistReferenceVerdict?(name: string, callerPackageId?: string | null): PackageScopedResolution;
  sealBareNameHolders?(): ReadonlyArray<{
    type: string;
    name: string;
    incomingPackageId: string;
    existingHolder: { kind: string; packageId?: string };
  }>;
};

/** Infrastructure rows, read and written the way the backfills do. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** Rows per page of the walk. */
const PAGE_SIZE = 500;

/** R7 names its flow `flow:NAME`. */
const FLOW_PREFIX = 'flow:';

/** R10's two key prefixes (`flow-dispatch-key-package-backfill.ts`): a bare key is `PREFIX:FLOW:REST`, REST date-led. */
const BARE_DISPATCH_KEY = /^(?:schedule|time-relative):([a-z_][a-z0-9_]*):[0-9+-]/s;

type Row = Record<string, unknown>;

/** The item name a stored value names, or undefined when it names none (module doc). */
function referencedName(reference: StoredPackageReference, value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  if (reference.d8 === 'R7') {
    const name = value.startsWith(FLOW_PREFIX) ? value.slice(FLOW_PREFIX.length) : '';
    return name === '' ? undefined : name;
  }
  if (reference.d8 === 'R10') return BARE_DISPATCH_KEY.exec(value)?.[1];
  return value;
}

/** The caller a row's reference is asked from (R3: the package that wrote it). */
function callerOf(reference: StoredPackageReference, row: Row): string | null {
  if (!reference.callerColumn) return null;
  const value = row[reference.callerColumn];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Does the row still sit in the set its backfill asks (module doc)? */
function isAsked(reference: StoredPackageReference, row: Row): boolean {
  if (reference.d8 === 'R5') return row.managed_by === 'package' || row.managed_by === 'platform';
  if (reference.d8 === 'R7') return row.status === 'pending' || row.status === 'returned';
  if (reference.d8 === 'R8') return row.status === 'paused';
  return true;
}

/** The columns a row read needs; without the package column on a table that does not have it yet (module doc). */
function fieldsOf(reference: StoredPackageReference, packageColumnPresent = true): string[] {
  const fields = new Set(['id', reference.nameColumn]);
  if (reference.packageColumn && packageColumnPresent) fields.add(reference.packageColumn);
  if (reference.callerColumn) fields.add(reference.callerColumn);
  if (reference.d8 === 'R5') fields.add('managed_by');
  if (reference.d8 === 'R7' || reference.d8 === 'R8') fields.add('status');
  return [...fields];
}

/** Ask the one rule, as the reference's backfill asks it. */
function ask(registry: StoredReferenceRegistry, type: ReferencedType, name: string, callerPackageId: string | null): PackageScopedResolution {
  return resolvePackageScopedName(registry, { type, name, callerPackageId });
}

/** The report's reading of a refusal (module doc). */
export function refusalOf(answer: PackageScopedResolution): StoredReferenceRefusal | undefined {
  if (answer.status !== 'refused') return undefined;
  if (answer.reason !== 'outside-closure') return 'ambiguous';
  return answer.candidates.every((c) => c.kind === 'environment') ? 'environment-only' : 'outside-closure';
}

/** A candidate, spelled by its address: `NAMESPACE/NAME`, `_env/NAME` for the environment (ADR-0150 D5). */
function candidateOf(registry: StoredReferenceRegistry, holder: PackageScopedHolder, name: string): ReferenceCandidate {
  if (holder.kind === 'environment') return { holder: 'environment', address: `_env/${name}` };
  if (holder.kind === 'platform') return { holder: 'platform' };
  if (holder.kind === 'residual') return { holder: 'residual', ownerId: holder.ownerId };
  const pkg = registry.getPackage(holder.packageId) as { manifest?: { namespace?: unknown } } | undefined;
  const namespace = typeof pkg?.manifest?.namespace === 'string' && pkg.manifest.namespace !== '' ? pkg.manifest.namespace : undefined;
  return { holder: 'package', packageId: holder.packageId, address: namespace ? `${namespace}/${name}` : `${holder.packageId}:${name}` };
}

function candidatesOf(registry: StoredReferenceRegistry, answer: PackageScopedResolution, name: string): ReferenceCandidate[] {
  return answer.status === 'refused' ? answer.candidates.map((c) => candidateOf(registry, c, name)) : [];
}

/** Does this composition carry `table`? A registry that cannot answer has not answered yes. */
function carries(registry: StoredReferenceRegistry, table: string): boolean {
  try {
    return Boolean(registry.getObject?.(table));
  } catch {
    return false;
  }
}

/**
 * The stored rows of one reference the rule refuses (module doc). Reads only; ordered by id.
 * `packageColumnPresent: false` (measured by the caller) reads every row as naming no package.
 */
async function refusedRowsOf(
  engine: StoredReferenceEngine,
  registry: StoredReferenceRegistry,
  reference: StoredPackageReference,
  packageColumnPresent: boolean,
): Promise<StoredReferenceFinding[]> {
  const findings: StoredReferenceFinding[] = [];
  const answers = new Map<string, PackageScopedResolution>();
  const unbound = reference.packageColumn && packageColumnPresent ? { [reference.packageColumn]: null } : undefined;
  const where = unbound && reference.where ? { $and: [unbound, reference.where] } : (unbound ?? reference.where ?? {});
  const fields = fieldsOf(reference, packageColumnPresent);
  const walk = keysetWalk<Row>(
    async (query) => {
      const page = await engine.find(reference.table, { ...query, fields, context: SYSTEM_CTX });
      return Array.isArray(page) ? (page as Row[]) : [];
    },
    { where, pageSize: PAGE_SIZE },
  );
  for await (const page of walk.pages()) {
    for (const row of page) {
      // The filter is the driver's; this re-check keeps a driver that reads it loosely honest.
      if (reference.packageColumn && row[reference.packageColumn] !== null && row[reference.packageColumn] !== undefined) continue;
      if (!isAsked(reference, row)) continue;
      const id = row.id;
      const name = referencedName(reference, row[reference.nameColumn]);
      if (id === null || id === undefined || name === undefined) continue;
      const caller = callerOf(reference, row);
      const key = JSON.stringify([caller, name]);
      let answer = answers.get(key);
      if (!answer) {
        answer = ask(registry, reference.type, name, caller);
        answers.set(key, answer);
      }
      const reason = refusalOf(answer);
      if (!reason) continue;
      findings.push({
        d8: reference.d8,
        table: reference.table,
        id: String(id),
        column: reference.nameColumn,
        ...(reference.packageColumn ? { packageColumn: reference.packageColumn } : {}),
        name,
        ...(caller !== null ? { callerPackageId: caller } : {}),
        reason,
        candidates: candidatesOf(registry, answer, name),
      });
    }
  }
  return findings;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The stored body of a `sys_metadata` row, or `undefined` when it is not a JSON object. */
function storedBody(value: unknown): unknown {
  if (value !== null && typeof value === 'object') return value;
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** The pair member rows two or more holders of the name could own (module doc). Reads only; ordered by id. */
async function ambiguousPairMemberRows(engine: StoredReferenceEngine, registry: StoredReferenceRegistry): Promise<PairMemberFinding[]> {
  const types = Object.keys(ITEM_KEY_DISCRIMINATORS).filter((type) => registry.readsByPackage?.(type) === true);
  if (types.length === 0) return [];
  const installed = installedManifestsOf(registry as never);
  const findings: PairMemberFinding[] = [];
  const walk = keysetWalk<Row>(
    async (query) => {
      const page = await engine.find('sys_metadata', {
        ...query, fields: ['id', 'type', 'name', 'package_id', 'bundle_member', 'metadata', 'state'], context: SYSTEM_CTX,
      });
      return Array.isArray(page) ? (page as Row[]) : [];
    },
    { where: { type: { $in: types }, state: 'active' }, pageSize: PAGE_SIZE },
  );
  for await (const page of walk.pages()) {
    for (const row of page) {
      const { id, type, name } = row;
      const pairId = row.package_id;
      if (id === null || id === undefined || typeof type !== 'string' || !types.includes(type) || typeof name !== 'string') continue;
      if (row.state !== 'active' || typeof pairId !== 'string' || !isCustomizationPackage(pairId)) continue;
      const owners = pairMemberOwners(pairId, registry.packageScopedHoldersOf(type, name) ?? [], installed, storedBody(row.metadata));
      if (owners.length < 2) continue;
      findings.push({
        table: 'sys_metadata', id: String(id), type, name,
        member: typeof row.bundle_member === 'string' && row.bundle_member !== '' ? row.bundle_member : null,
        pairId,
        candidates: owners.map((packageId) => candidateOf(registry, { kind: 'package', packageId }, name)),
      });
    }
  }
  return findings.sort((a, b) => byText(a.id, b.id));
}

/** The package-less rows two or more holders of the name could own (module doc). Reads only; ordered by id. */
async function ambiguousPackageLessRows(engine: StoredReferenceEngine, registry: StoredReferenceRegistry): Promise<PackageLessRowFinding[]> {
  const types: string[] = PACKAGE_SCOPED_READ_TYPES.filter((type) => registry.readsByPackage?.(type) === true);
  if (types.length === 0) return [];
  const findings: PackageLessRowFinding[] = [];
  const walk = keysetWalk<Row>(
    async (query) => {
      const page = await engine.find('sys_metadata', {
        ...query, fields: ['id', 'type', 'name', 'package_id', 'bundle_member', 'state'], context: SYSTEM_CTX,
      });
      return Array.isArray(page) ? (page as Row[]) : [];
    },
    { where: { type: { $in: types }, state: 'active' }, pageSize: PAGE_SIZE },
  );
  for await (const page of walk.pages()) {
    for (const row of page) {
      const { id, type, name } = row;
      if (id === null || id === undefined || typeof type !== 'string' || !types.includes(type) || typeof name !== 'string') continue;
      if (row.state !== 'active' || (row.package_id !== null && row.package_id !== undefined && row.package_id !== '')) continue;
      const owners = packageLessRowOwners(registry as never, type, name);
      if (owners.length < 2) continue;
      findings.push({
        table: 'sys_metadata', id: String(id), type, name,
        member: typeof row.bundle_member === 'string' && row.bundle_member !== '' ? row.bundle_member : null,
        candidates: owners.map((packageId) => candidateOf(registry, { kind: 'package', packageId }, name)),
      });
    }
  }
  return findings.sort((a, b) => byText(a.id, b.id));
}

/**
 * The upgrade report (module doc): every refused stored row, every refused
 * picklist reference and every sealed clash, in a stable order, so two runs
 * over one database print the same bytes. Writes nothing.
 */
export async function collectStoredPackageReferences(
  engine: StoredReferenceEngine,
  registry: StoredReferenceRegistry,
  options?: {
    /** Did the boot measure `table` absent from the database? */
    readonly absent?: (table: string) => boolean;
    /**
     * Did the boot measure `column` missing from the present `table` (module
     * doc: a database this release has not booted yet)? Asked only of a D8
     * package column; absent, every package column is read.
     */
    readonly packageColumnAbsent?: (table: string, column: string) => boolean;
  },
): Promise<StoredPackageReferenceReport> {
  const stored: StoredReferenceFinding[] = [];
  const tablesNotCarried: string[] = [];
  const tablesAbsent: string[] = [];
  for (const reference of STORED_PACKAGE_REFERENCES) {
    if (!carries(registry, reference.table)) {
      tablesNotCarried.push(reference.table);
      continue;
    }
    if (options?.absent?.(reference.table)) {
      tablesAbsent.push(reference.table);
      continue;
    }
    const packageColumnPresent = !(reference.packageColumn && options?.packageColumnAbsent?.(reference.table, reference.packageColumn));
    stored.push(...(await refusedRowsOf(engine, registry, reference, packageColumnPresent)));
  }

  const picklists: PicklistReferenceFinding[] = [];
  for (const ref of registry.findOutsideClosurePicklistReferences?.() ?? []) {
    if (typeof ref.packageId !== 'string' || ref.packageId === '') continue;
    const answer = registry.picklistReferenceVerdict?.(ref.picklist, ref.packageId) ?? ask(registry, 'picklist' as ReferencedType, ref.picklist, ref.packageId);
    const reason = refusalOf(answer);
    if (!reason) continue;
    picklists.push({
      d8: 'R17', object: ref.object, field: ref.field, packageId: ref.packageId, name: ref.picklist, reason,
      candidates: candidatesOf(registry, answer, ref.picklist),
    });
  }
  picklists.sort((a, b) => byText(a.object, b.object) || byText(a.field, b.field) || byText(a.packageId, b.packageId));

  // The seal already ran at this boot's `kernel:bootstrapped`; asking again
  // records nothing new and answers the same clashes.
  const clashes = new Map<string, { type: string; name: string; holders: Set<string> }>();
  for (const c of registry.sealBareNameHolders?.() ?? []) {
    const key = JSON.stringify([c.type, c.name]);
    const at = clashes.get(key) ?? { type: c.type, name: c.name, holders: new Set<string>() };
    at.holders.add(c.existingHolder.kind === 'package' && c.existingHolder.packageId ? `package "${c.existingHolder.packageId}"` : `the ${c.existingHolder.kind} name`);
    at.holders.add(`package "${c.incomingPackageId}"`);
    clashes.set(key, at);
  }
  const sealedClashes = [...clashes.values()]
    .map((c) => ({ type: c.type, name: c.name, candidates: [...c.holders].sort(byText) }))
    .sort((a, b) => byText(a.type, b.type) || byText(a.name, b.name));

  // The packages the boot kept under an address-literal namespace (warned
  // once there): the install door's judge, over every installed package.
  const literalNamespaces: LiteralNamespaceFinding[] = [];
  for (const pkg of registry.getAllPackages?.() ?? []) {
    const packageId = pkg.manifest?.id;
    const namespace = pkg.manifest?.namespace;
    if (typeof packageId !== 'string' || typeof namespace !== 'string') continue;
    const message = validateNamespaceNotAddressLiteral(namespace);
    if (message !== null) literalNamespaces.push({ packageId, namespace, message });
  }
  literalNamespaces.sort((a, b) => byText(a.packageId, b.packageId));

  // [#31699 F2] The pair member rows two holders could own.
  const readsMetadata = carries(registry, 'sys_metadata') && !options?.absent?.('sys_metadata');
  const pairMembers = readsMetadata ? await ambiguousPairMemberRows(engine, registry) : [];
  // [epic ruling 6761802819 on #31699] …and the package-less rows two holders could own.
  const packageLessRows = readsMetadata ? await ambiguousPackageLessRows(engine, registry) : [];

  return { stored, picklists, sealedClashes, literalNamespaces, pairMembers, packageLessRows, tablesNotCarried, tablesAbsent };
}

/** What the operator asks the bind to write. */
export interface BindRequest {
  readonly table: string;
  readonly id: string;
  readonly packageId: string;
}

/** Why a bind wrote nothing. */
export type BindRefusal =
  | 'unknown-table' | 'report-only' | 'table-not-carried' | 'no-such-row' | 'already-bound' | 'not-asked'
  | 'no-name' | 'resolved' | 'not-held' | 'environment-only' | 'outside-closure' | 'not-a-candidate';

/** What one bind did. */
export type BindOutcome =
  | { readonly outcome: 'bound'; readonly d8: StoredPackageReference['d8']; readonly table: string; readonly id: string; readonly packageColumn: string; readonly name: string; readonly packageId: string }
  | { readonly outcome: 'refused'; readonly reason: BindRefusal; readonly message: string; readonly candidates?: readonly ReferenceCandidate[] };

/** The rows a guarded multi-row update wrote: the engine answers a count (or the rows). */
function rowsWritten(answer: unknown): number {
  if (typeof answer === 'number') return answer;
  if (Array.isArray(answer)) return answer.length;
  return answer && typeof answer === 'object' ? 1 : 0;
}

const refuse = (reason: BindRefusal, message: string, candidates?: readonly ReferenceCandidate[]): BindOutcome => ({
  outcome: 'refused', reason, message, ...(candidates ? { candidates } : {}),
});

/**
 * Write one operator-chosen package into one stored row (module doc): re-read
 * the row, ask the rule again, and write only when the row's package column is
 * still null, the row is still one its backfill asks, the rule still refuses it
 * as ambiguous, and the chosen package is still one of its candidates. Every
 * other state refuses, saying why, and writes nothing.
 */
export async function bindStoredPackageReference(
  engine: StoredReferenceEngine,
  registry: StoredReferenceRegistry,
  request: BindRequest,
): Promise<BindOutcome> {
  const reference = STORED_PACKAGE_REFERENCES.find((r) => r.table === request.table);
  if (!reference) {
    return refuse('unknown-table', `"${request.table}" is not a stored reference ADR-0150 D8 gives a package column; `
      + `the tables are ${STORED_PACKAGE_REFERENCES.filter((r) => r.packageColumn).map((r) => r.table).join(', ')}.`);
  }
  const packageColumn = reference.packageColumn;
  if (!packageColumn) {
    return refuse('report-only', `${reference.table} (${reference.d8}) has no package column: its key is the reference, `
      + 'so it is reported and never bound. A key left bare expires with the ledger\'s retention.');
  }
  if (!carries(registry, reference.table)) {
    return refuse('table-not-carried', `${reference.table} is not part of this composition, so it cannot be read or written. `
      + 'Compose the plugin that owns it, as the server does (the host config\'s plugins).');
  }
  const found = await engine.find(reference.table, { where: { id: request.id }, limit: 1, fields: fieldsOf(reference), context: SYSTEM_CTX });
  const row = Array.isArray(found) ? (found[0] as Row | undefined) : undefined;
  if (!row) return refuse('no-such-row', `${reference.table} has no row "${request.id}".`);
  const current = row[packageColumn];
  if (current !== null && current !== undefined) {
    return refuse('already-bound', `${reference.table} "${request.id}" already names package "${String(current)}" in `
      + `${packageColumn}; a bound row is never moved. Nothing written.`);
  }
  if (!isAsked(reference, row)) {
    return refuse('not-asked', `${reference.table} "${request.id}" is not a row its package column is kept for `
      + `(${reference.d8}: ${reference.d8 === 'R5' ? 'managed rows only' : reference.d8 === 'R7' ? 'open requests only' : 'paused runs only'}). Nothing written.`);
  }
  const name = referencedName(reference, row[reference.nameColumn]);
  if (name === undefined) return refuse('no-name', `${reference.table} "${request.id}" names no item in ${reference.nameColumn}. Nothing written.`);
  const caller = callerOf(reference, row);
  const answer = ask(registry, reference.type, name, caller);
  const candidates = candidatesOf(registry, answer, name);
  if (answer.status === 'resolved') {
    return refuse('resolved', `"${name}" now resolves to one holder, so there is nothing to choose: `
      + 'the next server boot binds it (a package holder), or the null is its spelling (the environment\'s or the platform\'s). Nothing written.');
  }
  if (answer.status !== 'refused') {
    return refuse('not-held', `Nothing holds "${name}" any more, so there is no candidate to bind. Nothing written.`);
  }
  const reason = refusalOf(answer);
  if (reason === 'environment-only') {
    return refuse('environment-only', `${answer.message} A package's reference to an environment-authored item is refused `
      + '(ADR-0150 D3 (a)); there is no package to bind. Nothing written.', candidates);
  }
  if (reason === 'outside-closure') {
    return refuse('outside-closure', `${answer.message} Binding it would resolve past the package's declared dependencies, `
      + 'which the rule never does (ADR-0150 D3 (c)): declare the dependency instead. Nothing written.', candidates);
  }
  const chosen = candidates.find((c) => c.holder === 'package' && c.packageId === request.packageId);
  if (!chosen) {
    return refuse('not-a-candidate', `"${request.packageId}" is not one of the holders the rule names for "${name}" now `
      + '(the report may be stale). Re-run the report and choose one of the candidates. Nothing written.', candidates);
  }
  // The write is guarded on the column still being null, so a write that
  // landed between the re-ask above and this one (another bind, a boot's
  // backfill) wins: this one updates 0 rows and refuses, naming what is stored.
  // A bound row is never moved, concurrency included.
  const written = await engine.update(reference.table, { [packageColumn]: request.packageId }, {
    where: { id: { $eq: row.id }, [packageColumn]: { $null: true } },
    multi: true,
    context: SYSTEM_CTX,
  });
  if (rowsWritten(written) === 0) {
    const now = await engine.find(reference.table, { where: { id: request.id }, limit: 1, fields: ['id', packageColumn], context: SYSTEM_CTX });
    const stored = Array.isArray(now) ? (now[0] as Row | undefined)?.[packageColumn] : undefined;
    return refuse('already-bound', `${reference.table} "${request.id}" was bound to package "${String(stored)}" in `
      + `${packageColumn} after this run read it; a bound row is never moved. Nothing written.`);
  }
  return { outcome: 'bound', d8: reference.d8, table: reference.table, id: String(row.id), packageColumn, name, packageId: request.packageId };
}
