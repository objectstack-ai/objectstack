// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * backfill-sys-file-public-scope — the ONE-OFF rewrite of every stored
 * `sys_file` row whose `scope` is the retired `public` to `user`.
 *
 * ## Why the rows have to move
 *
 * `scope: 'public'` promised a public file and never delivered one: the
 * download doors judge `acl: 'public_read'`, the attachments scope and field
 * ownership alone, so a `public`-scoped file with the default acl needs a
 * signed-in caller like any other. The value is retired (#22443): the upload
 * doors refuse it, the spec's `StorageScopeSchema` refuses it, and the
 * `sys_file.scope` select no longer lists it. Ruling B (#22443, 2026-10-09)
 * settled what happens to the rows already stored with it — they are rewritten
 * to `user`, and this module is that rewrite.
 *
 * Retiring the option alone was measured infeasible: the field-reference copy
 * path (`copyOwnedFile` in `file-reference-lifecycle.ts`) re-inserts the source
 * row's scope on the copy, and the engine refuses an insert carrying a value the
 * select does not declare. So until this sweep runs on a deployment, a record
 * write that names a `public` file another field already owns fails: the
 * engine throws `ERR_FILE_REFERENCE_COPY` around the `invalid_option` refusal
 * on `scope`, and the data REST doors answer it `500 INTERNAL_ERROR` with the
 * sentence withheld from the client (the server logs it). Reads, downloads and
 * scope-free updates of those rows are unaffected. That window is what makes
 * this sweep the upgrade's operator step, not an optional tidy-up.
 *
 * ## Why `user`, and why nothing else changes
 *
 * `user` is the value the copy path itself defaults a missing scope to, and the
 * one the upload doors default an omitted scope to. No reader distinguishes it
 * from `public`: the only scope value any code reads is `attachments` (the
 * download doors, the attachment lifecycle, the orphan inventory, the reference
 * verifier). So the rewrite changes no access behaviour. ONE column is written —
 * `scope` — and nothing else on the row: the storage `key` keeps its `public/`
 * prefix and no byte in the backend moves.
 *
 * ## Counts first, a no-op at zero, idempotent by construction
 *
 * The scan is `WHERE scope = 'public'`, read in full before anything is
 * written; the count is the report's `scanned`. A deployment with no such rows
 * plans nothing and writes nothing. Every write moves its row out of the
 * predicate, so a second run over an unchanged database scans 0 and writes 0.
 * `backfill-sys-file-public-scope.test.ts` asserts all three on a real engine.
 *
 * ## Rollback
 *
 * The inverse is `user` → `public` on exactly the ids an applied run touched —
 * every one of them is listed in the applied report
 * ({@link SysFilePublicScopeBackfillReport.rows}, printed by
 * {@link formatSysFilePublicScopeBackfillReport}), so keep that output. On the
 * release that ships this module the inverse CANNOT be written through the
 * engine: `public` is no longer a declared option, and the engine refuses the
 * write as it refuses any undeclared select value (pinned). That is by design —
 * a stored `public` row on this release is exactly the row a copy cannot be
 * made of. The rollback therefore goes with a code rollback: on the previous
 * release, which still declares the option, write `scope = 'public'` back to
 * the recorded ids (through the engine there, or as one raw driver statement
 * against `sys_file` filtered to those ids).
 *
 * ## Usage
 *
 * An operator step, not a boot hook — the same posture as the organization
 * backfill beside it (`backfill-sys-file-organizations.ts`): run server-side
 * from a context that holds an engine, dry run first and by default. Unlike
 * that backfill, the four functions and their report types ARE exported from
 * the package index: until this sweep runs, a copy of a stored `public` row is
 * refused (above), and a deployment runs the published package, not a source
 * checkout, so the step has to ship in the release that asks for it:
 *
 * ```ts
 * import {
 *   planSysFilePublicScopeBackfill,
 *   applySysFilePublicScopeBackfill,
 *   formatSysFilePublicScopeBackfillReport,
 * } from '@objectstack/service-storage';
 *
 * const plan = await planSysFilePublicScopeBackfill(engine);
 * console.log(formatSysFilePublicScopeBackfillReport(plan));  // writes nothing
 * // …read it, then:
 * const applied = await applySysFilePublicScopeBackfill(engine, plan);
 * console.log(formatSysFilePublicScopeBackfillReport(applied)); // keep it: it is the rollback list
 * ```
 */

/** The ONE object this sweep rewrites. */
export const SYS_FILE_PUBLIC_SCOPE_BACKFILL_OBJECT = 'sys_file';

/** The retired value the scan selects on. */
export const RETIRED_SYS_FILE_SCOPE = 'public';

/**
 * The value written in its place — the copy path's own default for a missing
 * scope, and the upload doors' default for an omitted one.
 */
export const REWRITTEN_SYS_FILE_SCOPE = 'user';

const SCOPE_FIELD = 'scope';
const SYSTEM_CONTEXT = { isSystem: true, positions: [], permissions: [] };
const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_ROWS = 100_000;

/**
 * The engine surface the sweep needs — a structural subset of the ObjectQL
 * engine, declared here so a test can hand it a real engine or a double.
 */
export interface SysFilePublicScopeBackfillEngine {
  find(object: string, options?: unknown): Promise<unknown[]>;
  update(object: string, data: unknown, options?: unknown): Promise<unknown>;
}

/** One row the sweep rewrites, named in full so the dry run is auditable. */
export interface PlannedSysFileScopeRow {
  id: string;
  /** The storage key — reported, never written: it keeps its prefix. */
  key: string | null;
  from: typeof RETIRED_SYS_FILE_SCOPE;
  to: typeof REWRITTEN_SYS_FILE_SCOPE;
}

/** The whole sweep's plan / outcome. */
export interface SysFilePublicScopeBackfillReport {
  /** `true` when nothing was written. */
  dryRun: boolean;
  /** Rows matching `scope = 'public'` at scan time — the count taken before any write. */
  scanned: number;
  /** Rows the sweep would write (dry run) or attempted to write (applied). */
  planned: number;
  /** Rows actually written. Always 0 on a dry run. */
  written: number;
  /** Every planned row; on an applied run, the ids the rollback writes back. */
  rows: PlannedSysFileScopeRow[];
  /** Scanned rows that carry no id the sweep can address — counted, never written. */
  unaddressable: number;
  /** Planned rows whose write threw. Reported, never retried, never fatal. */
  failures: Array<{ id: string; error: string }>;
  /** Conditions a reader must see, e.g. "the scan failed" or "the ceiling was hit". */
  notes: string[];
}

/** Options both halves of the sweep accept. */
export interface SysFilePublicScopeBackfillOptions {
  /**
   * Execution context for every read and write. Defaults to a system context:
   * the sweep has to see rows across every organization.
   */
  context?: unknown;
  /** Rows per page while scanning. */
  pageSize?: number;
  /** Hard ceiling, so a pathological table cannot spin forever; reported when hit. */
  maxRows?: number;
  /**
   * `false` writes. Defaults to `true`: a sweep over existing data that defaults
   * to writing is one typo away from an unplanned migration.
   */
  dryRun?: boolean;
}

function rowId(row: unknown): string | null {
  const raw = (row as Record<string, unknown> | null)?.id;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (typeof raw === 'number') return String(raw);
  return null;
}

/**
 * Build the sweep's plan — the DRY RUN. Reads only; `written` is 0.
 *
 * Paged by `id` so the pages partition the population, and read in full BEFORE
 * anything is written — a plan built while writing would move rows out from
 * under its own offset.
 */
export async function planSysFilePublicScopeBackfill(
  engine: SysFilePublicScopeBackfillEngine,
  options: SysFilePublicScopeBackfillOptions = {},
): Promise<SysFilePublicScopeBackfillReport> {
  const context = options.context ?? SYSTEM_CONTEXT;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const notes: string[] = [];
  const rows: PlannedSysFileScopeRow[] = [];
  let scanned = 0;
  let unaddressable = 0;

  let offset = 0;
  for (; offset < maxRows; offset += pageSize) {
    let page: unknown[];
    try {
      page = await engine.find(SYS_FILE_PUBLIC_SCOPE_BACKFILL_OBJECT, {
        where: { [SCOPE_FIELD]: RETIRED_SYS_FILE_SCOPE },
        fields: ['id', 'key'],
        limit: pageSize,
        offset,
        orderBy: [{ field: 'id', order: 'asc' }],
        context,
      });
    } catch (err) {
      // Named, not thrown: a reader has to be able to tell "no public rows"
      // from "never looked".
      notes.push(
        `scan of '${SYS_FILE_PUBLIC_SCOPE_BACKFILL_OBJECT}' failed — ${String((err as Error)?.message ?? err)}. `
        + 'Nothing was counted; this is not a clean deployment, it is an unread one.',
      );
      break;
    }
    const batch = Array.isArray(page) ? page : [];
    for (const row of batch) {
      scanned += 1;
      const id = rowId(row);
      if (!id) {
        unaddressable += 1;
        continue;
      }
      const key = (row as Record<string, unknown>).key;
      rows.push({
        id,
        key: typeof key === 'string' ? key : null,
        from: RETIRED_SYS_FILE_SCOPE,
        to: REWRITTEN_SYS_FILE_SCOPE,
      });
    }
    if (batch.length < pageSize) break;
  }
  if (offset >= maxRows) {
    notes.push(
      `the scan stopped at its ceiling of ${maxRows} rows — more '${RETIRED_SYS_FILE_SCOPE}' rows may remain. `
      + 'Apply this plan, then run the sweep again: it picks up exactly the rows still matching.',
    );
  }

  return {
    dryRun: true,
    scanned,
    planned: rows.length,
    written: 0,
    rows,
    unaddressable,
    failures: [],
    notes,
  };
}

/**
 * Write the plan: ONE update per planned row, carrying its id and
 * `scope: 'user'` and nothing else — which is what keeps the key and the bytes
 * untouched and the inverse expressible as "write `public` back to these ids".
 *
 * A row whose write throws is RECORDED and the sweep continues: one refused row
 * must not cost the others their rewrite, and a half-done sweep is safe because
 * the next run picks up exactly what still matches.
 *
 * ⛔ Takes a plan rather than building one, so the rows written are the rows a
 * human read in the dry run. A plan with zero rows writes nothing.
 */
export async function applySysFilePublicScopeBackfill(
  engine: SysFilePublicScopeBackfillEngine,
  plan: SysFilePublicScopeBackfillReport,
  options: SysFilePublicScopeBackfillOptions = {},
): Promise<SysFilePublicScopeBackfillReport> {
  const context = options.context ?? SYSTEM_CONTEXT;
  const failures: SysFilePublicScopeBackfillReport['failures'] = [];
  let written = 0;
  for (const row of plan.rows) {
    try {
      await engine.update(
        SYS_FILE_PUBLIC_SCOPE_BACKFILL_OBJECT,
        { id: row.id, [SCOPE_FIELD]: REWRITTEN_SYS_FILE_SCOPE },
        { context },
      );
      written += 1;
    } catch (err) {
      failures.push({ id: row.id, error: String((err as Error)?.message ?? err) });
    }
  }
  return { ...plan, dryRun: false, written, failures };
}

/**
 * Plan, then (only when `dryRun: false`) write — the whole sweep in one call.
 *
 * Idempotent by construction rather than by a guard: every write moves its row
 * out of `scope = 'public'`, so a second call plans nothing and writes nothing.
 */
export async function runSysFilePublicScopeBackfill(
  engine: SysFilePublicScopeBackfillEngine,
  options: SysFilePublicScopeBackfillOptions = {},
): Promise<SysFilePublicScopeBackfillReport> {
  const plan = await planSysFilePublicScopeBackfill(engine, options);
  if (options.dryRun !== false) return plan;
  return applySysFilePublicScopeBackfill(engine, plan, options);
}

/**
 * Render a report as the operator-facing text. On an applied run the listed
 * ids are the rollback list (see the module doc), so the output is worth
 * keeping.
 */
export function formatSysFilePublicScopeBackfillReport(report: SysFilePublicScopeBackfillReport): string {
  const lines: string[] = [];
  lines.push(
    report.dryRun
      ? `sys_file scope '${RETIRED_SYS_FILE_SCOPE}' → '${REWRITTEN_SYS_FILE_SCOPE}' — DRY RUN (nothing written)`
      : `sys_file scope '${RETIRED_SYS_FILE_SCOPE}' → '${REWRITTEN_SYS_FILE_SCOPE}' — APPLIED`,
  );
  lines.push('='.repeat(66));
  lines.push(`scanned (scope = '${RETIRED_SYS_FILE_SCOPE}') : ${report.scanned}`);
  lines.push(`${report.dryRun ? 'would write' : 'written    '}               : ${report.dryRun ? report.planned : report.written}`);
  for (const row of report.rows) {
    const failed = report.failures.find((f) => f.id === row.id);
    lines.push(
      `    ${row.id} scope ${row.from} -> ${row.to} (key ${row.key ?? '(none)'} unchanged)`
      + (failed ? ` ✗ NOT written — ${failed.error}` : ''),
    );
  }
  if (report.unaddressable > 0) {
    lines.push(`  ⚠️  ${report.unaddressable} matching row(s) carry no usable id and were not written`);
  }
  for (const note of report.notes) lines.push(`  ⚠️  ${note}`);
  if (!report.dryRun && report.written > 0) {
    lines.push('');
    lines.push(
      `Rollback: on the previous release, write scope '${RETIRED_SYS_FILE_SCOPE}' back to exactly the ids above `
      + `that were written. This release refuses '${RETIRED_SYS_FILE_SCOPE}' as a sys_file scope.`,
    );
  }
  lines.push('');
  lines.push('-'.repeat(66));
  lines.push(
    `TOTAL scanned=${report.scanned} `
    + `${report.dryRun ? 'would-write' : 'written'}=${report.dryRun ? report.planned : report.written} `
    + `failed=${report.failures.length}`,
  );
  return lines.join('\n');
}
