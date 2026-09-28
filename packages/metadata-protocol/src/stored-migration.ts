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

import { ALL_CONVERSIONS } from '@objectstack/spec';

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

/**
 * One site the chain recognised as a pre-protocol shape and LEFT AS STORED,
 * because no conversion can rewrite it without changing what it means —
 * flattened from the spec's `ConversionTodoNotice` to the fields an operator
 * acts on. ADR-0087 D3's model: conversion where lossless, a structured TODO
 * otherwise — never silence. A TODO emits no conversion notice, so without
 * this list the row would read as already on protocol.
 */
export interface StoredMigrationTodo {
  /** The `MetadataConversion.id` whose surface the site is on. */
  conversionId: string;
  /** Dotted surface that conversion governs. */
  surface: string;
  /** The pre-protocol shape left in the stored body. */
  from: string;
  /** Where in the item the site is, e.g. `pages[0].regions[0].components[1].properties.filter`. */
  path: string;
  /** Why no lossless rewrite exists — the block and the part that blocks it — and what the hand rewrite must decide. */
  reason: string;
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
  /**
   * The sites the chain left as stored for a hand rewrite. Empty unless a
   * conversion reported one. Orthogonal to `outcome`: a row can convert one
   * site and leave another (`pending` / `rewritten` / `failed` with TODOs), or
   * carry nothing but TODOs — then there is nothing to persist, and the row is
   * `skipped`, never `canonical` (see {@link storedMigrationClean}).
   */
  todos: StoredMigrationTodo[];
  /** Why a `skipped` / `failed` row was not rewritten. Absent otherwise. */
  reason?: string;
}

/**
 * One stored `decision` node whose evaluation changed meaning at protocol 18
 * (#15429) — LISTED for an operator to review, never rewritten.
 *
 * The shape: a decision with no `config.conditions` list, no `mode`, and two or
 * more out-edges carrying a `condition`. Before protocol 18 such a node took
 * EVERY out-edge whose condition held; it now takes the first one, in the order
 * the flow declares its edges. By maintainer ruling (letter C on #15429) a
 * stored row takes that new meaning on upgrade: `os migrate meta --from 17`
 * writes `mode: 'inclusive'` onto an authored SOURCE of this shape, because the
 * operator asserts the source's age there, and no pass writes it onto a stored
 * row, whose age nothing can assert. So the row is on protocol as it stands
 * — this entry is not residue, it does not make the row `pending`, and it never
 * flips {@link storedMigrationClean}; it is the list an operator reads before
 * and after the upgrade to find the one node in a hundred that MEANT every
 * branch, and declares `mode: 'inclusive'` on it by hand.
 *
 * The predicate is not restated here: {@link collectDecisionModeReview} runs
 * the ADR-0087 D2 entry `flow-decision-mode-inclusive-explicit` itself over the
 * stored body and keeps only where it would write — so this list is, by
 * construction, the set of nodes the `--from 17` chain rewrites in a source.
 */
export interface StoredDecisionModeReview {
  /** `sys_metadata.id` of the flow row. */
  id: string;
  /** The flow's name. */
  name: string;
  /** `null` = the env-wide overlay bucket. */
  organizationId: string | null;
  /** `null` = a package-less (global) overlay row. */
  packageId: string | null;
  state: 'active' | 'draft';
  /** The decision node's `id`. */
  nodeId: string;
  /** The node's `label`, when it has one — what the flow designer shows. */
  nodeLabel?: string;
  /** Where the node sits in the stored body, e.g. `nodes[3]` or `nodes[1].config.body.nodes[0]`. */
  path: string;
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
  /**
   * Stored `decision` nodes that take first-match since protocol 18 and were
   * written before anyone had to say otherwise (#15429, ruling C) — in scan
   * order, whatever each row's outcome, on a preview and an apply run alike.
   * REPORT ONLY: nothing in this list is ever written, and it moves no count
   * and no verdict. See {@link StoredDecisionModeReview}.
   */
  decisionModeReview: StoredDecisionModeReview[];
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
 *
 * A fourth skip class follows the same rule for the same reason: a row whose
 * only finding is a conversion TODO ({@link StoredMigrationRow.todos}) — a site
 * the chain recognised as a pre-protocol shape and left as stored because no
 * lossless rewrite exists (a filter carrying `$or`, say, which a flat rule list
 * cannot spell). This pass has no lever for it BY RULING — the conversion must
 * not flatten it — so it is `skipped`, printed with every site and why, and
 * does not flip this verdict. TODOs never move it in either direction: a row
 * that also converts something stays `pending` / `rewritten` / `failed` exactly
 * as it would without them.
 *
 * The decision review list ({@link StoredMigrationReport.decisionModeReview})
 * is not a skip class and never moves this verdict either: a row it names is ON
 * protocol — by ruling it takes the protocol-18 meaning as stored — so there is
 * nothing for any run of this pass to do about it.
 */
export function storedMigrationClean(report: StoredMigrationReport): boolean {
  return report.pending === 0 && report.failed === 0;
}

/**
 * The ADR-0087 D2 entry whose predicate {@link collectDecisionModeReview} runs
 * (#15429): the conversion `os migrate meta --from 17` replays over authored
 * sources to write `mode: 'inclusive'`.
 */
export const DECISION_MODE_REVIEW_CONVERSION_ID = 'flow-decision-mode-inclusive-explicit';

/**
 * The decision nodes in ONE stored flow body that the review list names — see
 * {@link StoredDecisionModeReview} for what they are and why a stored row
 * keeps them as they are (#15429, ruling C).
 *
 * **One predicate, not two.** The D2 entry's own `apply` runs over
 * `{ flows: [body] }` and only the paths it WOULD write `mode` at are kept; the
 * stack it returns is discarded unread, so nothing here can reach a write, and
 * the entry is copy-on-write, so the body is not touched either. The list is
 * therefore exactly the set a `--from 17` replay rewrites in a source — regions
 * included — with no second statement of "two or more conditioned out-edges"
 * to drift from the first.
 *
 * **Read off the stored body, with no engine.** The entry renames no node type,
 * so it needs no executor registry, and it runs before — and independently of —
 * the flow canonicalizer: a host with no automation service (where the flow row
 * itself is reported `skipped`) and a row that fails to canonicalize still
 * list their decisions. No earlier conversion writes a decision's `mode` or
 * `conditions` or an edge's `condition`, so the stored body and the canonical
 * one give the same answer.
 *
 * ⛔ Throws when the entry is gone from the registry, or names a path of a
 * shape this reader does not know: a list that silently came back empty would
 * tell every deployment "no decision to review". The entry leaves the registry
 * only when the chain floor passes protocol 17 — the upgrade this list serves
 * is then outside the supported window, and the list goes with it.
 */
export function collectDecisionModeReview(
  body: unknown,
): Array<{ nodeId: string; nodeLabel?: string; path: string }> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return [];
  const entry = ALL_CONVERSIONS.find((c) => c.id === DECISION_MODE_REVIEW_CONVERSION_ID);
  if (!entry) {
    throw new Error(
      `the decision review list runs the conversion '${DECISION_MODE_REVIEW_CONVERSION_ID}', and the ` +
        'registry no longer carries it. Remove the review list together with the conversion.',
    );
  }
  const paths: string[] = [];
  entry.apply({ flows: [body as Record<string, unknown>] }, (detail) => {
    paths.push(detail.path);
  });
  return paths.map((path) => {
    const match = /^flows\[0\]\.(.+)\.config\.mode$/.exec(path);
    if (!match) {
      throw new Error(
        `the conversion '${DECISION_MODE_REVIEW_CONVERSION_ID}' reported a path of an unknown shape ` +
          `('${path}'), so the decision review list cannot name the node it is about.`,
      );
    }
    const nodePath = match[1]!;
    const node = readAtPath(body, nodePath) as { id?: unknown; label?: unknown } | undefined;
    const label = typeof node?.label === 'string' && node.label.trim() !== '' ? node.label : undefined;
    return { nodeId: String(node?.id ?? ''), ...(label ? { nodeLabel: label } : {}), path: nodePath };
  });
}

/** Read `nodes[1].config.body.nodes[0]`-style paths — the spelling the conversions emit. */
function readAtPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const step of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
    if (current === null || typeof current !== 'object') return undefined;
    current = step[2] !== undefined
      ? (current as unknown[])[Number(step[2])]
      : (current as Record<string, unknown>)[step[1]!];
  }
  return current;
}

/**
 * Render a run for a terminal. One line per non-canonical row, its notices and
 * its TODOs nested under it — wherever the row is listed, since a TODO rides on
 * a converting, skipped or failed row alike — and one closing line counting
 * the TODOs, so "did it convert my row" is answered by the output itself.
 * A run with no TODO renders exactly as it did before TODOs existed.
 */
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
      pushTodos(lines, row);
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
      pushTodos(lines, row);
    }
  }

  const failed = report.rows.filter((r) => r.outcome === 'failed');
  if (failed.length > 0) {
    lines.push(`✗ ${failed.length} row(s) could not be rewritten:`);
    for (const row of failed) {
      lines.push(`  • ${row.type}/${row.name} ${describeScope(row)} — ${row.reason ?? 'failed'}`);
      pushTodos(lines, row);
    }
  }

  const withTodos = report.rows.filter((r) => r.todos.length > 0);
  if (withTodos.length > 0) {
    const sites = withTodos.reduce((sum, r) => sum + r.todos.length, 0);
    lines.push(
      `☐ TODO: ${sites} site(s) in ${withTodos.length} row(s) are left as stored — no conversion ` +
        'can rewrite them without changing what they mean, so no run of this pass will. Each TODO ' +
        'line above names the site and why; rewrite it by hand.',
    );
  }

  // Printed on a preview and an apply run alike, and beside the "already on
  // protocol" verdict below without contradicting it: these rows ARE on
  // protocol — a stored decision takes the protocol-18 meaning as it stands —
  // and the list is what an operator reviews, not what this pass owes.
  const review = report.decisionModeReview;
  if (review.length > 0) {
    const flowRows = new Set(review.map((r) => r.id)).size;
    lines.push(
      `◆ ${review.length} decision node(s) in ${flowRows} flow row(s) take the FIRST matching branch ` +
        'since protocol 18 — listed for review, never rewritten:',
    );
    for (const r of review) {
      const label = r.nodeLabel ? ` "${r.nodeLabel}"` : '';
      lines.push(`  • flow/${r.name} ${describeScope(r)} — decision '${r.nodeId}'${label} at ${r.path}`);
    }
    lines.push(
      '  Each has two or more out-edges with a condition and no `mode`. Before protocol 18 it took ' +
        'EVERY out-edge whose condition held; it now takes only the first one that holds, in the order ' +
        "the flow declares its edges. Where a node meant every branch, declare `mode: 'inclusive'` on " +
        'it; declaring `mode` either way takes it off this list. No run of this pass writes it.',
    );
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
  } else if (converting.length === 0 && failed.length === 0 && withTodos.length === 0) {
    // Not printed beside a TODO: a site left as stored is exactly a row that is
    // NOT on protocol, and the line would contradict the list above it.
    lines.push(
      `✓ Every row examined is already on protocol ${report.protocol} — ` +
        'the read-path conversion pass is a no-op here.',
    );
  }
  return lines;
}

/** A row's TODOs, nested under its line the way its notices are. */
function pushTodos(lines: string[], row: StoredMigrationRow): void {
  for (const t of row.todos) {
    lines.push(`      TODO ${t.conversionId}: ${t.from} left as stored at ${t.path} — ${t.reason}`);
  }
}

/** `[org=… package=… draft]` — only the parts that are not the default. */
function describeScope(row: Pick<StoredMigrationRow, 'organizationId' | 'packageId' | 'state'>): string {
  const parts: string[] = [];
  parts.push(row.organizationId ? `org=${row.organizationId}` : 'env-wide');
  if (row.packageId) parts.push(`package=${row.packageId}`);
  if (row.state === 'draft') parts.push('draft');
  return `[${parts.join(', ')}]`;
}
