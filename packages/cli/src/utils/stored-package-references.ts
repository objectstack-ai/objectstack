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
import { resolvePackageScopedName, type PackageScopedRegistry } from '@objectstack/objectql';
import { keysetWalk } from '@objectstack/types';

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
  | { readonly holder: 'platform' };

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

/** The report (module doc). */
export interface StoredPackageReferenceReport {
  readonly stored: readonly StoredReferenceFinding[];
  readonly picklists: readonly PicklistReferenceFinding[];
  readonly sealedClashes: readonly SealedClashFinding[];
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

/** The registry slice: the resolver's reads, the table check, and the two readers the report lists. */
export type StoredReferenceRegistry = PackageScopedRegistry & {
  getObject?(name: string): unknown;
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

/** The columns a row read needs. */
function fieldsOf(reference: StoredPackageReference): string[] {
  const fields = new Set(['id', reference.nameColumn]);
  if (reference.packageColumn) fields.add(reference.packageColumn);
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

/** The stored rows of one reference the rule refuses (module doc). Reads only; ordered by id. */
async function refusedRowsOf(
  engine: StoredReferenceEngine,
  registry: StoredReferenceRegistry,
  reference: StoredPackageReference,
): Promise<StoredReferenceFinding[]> {
  const findings: StoredReferenceFinding[] = [];
  const answers = new Map<string, PackageScopedResolution>();
  const unbound = reference.packageColumn ? { [reference.packageColumn]: null } : undefined;
  const where = unbound && reference.where ? { $and: [unbound, reference.where] } : (unbound ?? reference.where ?? {});
  const walk = keysetWalk<Row>(
    async (query) => {
      const page = await engine.find(reference.table, { ...query, fields: fieldsOf(reference), context: SYSTEM_CTX });
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

/**
 * The upgrade report (module doc): every refused stored row, every refused
 * picklist reference and every sealed clash, in a stable order, so two runs
 * over one database print the same bytes. Writes nothing.
 */
export async function collectStoredPackageReferences(
  engine: StoredReferenceEngine,
  registry: StoredReferenceRegistry,
  options?: { readonly absent?: (table: string) => boolean },
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
    stored.push(...(await refusedRowsOf(engine, registry, reference)));
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

  return { stored, picklists, sealedClashes, tablesNotCarried, tablesAbsent };
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
  await engine.update(reference.table, { id: row.id, [packageColumn]: request.packageId }, { context: SYSTEM_CTX });
  return { outcome: 'bound', d8: reference.d8, table: reference.table, id: String(row.id), packageColumn, name, packageId: request.packageId };
}
