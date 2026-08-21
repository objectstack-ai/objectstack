// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { referenceTargetOf, unprovisionedInjectedColumns } from '@objectstack/spec/data';
import { PLATFORM_OBJECTS_BY_PACKAGE } from '@objectstack/spec/system';

/**
 * [#4551] Read-only inspection for the residual #4441 left open: a stored
 * reference that points at no row.
 *
 * #4441 made the WRITE path refuse an unresolvable `lookup` id — but
 * deliberately exempted `isSystem` writes, because seed replay, package
 * install and boot-time provisioning legitimately write rows in an order that
 * only resolves once the batch completes, and failing them closed would turn
 * an ordering detail into a boot failure. That exemption is correct and this
 * change does not touch it. What it leaves behind is a gap of a different
 * kind: **the platform itself can still write a reference into the void, and
 * nothing says so.**
 *
 * Removing the exemption is not the fix. Rejecting the platform's own write is
 * not the right way to report the problem. Making it VISIBLE is.
 *
 * (Historical note, because it is load-bearing for the scope section below: the
 * platform used to have a legitimate NON-ID write of its own —
 * `sys_metadata_history.recorded_by`, a `lookup('sys_user')` the metadata
 * repository filled with the SENTINEL STRING `actor ?? 'system'`. #4556
 * replaced that sentinel with NULL. Nothing writes a non-id into a reference
 * column any more, which is what #4743 re-scoped the `readonly` skip on.)
 *
 * ## Reports; never rewrites
 *
 * Same posture as {@link https://github.com/objectstack-ai/objectstack/issues/4469}'s
 * `inspectStrandedRequests`, and for the same reason: the rows were genuinely
 * written. Auto-nulling a dangling id would make the stored data disagree with
 * what actually happened, and the remedy — re-seed the missing target, or clear
 * the reference — is a judgement call an audit cannot make. So this issues
 * exactly zero writes and its report is addressed to a human: which object,
 * which record, which field, which id, and which object that id was supposed to
 * name.
 *
 * ## Unknown and absent are DIFFERENT answers
 *
 * The single most important property here. An existence probe that cannot run
 * (target object not registered, no driver, probe throws) must never be
 * recorded as "the target does not exist" — otherwise a datasource outage
 * publishes every reference through it as broken. Those land in
 * {@link DanglingReferenceReport.undetermined}. Likewise an object whose rows
 * could not be listed lands in `unreadableObjects`, and an object whose row
 * budget ran out lands in `truncatedObjects` — because a bounded scan proves
 * nothing about the rows it never read. Together they are what stops
 * "0 dangling" from ever being read as "everything is fine".
 *
 * ## …and NOT-ATTEMPTED is a third answer again (#4747)
 *
 * The corollary that bucket discipline needs to survive contact with a real
 * process. `unreadableObjects` means **"I tried to read this object and the
 * datasource would not give it to me"** — an operational finding. It does NOT
 * mean "the run was called off". Those are different facts with different
 * remedies (investigate the datasource / nothing to do), and a bucket that
 * holds both stops carrying either.
 *
 * The distinction is not cosmetic: before #4747 every single `os migrate`
 * invocation ended with `unreadableObjects: ['sys_metadata',
 * 'sys_view_definition']`, because the sweep this audit rides fired after the
 * engine's connection pool had been torn down. An alarm that is true on every
 * healthy run carries no information and trains its operator to skip the line —
 * so the ONE run where a datasource really was unreadable would have read
 * exactly like all the others.
 *
 * Hence {@link DanglingReferenceAuditOptions.signal}: when the caller says the
 * run is being called off, the audit stops issuing reads and marks the report
 * {@link DanglingReferenceReport.aborted}. A read that loses the race and fails
 * *after* the abort is dropped rather than filed — it is not evidence about the
 * datasource. `aborted` keeps the incompleteness loud (the report can never be
 * read as a clean bill of health) without spending the finding bucket on it.
 *
 * ## …and PROVENANCE is a fourth answer (#4743)
 *
 * `readonly` reference fields used to be skipped outright, on two grounds. The
 * first is #4441's and still holds: a non-system caller's value is stripped
 * before the write (`stripReadonlyFields` / `stripReadonlyForInsert`), so what
 * survives was minted by the platform and was never the caller's to answer for.
 * The second was the `recorded_by` sentinel above — the platform wrote a
 * NON-ID into a reference column, and probing it could only ever produce a
 * finding about a value that was never an id. **#4556 deleted that ground**,
 * and with it the only argument the skip ever had beyond "not the caller's
 * fault".
 *
 * What the skip covered after that was exactly one family: the audit-provenance
 * fields (`created_by` / `updated_by` / `organization_id`, all `readonly: true`
 * from `applySystemFields`). Those hold GENUINE ids, and genuine ids dangle —
 * delete one user and every row they ever created points `created_by` at a row
 * that is gone. "Who did this" failing to resolve is precisely what an audit
 * trail exists to answer, so skipping it is blindness rather than economy.
 *
 * They are still not the SAME finding as a broken business foreign key, so they
 * do not share its bucket. `dangling` keeps meaning "a link the model declares
 * is broken"; {@link DanglingReferenceReport.provenance} means "the actor this
 * row records no longer exists". Same discipline, same reason, as the
 * unknown/absent split above — mixing them would drown the business findings in
 * the provenance ones, which is the failure mode this whole file is written
 * against.
 *
 * ⚠️ **Expect `provenance` to be BIG the first time you look at it**, on any
 * database that has ever deleted a user or an organization: one deleted user
 * dangles every row they ever touched. That number is PRE-EXISTING STATE being
 * reported for the first time — not damage this audit caught being done, and
 * not a regression introduced by looking. It is also why `provenance` alone
 * does NOT raise the summary warning: an alarm that fires on every run of an
 * ordinarily-aged database is #4747's broken alarm all over again, and it would
 * cost the buckets next to it the attention they were built for. The count
 * rides along whenever the line fires for a real finding, and the itemised rows
 * are always in the returned report for a caller that asked the question.
 *
 * The unknown/absent split applies INSIDE the new bucket too, and it bites at
 * once: `undetermined` counts probes that could not run, and on a stack where
 * `sys_user` is not registered every provenance value probes `null`. Folding
 * those into `undetermined` would inflate a bucket that DOES raise the warning,
 * with a fact about which platform tables are mounted rather than about the
 * data being audited. Hence
 * {@link DanglingReferenceReport.provenanceUndetermined}, on its own side of
 * the same line.
 *
 * ## …and NEVER-REACHED is the last incompleteness (#5718)
 *
 * `truncatedObjects` says the budget ran out INSIDE a table. The overall budget
 * ({@link DanglingReferenceAuditOptions.maxRows}) also runs out BETWEEN tables:
 * the object loop simply stops, and before #5718 every object behind that stop
 * left no trace in the report at all. `dangling: []` covered them exactly as it
 * covered the tables that WERE read and found clean — which is precisely the
 * reading this whole file is written to prevent.
 * {@link DanglingReferenceReport.unscannedObjects} names them, so the report
 * keeps saying "not looked at" wherever it cannot say "looked at and clean".
 *
 * #4743 did not cause this, it made it easy to reach: admitting the provenance
 * family means nearly every object now has an auditable field, so a bounded run
 * spreads the same budget over far more tables and hits the stop sooner. Note
 * that `prioritise` and this bucket answer different questions — the tiers
 * decide WHO gets a finite budget, the bucket reports who did not get any. A
 * scan order cannot make a bounded run complete; only saying what it missed
 * can make it honest.
 *
 * Like `truncatedObjects`, it does **not** raise the summary warning by itself.
 * A large database exhausts the default 5 000-row budget on every healthy run,
 * and an alarm that always fires is #4747's broken alarm again. It rides along
 * in the warning payload and is always present in the returned report.
 *
 * ## Scope — the same judgments #4441 already made, not new ones
 *
 * - **Which fields are references** is `referenceTargetOf` — the single
 *   arbiter the write-path check and the expand gate already share, covering
 *   `lookup` / `master_detail` / `user` / `tree`. A hand-written type list here
 *   would be a second, drifting answer to a question that already has one.
 * - **Empty is not a reference.** `null` / `undefined` / `''` and the empty
 *   array mean "no link" — what `deleteBehavior: 'set_null'` writes.
 * - **An already-expanded object in the slot is not an id.**
 */

/** One stored reference that resolves to nothing. */
export interface DanglingReference {
  /** Object holding the broken reference. */
  objectName: string;
  /** Primary key of the row holding it. */
  recordId: string;
  /** Field on that row. */
  field: string;
  /** The object the field declares as its target. */
  target: string;
  /** The id that names no row of `target`. */
  value: string;
}

export interface DanglingReferenceReport {
  /** Rows actually read and examined. */
  scanned: number;
  /** References proven to point at nothing. */
  dangling: DanglingReference[];
  /**
   * Reference values whose target could NOT be probed (unregistered object, no
   * driver, probe threw). NOT healthy — merely unknown.
   */
  undetermined: number;
  /** Objects whose rows could not be listed at all. Unknown, not clean. */
  unreadableObjects: string[];
  /**
   * Objects where the per-object row budget was reached before the table
   * ended, so this run inspected a SAMPLE. `dangling: []` says nothing about
   * the rows beyond the budget.
   */
  truncatedObjects: string[];
  /**
   * [#4747] `true` when the run was called off before it finished — the caller
   * aborted it (see {@link DanglingReferenceAuditOptions.signal}), typically
   * because the engine it reads through is being torn down.
   *
   * An aborted run inspected only the objects it reached, so its findings are
   * real but its SILENCE proves nothing. Deliberately its own field rather than
   * an entry in `unreadableObjects`: "nobody asked" is not "the datasource
   * refused". `false` on a run that walked every object it was given.
   *
   * Optional in the type only so a hand-written {@link DanglingReferenceReport}
   * (a test double) still satisfies it; every report this module produces sets
   * it explicitly.
   */
  aborted?: boolean;
  /**
   * [#4743] Audit-provenance references that resolve to nothing: `created_by` /
   * `updated_by` / `organization_id` — the `readonly` family `applySystemFields`
   * injects — naming a user or organization that no longer exists.
   *
   * Its own bucket rather than an entry in `dangling`, because it answers a
   * different question with a different remedy: `dangling` says a link the
   * model DECLARES is broken (re-seed the target, or clear the link);
   * `provenance` says the actor a row records has since been deleted, which is
   * usually nothing to fix and everything to know.
   *
   * **Read a large number here as history, not as damage.** Every row a deleted
   * user ever created lands in it, and this is the first release that reports
   * them at all (before #4743 the whole family was skipped) — so the first run
   * on an aged database measures accumulated state, not a new defect.
   *
   * Same optionality as {@link DanglingReferenceReport.aborted}, for the same
   * reason: hand-written reports (test doubles) predate the key. Every report
   * this module produces sets it.
   */
  provenance?: DanglingReference[];
  /**
   * [#4743] Provenance reference values whose target could NOT be probed — the
   * `undetermined` axis, kept on the provenance side of the line.
   *
   * Separate from {@link DanglingReferenceReport.undetermined} because that
   * count raises the summary warning and this one must not: on a stack that
   * never registers `sys_user`, EVERY provenance value probes `null`, and a
   * fact about which platform tables are mounted would otherwise arrive
   * disguised as a fact about the audited data.
   */
  provenanceUndetermined?: number;
  /**
   * [#5718] Objects this run never reached — the overall row budget
   * ({@link DanglingReferenceAuditOptions.maxRows}) was gone before their turn,
   * or the run was called off first. **Not one of their rows was read**, so the
   * report holds no verdict about them whatsoever.
   *
   * The sibling of `truncatedObjects`, one level up: that one says "this table
   * was sampled", this one says "this table was not opened". The two together
   * are what keeps `dangling: []` from ever meaning more than "clean among what
   * was read" — the difference between them is only whether the budget ran out
   * inside a table or before it.
   *
   * Names are in **scan order** (the `prioritise` tiers), so a caller that
   * wants the rest of the picture can feed them straight back as
   * {@link DanglingReferenceAuditOptions.objects} on a second run.
   *
   * Two things are deliberately NOT in here, because neither is something this
   * run failed to look at:
   *
   * - **Objects with no reference field at all.** Nothing referential can
   *   break on them, so their absence from `dangling` is proven rather than
   *   assumed — `prioritise` drops them before the loop ever sees them. Since
   *   #8414 a federated object can reach that state by having had only
   *   PHANTOM reference columns (see `auditableReferenceFields`), and the
   *   proof is the same one: a column the platform never provisioned stores
   *   no reference, so there is none to dangle. It is the object's REAL
   *   reference columns that decide whether it is read — a federated object
   *   that declares one is audited on it like any other.
   * - **Objects the caller excluded** via
   *   {@link DanglingReferenceAuditOptions.objects}. Those were never asked
   *   for; filing them would report the caller's own narrowing back to it as
   *   an incompleteness of the audit.
   *
   * Empty means every object this run had queued was reached — with one
   * boundary that {@link DanglingReferenceReport.aborted} covers instead: a run
   * called off before it enumerated the registry has no list to give, so a
   * consumer reads completeness from `aborted === false` AND this being empty,
   * the same way it already composes `truncatedObjects` and `unreadableObjects`.
   *
   * Optional in the type only, like {@link DanglingReferenceReport.aborted} and
   * for the same reason (a hand-written report literal predates the key); every
   * report this module produces sets it explicitly — `[]` on a run that reached
   * everything, never absent, so `undefined` cannot be misread as "complete".
   */
  unscannedObjects?: string[];
}

/**
 * Minimal object shape the audit reads — duck-typed so tests need no registry.
 *
 * The two named keys are what the audit itself reads. The index signature is
 * not laxity: the port is handed the WHOLE registered document (the engine
 * passes `SchemaRegistry.getAllObjects()` straight through), and
 * {@link unprovisionedInjectedColumns} derives its verdict from the injection
 * plan's own inputs on that document — `external`, `systemFields`,
 * `managedBy`, `tenancy`, `ownership`. Those are deliberately NOT restated as
 * keys here: the list belongs to the derivation in `@objectstack/spec/data`,
 * and a copy of it in this file would be free to fall behind it silently.
 *
 * A hand-written double carrying only `name` and `fields` still satisfies the
 * type and still gets the right answer — with no `external` key the platform
 * provisions the storage, so nothing is withheld and the double behaves
 * exactly as it did before the provenance filter existed.
 */
export interface AuditableObject {
  name: string;
  fields?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * The engine surface the audit needs. `probe` is deliberately a PORT rather
 * than a re-implementation: the caller passes the engine's own existence check,
 * so the audit and the #4441 write-path guard answer "does this id exist" with
 * one predicate. A second copy here would be free to disagree — which is the
 * #4550 failure mode (a stand-in looser than the real implementation) planted
 * in production code rather than in a test.
 */
export interface DanglingReferenceAuditPort {
  /** Every registered object, in registration order. */
  objects(): AuditableObject[];
  /** Unscoped row read. Existence is a fact about the database, not the caller. */
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  /**
   * `true` = the row exists, `false` = the probe RAN and found nothing,
   * `null` = it could not run at all (→ `undetermined`).
   */
  probe(target: string, id: unknown): Promise<boolean | null>;
  warn?(message: string, meta?: unknown): void;
}

/**
 * The "stop now" input, narrowed to the one bit the audit reads. Structurally
 * satisfied by the platform `AbortSignal`, so a caller that already has one
 * passes it directly — but declared here so this module needs no DOM lib and a
 * test can hand it a plain object.
 */
export interface AuditAbortSignal {
  readonly aborted: boolean;
}

export interface DanglingReferenceAuditOptions {
  /** Rows read per object. Default {@link DEFAULT_ROWS_PER_OBJECT}. */
  rowsPerObject?: number;
  /** Total rows read across all objects. Default {@link DEFAULT_MAX_ROWS}. */
  maxRows?: number;
  /** Restrict the scan to these objects (diagnostics / tests). */
  objects?: string[];
  /**
   * [#4747] Called off — checked before every read, so an aborted run issues no
   * further queries and reports {@link DanglingReferenceReport.aborted} instead
   * of filing the objects it never reached.
   *
   * The audit reads through a live engine; the engine outlives it only until
   * the host tears the datasource down. Without this the sweep kept querying a
   * closed pool, which surfaced as an `ERROR Find operation failed` on a
   * SUCCESSFUL command and as a permanently non-empty `unreadableObjects`.
   */
  signal?: AuditAbortSignal;
}

/** Bounded per object so one enormous table cannot starve every other. */
export const DEFAULT_ROWS_PER_OBJECT = 500;
/** Bounded overall so the audit stays invisible next to the sweep it rides. */
export const DEFAULT_MAX_ROWS = 5_000;

/**
 * Objects scanned FIRST when the budget is finite (#4551): the ADR-0090
 * permission model's own tables. A dangling row there is not untidy, it is a
 * **security-surface record that resolves to nothing** — and the
 * audience-anchor gate has to resolve exactly that permission set to evaluate
 * the grant, so the binding is an unevaluable gate input.
 *
 * Derived from `PLATFORM_OBJECTS_BY_PACKAGE` rather than hand-listed, so a
 * table added to plugin-security is prioritised without anyone remembering to
 * come back here.
 */
export const SECURITY_SURFACE_OBJECTS: ReadonlySet<string> = new Set(
  PLATFORM_OBJECTS_BY_PACKAGE['plugin-security'] ?? [],
);

/** "The stored slot names no record." Mirrors the write path's own predicate. */
function isEmptyStoredReference(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

/** One reference field worth reading an object for, and which bucket it feeds. */
interface AuditableField {
  name: string;
  target: string;
  /**
   * [#4743] `true` for a `readonly` reference — the audit-provenance family.
   * Findings on it are still findings; they just answer a different question,
   * so they land in {@link DanglingReferenceReport.provenance}.
   */
  provenance: boolean;
}

/**
 * Reference fields worth auditing on one object: everything with a declared
 * target that the object actually STORES, each tagged with the bucket its
 * findings belong in. Returns `[]` for an object with none, which is how the
 * audit avoids reading a single row of the tables that have nothing
 * referential on them at all.
 *
 * `readonly` is no longer a reason to drop a field (#4743) — it is the reason
 * to file its findings separately. See the provenance section in the module
 * header for why the skip's second ground stopped existing at #4556.
 *
 * ## Why a registered reference column can still be nothing to audit (#8414)
 *
 * `applySystemFields` injects `organization_id`, `owner_id`,
 * `owning_business_unit_id` and the audit `*_by` lookups into every object it
 * registers — ADR-0015 `external` ones included, because that derivation has no
 * `external` branch. But `Engine.syncObjectSchema` returns early for a federated
 * object and issues no DDL: the remote database owns the schema. So on a
 * federated object those five reference columns exist in the registered schema
 * and **nowhere else**, and an enumerator that reads `fields` alone is answered
 * YES about a column no query can ever find.
 *
 * Measured on a real boot of `examples/app-showcase`, this sweep asked the
 * remote `customers` table (physically `id, name, email, region,
 * lifetime_value`) for:
 *
 * ```
 *   select `id`, `organization_id`, `created_by`, `updated_by`, `owner_id`,
 *          `owning_business_unit_id` from `customers` limit ?
 * ```
 *
 * which the backend refuses (`no such column`; backtick-quoted identifiers do
 * NOT take SQLite's double-quote literal fallback) and `SqlDriver.find`'s
 * unknown-column recovery then absorbs by retrying `select *` — up to 500 full
 * rows fetched, every lifecycle sweep interval, to audit columns that cannot
 * exist. Nothing answered wrongly; the entire pass was waste.
 *
 * The fix is to stop asking, at the enumerator, and NOT to lean harder on that
 * recovery: consumer-side tolerance of a read that should never have been
 * issued is the direction Prime Directive #12 rules against.
 *
 * ## Why PROVENANCE and not `external != null`
 *
 * A federated object MAY declare a real remote `organization_id` (or any other
 * anchor name) — the author vouches for that column, it is genuinely there, and
 * a reference stored in it can genuinely dangle. Skipping every injected-anchor
 * NAME on every external object would stop auditing a column that is real.
 * {@link unprovisionedInjectedColumns} answers the narrower question the audit
 * actually has — "is this column the PLATFORM's injected anchor on an object the
 * platform provisions no storage for?" — by identity against the shipped
 * definition tables, so an author-declared column of the same name keeps its
 * audit. It returns `[]` for every platform-provisioned object, which is why
 * the ordinary path is not merely unchanged but untouched.
 */
function auditableReferenceFields(obj: AuditableObject): AuditableField[] {
  const fields = obj?.fields;
  if (!fields || typeof fields !== 'object') return [];
  // Empty for every object the platform provisions storage for — the common
  // case pays one `external == null` test per object and nothing else.
  const phantom = new Set(unprovisionedInjectedColumns(obj));
  const out: AuditableField[] = [];
  for (const [name, def] of Object.entries(fields)) {
    // Registered but never provisioned: there is no column, so there is no
    // stored reference, so there is nothing this audit could find in it.
    if (phantom.has(name)) continue;
    const target = referenceTargetOf(def);
    if (!target) continue;
    out.push({ name, target, provenance: (def as { readonly?: unknown })?.readonly === true });
  }
  return out;
}

/** An object paired with the reference fields the audit will read it for. */
interface AuditTarget {
  obj: AuditableObject;
  refFields: AuditableField[];
}

/**
 * Scan order for a finite budget: security surface, then objects carrying a
 * business reference, then the provenance-only remainder. Each group keeps
 * registration order so a run is deterministic, and objects with no reference
 * field at all are dropped here — they are the ones the audit reads zero rows
 * of.
 *
 * The third tier is #4743's doing and is the reason it is safe. Admitting the
 * provenance family means nearly EVERY object now has an auditable field
 * (`applySystemFields` injects `created_by` almost everywhere), so without an
 * ordering rule a bounded scan would start spending its row budget on tables
 * that carry only provenance — and the business findings that budget was built
 * for would be the ones it ran out before reaching. Same argument as
 * {@link SECURITY_SURFACE_OBJECTS}, one tier down: when the budget is finite,
 * order is what decides which question actually gets answered.
 */
function prioritise(objects: AuditableObject[]): AuditTarget[] {
  // `auditableReferenceFields` is the single seam that decides both WHICH
  // objects are opened and WHICH columns are projected off them, so the #8414
  // phantom-column filter reaches the row read and the object skip at once —
  // a federated object left with no real reference column is dropped here and
  // costs zero statements.
  const security: AuditTarget[] = [];
  const business: AuditTarget[] = [];
  const provenanceOnly: AuditTarget[] = [];
  for (const obj of objects) {
    const refFields = auditableReferenceFields(obj);
    if (refFields.length === 0) continue;   // nothing referential here — read nothing
    const tier = SECURITY_SURFACE_OBJECTS.has(obj?.name)
      ? security
      : refFields.some((f) => !f.provenance) ? business : provenanceOnly;
    tier.push({ obj, refFields });
  }
  return [...security, ...business, ...provenanceOnly];
}

/**
 * Walk stored rows and report every reference that resolves to nothing.
 *
 * Issues **no writes of any kind**. Every failure to determine an answer is
 * reported as such rather than resolved into a verdict.
 */
export async function auditDanglingReferences(
  port: DanglingReferenceAuditPort,
  options?: DanglingReferenceAuditOptions,
): Promise<DanglingReferenceReport> {
  // The optional keys are optional in the TYPE only (hand-written test doubles
  // predate them); every report this function produces sets them, so the local
  // view of it requires them and no call site below has to guard.
  const report: DanglingReferenceReport &
    Required<Pick<DanglingReferenceReport,
      'provenance' | 'provenanceUndetermined' | 'unscannedObjects'>> = {
    scanned: 0, dangling: [], undetermined: 0, unreadableObjects: [], truncatedObjects: [],
    provenance: [], provenanceUndetermined: 0,
    unscannedObjects: [],
    aborted: false,
  };

  const signal = options?.signal;
  /** Cheap enough to ask before every read; the answer can flip mid-run. */
  const calledOff = (): boolean => signal?.aborted === true;
  if (calledOff()) {
    report.aborted = true;
    return report;
  }

  let all: AuditableObject[];
  try {
    all = port.objects() ?? [];
  } catch {
    return report;
  }
  const only = options?.objects ? new Set(options.objects) : undefined;
  const rowsPerObject = options?.rowsPerObject ?? DEFAULT_ROWS_PER_OBJECT;
  const maxRows = options?.maxRows ?? DEFAULT_MAX_ROWS;

  // One id is typically referenced by many rows (that is what a link table IS),
  // so the probe is memoised for the run. `null` — could not determine — is
  // cached too: a target that cannot be probed does not become probeable
  // halfway through one sweep, and re-asking would multiply an outage by the
  // row count.
  //
  // The key separator is NUL because it cannot occur in an object name or a
  // record id, so no (target, value) pair can collide with another. It is
  // spelled as the \u0000 ESCAPE, never the raw byte: a raw NUL makes
  // ripgrep treat the whole file as binary and return ZERO matches, dropping
  // it out of code search and every grep-based lint (`pnpm check:nul-bytes`
  // enforces this). The escape is byte-identical at runtime.
  const probed = new Map<string, boolean | null>();
  /**
   * `'called-off'` is a THIRD answer alongside the probe's own three: it means
   * the question was withdrawn, so the value must not be counted as
   * `undetermined` either — that bucket is for probes that ran and could not
   * tell (#4747).
   */
  const exists = async (target: string, value: string): Promise<boolean | null | 'called-off'> => {
    if (calledOff()) return 'called-off';
    const key = `${target}\u0000${value}`;
    if (probed.has(key)) return probed.get(key)!;
    let answer: boolean | null;
    try {
      answer = await port.probe(target, value);
    } catch {
      // A probe that threw because the run was called off underneath it says
      // nothing about the target — it is withdrawn, not undetermined.
      if (calledOff()) return 'called-off';
      // A throwing probe is "could not determine", never "does not exist".
      answer = null;
    }
    probed.set(key, answer);
    return answer;
  };

  // Materialised rather than iterated inline (#5718): once the loop stops early
  // the report has to name what is BEHIND the stop, which needs the queue and
  // the position in it, not just the current element.
  const targets = prioritise(all);
  /**
   * [#5718] File every object from `from` onward as never-reached. Applies the
   * caller's `only` narrowing for the same reason the loop does: an object the
   * caller excluded was not missed by this run, it was never on its list.
   */
  const fileUnscanned = (from: number): void => {
    for (let i = from; i < targets.length; i++) {
      const n = targets[i]?.obj?.name;
      if (!n || (only && !only.has(n))) continue;
      report.unscannedObjects.push(n);
    }
  };

  objects: for (let i = 0; i < targets.length; i++) {
    const { obj, refFields } = targets[i]!;
    // Budget gone BETWEEN objects. This one and everything behind it is never
    // opened, and `dangling: []` about a table nobody read is not a verdict —
    // so the run names them instead of stopping in silence (#5718).
    if (report.scanned >= maxRows) { fileUnscanned(i); break; }
    // Called off before this object was read: it was never attempted, so it is
    // not a finding about the object — the run reports that it stopped instead.
    // The objects behind the stop are just as unread as a budget stop leaves
    // them, so they are filed the same way; `aborted` records WHY it stopped.
    if (calledOff()) { report.aborted = true; fileUnscanned(i); break; }
    const name = obj?.name;
    if (!name || (only && !only.has(name))) continue;

    const budget = Math.min(rowsPerObject, maxRows - report.scanned);
    let rows: Array<Record<string, unknown>>;
    try {
      rows = (await port.find(name, {
        fields: ['id', ...refFields.map((f) => f.name)],
        limit: budget,
        context: { isSystem: true },
      })) ?? [];
    } catch (err) {
      // A read that failed because the run was called off underneath it is not
      // evidence about the datasource — the pool was closed on purpose. Filing
      // it would put a non-finding in the one bucket that must only ever hold
      // findings (#4747). Its rows were never examined either, so THIS object
      // is filed as unreached too — `from = i`, not `i + 1` (#5718).
      if (calledOff()) { report.aborted = true; fileUnscanned(i); break; }
      // Unreadable ⇒ unknown. Recorded so the report cannot be mistaken for a
      // clean bill of health on an object nothing could look at.
      report.unreadableObjects.push(name);
      port.warn?.('[integrity] dangling-reference audit could not list an object', {
        object: name, error: (err as Error)?.message ?? String(err),
      });
      continue;
    }
    report.scanned += rows.length;
    if (rows.length >= budget) report.truncatedObjects.push(name);

    for (const row of rows) {
      for (const { name: field, target, provenance } of refFields) {
        const raw = row?.[field];
        if (isEmptyStoredReference(raw)) continue;
        const values = Array.isArray(raw) ? raw : [raw];
        for (const v of values) {
          if (isEmptyStoredReference(v)) continue;
          // An expanded record in the slot is a read shape, not an id write.
          if (typeof v === 'object') continue;
          const answer = await exists(target, v);
          // Called off mid-object: this one WAS opened and partly examined, so
          // it is not unreached — only the objects behind it are (#5718).
          if (answer === 'called-off') {
            report.aborted = true;
            fileUnscanned(i + 1);
            break objects;
          }
          // [#4743] Both verdicts are routed by the field's class, not merged:
          // a provenance answer never lands in a bucket a business reference
          // shares, in EITHER direction (absent or unknown).
          if (answer === null) {
            if (provenance) report.provenanceUndetermined++;
            else report.undetermined++;
            continue;
          }
          if (answer) continue;
          (provenance ? report.provenance : report.dangling).push({
            objectName: name,
            recordId: String(row?.id ?? ''),
            field,
            target,
            value: String(v),
          });
        }
      }
    }
  }

  // [#4743] The provenance buckets deliberately do NOT appear in this
  // condition. On a database of any age they are non-empty on every healthy
  // run, and a line that always fires is the #4747 broken alarm — it would
  // train its reader past the one run where `dangling` had something in it.
  // They ride along whenever the line fires for a real finding; the full
  // report always carries them for a caller that came looking.
  if (report.dangling.length || report.undetermined || report.unreadableObjects.length) {
    port.warn?.('[integrity] stored references that resolve to nothing (#4551)', {
      scanned: report.scanned,
      dangling: report.dangling.length,
      undetermined: report.undetermined,
      unreadableObjects: report.unreadableObjects,
      truncatedObjects: report.truncatedObjects,
      // [#5718] Itemised like `truncatedObjects` and for the same reason: this
      // is object-scale, not row-scale, and a reader who has to act on it needs
      // the names to re-run them. It does not appear in the condition above —
      // a bounded run on a large database exhausts its budget every time, and
      // an alarm that always fires is #4747's broken alarm.
      unscannedObjects: report.unscannedObjects,
      // Carried into the log line too: findings from a run that stopped early
      // are real, but its silence about everything else is not a verdict.
      aborted: report.aborted,
      // Counted here, never itemised: on a database that has deleted users this
      // can outnumber every other finding by orders of magnitude, and the rows
      // themselves are in the returned report.
      provenance: report.provenance.length,
      provenanceUndetermined: report.provenanceUndetermined,
      references: report.dangling.map(
        (d) => `${d.objectName}#${d.recordId}.${d.field} → ${d.target}#${d.value}`,
      ),
    });
  }
  return report;
}
