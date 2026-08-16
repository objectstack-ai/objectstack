// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The report shape + renderer for the stored-metadata canonicalization pass
 * (#4327), the follow-up to #3903's read-path guarantee.
 *
 * #4317 closed the correctness gap from the read side: every stored-row
 * rehydration seam replays the full ADR-0087 conversion chain
 * (`applyConversionsToStoredItem`, retired entries included), so a row written
 * under any past protocol is *served* canonical forever. What it deliberately
 * did not do is make the rows themselves canonical — a pre-17 row keeps its
 * legacy bytes, the chain re-lowers it on every load, and each affected row
 * emits one conversion notice per process.
 *
 * {@link ObjectStackProtocolImplementation.migrateStoredMetadata} is the
 * operator-run pass that ends that: same chain, same policy, but the result is
 * written back through the normal write path so the row stops carrying the old
 * dialect. This module owns the vocabulary that pass reports in, kept beside
 * the types rather than in the CLI so an admin route renders the same run the
 * same way.
 *
 * **Not load-bearing.** #3855's conclusion still holds — an operator-run
 * migration cannot be relied on, so the read path stays the guarantee and
 * nothing gates on this having run. No `sys_migration` flag is recorded for
 * exactly that reason: a flag row would advertise a gate that does not exist.
 * The verifiable statement operators wanted is the *re-run* — a second pass
 * that reports every row canonical is the evidence, and it costs one command.
 */

/**
 * What a caller with a live automation engine hands back for a stored `flow`
 * body (#4454) — structurally `AutomationEngine.canonicalizeStoredFlow`'s
 * result, declared here so `metadata-protocol` states the contract it consumes
 * without depending on the automation service.
 *
 * `storable` is the shape to PERSIST: conversions plus the `{dialect, source}`
 * envelopes the flow schema derives for edge conditions, and deliberately not
 * the schema's defaults — persisting a default the author never wrote would pin
 * that row to today's value while untouched rows follow tomorrow's.
 */
export interface StoredFlowCanonicalization {
  /** The canonical body to write back. Identical (by reference) to the input when nothing changed. */
  storable: unknown;
  /** Conversions that fired, in the spec's notice shape. */
  notices: Array<{
    conversionId: string;
    surface: string;
    from: string;
    to: string;
    path: string;
    message: string;
  }>;
  /**
   * Renames the guard REFUSED because the old token is a live name owned by
   * something else. A non-empty list fails the row loudly — rewriting would
   * clobber that owner, and skipping quietly would hide it.
   */
  conflicts: Array<{ conversionId: string; token: string; path: string; message: string }>;
}

/** What the pass did with (or would do with) one `sys_metadata` row. */
export type StoredMigrationOutcome =
  /** The chain was a no-op — the row is already on protocol. Not itemised. */
  | 'canonical'
  /** Preview: the chain would rewrite this row. Nothing was written. */
  | 'pending'
  /** Apply: the canonical body was re-saved through the write path. */
  | 'rewritten'
  /** Outside this pass's reach — see {@link StoredMigrationRow.reason}. */
  | 'skipped'
  /** The row could not be read, or the re-save was refused. */
  | 'failed';

/**
 * One conversion the chain applied to a row — the per-row detail a preview
 * run prints, flattened from the spec's {@link ConversionNotice} to the
 * fields an operator acts on.
 */
export interface StoredMigrationNotice {
  /** The `MetadataConversion.id` that fired, e.g. `flow-node-crud-filter-alias`. */
  conversionId: string;
  /** Dotted surface the conversion governs, e.g. `object.field.conditionalRequired`. */
  surface: string;
  /** The off-spec token/shape found in the stored body. */
  from: string;
  /** The canonical token/shape it was lowered to. */
  to: string;
  /** Where in the item it applied, e.g. `objects[0].fields.amount`. */
  path: string;
  /** The chain's own human-facing line. */
  message: string;
}

/** Per-row result. Rows the chain left alone (`canonical`) are counted, not listed. */
export interface StoredMigrationRow {
  /** `sys_metadata.id` — the row this is about, so an operator can go look at it. */
  id: string;
  /** Singular metadata type (`object`, `view`, …), normalized from the row's spelling. */
  type: string;
  name: string;
  /** `null` = the env-wide overlay bucket. */
  organizationId: string | null;
  /** `null` = a package-less (global) overlay row. */
  packageId: string | null;
  state: 'active' | 'draft';
  outcome: StoredMigrationOutcome;
  /** The conversions this row carries. Empty unless the chain rewrote something. */
  notices: StoredMigrationNotice[];
  /** Why a `skipped` / `failed` row was not rewritten. Absent otherwise. */
  reason?: string;
}

/** The whole run. `apply: false` is a preview — it writes nothing, by construction. */
export interface StoredMigrationReport {
  /** False = preview. A preview never writes, not even a row it would leave identical. */
  apply: boolean;
  /** The protocol version the chain canonicalized *to* — what a clean run attests. */
  protocol: string;
  /** Rows examined (after any `--type` filter; archived/deprecated rows are not read). */
  scanned: number;
  /** Rows the chain left unchanged — already on protocol. */
  canonical: number;
  /** Preview only: rows the chain would rewrite. Always 0 on an apply run. */
  pending: number;
  /** Apply only: rows re-saved through the write path. */
  rewritten: number;
  skipped: number;
  failed: number;
  /** Every row that is not `canonical`, in scan order. */
  rows: StoredMigrationRow[];
}

/**
 * Is this deployment's stored metadata on protocol?
 *
 * True when nothing is left to convert and nothing was refused. `skipped` rows
 * deliberately do NOT count against it: they name a seam that owns them
 * (flows canonicalize at `AutomationEngine.registerFlow`), a type this pass has
 * no history-recording write path for, or (#8957) a row whose STORED `type`
 * spelling is non-canonical. None is work this command left half-done — each is
 * outside what a body-canonicalization pass can do. They are still printed, so
 * the operator sees what the verdict does not cover.
 *
 * ⚠️ The third one is a carve-out with a sharper edge than the other two, and
 * it is deliberate. A non-canonical stored `type` is real residue: the row sits
 * in a second namespace, the batch publish refuses it (`STORED_TYPE_NOT_CANONICAL`),
 * and this pass cannot fix it, because rewriting a stored type is an identity
 * move rather than a body edit (#8908's option (b), explicitly unruled). Making
 * it flip this verdict would give `os migrate meta --stored` a non-zero exit
 * that no run of that command could ever clear — a gate failing on a condition
 * its own tool has no lever for. So it reports, loudly and per row, and leaves
 * the verdict to mean what it has always meant: nothing left to CONVERT.
 */
export function storedMigrationClean(report: StoredMigrationReport): boolean {
  return report.pending === 0 && report.failed === 0;
}

/** Render a run for a terminal. One line per non-canonical row, notices nested. */
export function formatStoredMigrationReport(report: StoredMigrationReport): string[] {
  const lines: string[] = [];
  lines.push(
    `Examined ${report.scanned} stored metadata row(s) (active + draft, all orgs) ` +
      `against the protocol ${report.protocol} conversion chain.`,
  );

  const converting = report.rows.filter((r) => r.outcome === 'pending' || r.outcome === 'rewritten');
  if (converting.length > 0) {
    lines.push(
      report.apply
        ? `✓ Rewrote ${report.rewritten} row(s) carrying a pre-protocol shape:`
        : `→ ${report.pending} row(s) carry a pre-protocol shape and would be rewritten:`,
    );
    for (const row of converting) {
      lines.push(`  • ${row.type}/${row.name} ${describeScope(row)}`);
      for (const n of row.notices) {
        lines.push(`      ${n.conversionId}: ${n.from} → ${n.to} at ${n.path}`);
      }
    }
  }

  const skipped = report.rows.filter((r) => r.outcome === 'skipped');
  if (skipped.length > 0) {
    // The header states only what is true of EVERY skip class. It used to add
    // "they keep reading through the chain", which held for the two carve-outs
    // that existed then and is false for #8957's: a row in a second namespace
    // is not read through the chain on its canonical type — it is not read at
    // all. Each row's own reason carries the specific truth.
    lines.push(`⚠ ${skipped.length} row(s) are outside this pass — each row's reason says why:`);
    for (const row of skipped) {
      lines.push(`  • ${row.type}/${row.name} ${describeScope(row)} — ${row.reason ?? 'skipped'}`);
    }
  }

  const failed = report.rows.filter((r) => r.outcome === 'failed');
  if (failed.length > 0) {
    lines.push(`✗ ${failed.length} row(s) could not be rewritten:`);
    for (const row of failed) {
      lines.push(`  • ${row.type}/${row.name} ${describeScope(row)} — ${row.reason ?? 'failed'}`);
    }
  }

  if (report.scanned === 0) {
    // "Nothing to convert" and "nothing was looked at" are different claims,
    // and only the first is a pass. A run pointed at the wrong project — the
    // database line above names which one — would otherwise read as clean.
    lines.push(
      '⚠ No rows were examined, so this run attests nothing. An empty result is what ' +
        'a deployment that has never authored metadata looks like, and also what running ' +
        'from the wrong project root looks like — check the database named above.',
    );
  } else if (converting.length === 0 && failed.length === 0) {
    lines.push(
      `✓ Every row examined is already on protocol ${report.protocol} — ` +
        'the read-path conversion pass is a no-op here.',
    );
  }
  return lines;
}

/** `[org=… package=… draft]` — only the parts that are not the default. */
function describeScope(row: StoredMigrationRow): string {
  const parts: string[] = [];
  parts.push(row.organizationId ? `org=${row.organizationId}` : 'env-wide');
  if (row.packageId) parts.push(`package=${row.packageId}`);
  if (row.state === 'draft') parts.push('draft');
  return `[${parts.join(', ')}]`;
}
