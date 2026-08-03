// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { referenceTargetOf } from '@objectstack/spec/data';
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
 * Removing the exemption is not the fix. Beyond the boot-ordering problem, the
 * platform has legitimate non-id writes of its own — `sys_metadata_history.
 * recorded_by` is a `lookup('sys_user')` the metadata repository fills with the
 * SENTINEL STRING `actor ?? 'system'` (that one is already out of scope via
 * #4441's `readonly` narrowing). Rejecting the platform's own write is not the
 * right way to report the problem. Making it VISIBLE is.
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
 * ## Scope — the same judgments #4441 already made, not new ones
 *
 * - **`readonly` reference fields are skipped**, exactly as the write-path
 *   check skips them: a non-system caller's value is stripped before the write
 *   (`stripReadonlyFields` / `stripReadonlyForInsert`), so what remains was
 *   minted by the platform — including the audit-provenance family
 *   (`created_by` / `updated_by` / `organization_id`, all `readonly: true` from
 *   `applySystemFields`) and the `recorded_by` sentinel above.
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
}

/** Minimal object shape the audit reads — duck-typed so tests need no registry. */
export interface AuditableObject {
  name: string;
  fields?: Record<string, unknown>;
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

/**
 * Reference fields worth auditing on one object: declared target, not
 * `readonly`. Returns `[]` for an object with none, which is how the audit
 * avoids reading a single row of the vast majority of tables.
 */
function auditableReferenceFields(obj: AuditableObject): Array<{ name: string; target: string }> {
  const fields = obj?.fields;
  if (!fields || typeof fields !== 'object') return [];
  const out: Array<{ name: string; target: string }> = [];
  for (const [name, def] of Object.entries(fields)) {
    if ((def as { readonly?: unknown })?.readonly === true) continue;
    const target = referenceTargetOf(def);
    if (!target) continue;
    out.push({ name, target });
  }
  return out;
}

/**
 * Security-surface objects first, everything else after, each group keeping
 * registration order so a run is deterministic.
 */
function prioritise(objects: AuditableObject[]): AuditableObject[] {
  const security: AuditableObject[] = [];
  const rest: AuditableObject[] = [];
  for (const o of objects) (SECURITY_SURFACE_OBJECTS.has(o?.name) ? security : rest).push(o);
  return [...security, ...rest];
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
  const report: DanglingReferenceReport = {
    scanned: 0, dangling: [], undetermined: 0, unreadableObjects: [], truncatedObjects: [],
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

  objects: for (const obj of prioritise(all)) {
    if (report.scanned >= maxRows) break;
    // Called off before this object was read: it was never attempted, so it is
    // not a finding about the object — the run reports that it stopped instead.
    if (calledOff()) { report.aborted = true; break; }
    const name = obj?.name;
    if (!name || (only && !only.has(name))) continue;
    const refFields = auditableReferenceFields(obj);
    if (refFields.length === 0) continue;   // nothing referential here — read nothing

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
      // findings (#4747).
      if (calledOff()) { report.aborted = true; break; }
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
      for (const { name: field, target } of refFields) {
        const raw = row?.[field];
        if (isEmptyStoredReference(raw)) continue;
        const values = Array.isArray(raw) ? raw : [raw];
        for (const v of values) {
          if (isEmptyStoredReference(v)) continue;
          // An expanded record in the slot is a read shape, not an id write.
          if (typeof v === 'object') continue;
          const answer = await exists(target, v);
          if (answer === 'called-off') { report.aborted = true; break objects; }
          if (answer === null) { report.undetermined++; continue; }
          if (answer) continue;
          report.dangling.push({
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

  if (report.dangling.length || report.undetermined || report.unreadableObjects.length) {
    port.warn?.('[integrity] stored references that resolve to nothing (#4551)', {
      scanned: report.scanned,
      dangling: report.dangling.length,
      undetermined: report.undetermined,
      unreadableObjects: report.unreadableObjects,
      truncatedObjects: report.truncatedObjects,
      // Carried into the log line too: findings from a run that stopped early
      // are real, but its silence about everything else is not a verdict.
      aborted: report.aborted,
      references: report.dangling.map(
        (d) => `${d.objectName}#${d.recordId}.${d.field} → ${d.target}#${d.value}`,
      ),
    });
  }
  return report;
}
