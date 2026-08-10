// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The README state table — the ledger's own index, reconciled against `GOVERNED`.
//
// WHY THIS EXISTS. `packages/spec/liveness/README.md` opens its last section with
// a heading of the form `## Current state — N governed types (complete registry
// coverage)` and one row per governed type. That heading is a COMPLETENESS CLAIM,
// and until this check landed nothing could falsify it: `N` was the count of ROWS,
// not the count of governed types, and the two agreed only by coincidence.
//
// They stopped agreeing. `api` (seeded 2026-08-04, #5271/#5206) and `capability`
// (seeded 2026-08-08, #5961/PR #6540) were both added to `GOVERNED`, both given
// ledgers, both counted by the gate — and neither got a row. The heading still
// said the registry coverage was complete, because the sentence was checked by
// nothing (#7257).
//
// That is the same failure shape this README spends 500 lines warning about, one
// level up. `dashboard.widgets` asserted in prose that its 22 child keys were
// "classified in the DashboardWidgetSchema subtree" — a subtree that never
// existed — and the claim survived a release because PROSE CANNOT FAIL A BUILD
// (#4956). Every other claim in that file eventually got turned into data the
// gate resolves: schema → ledger, ledger → schema, container → declared
// disposition, `GOVERNED` → the metadata-type registry in both directions. The
// file's own index was the last claim still riding on a human reading it.
//
// So the reconciliation is a FOURTH direction, and it fails rather than warns.
// The population is small and exact (one row per governed type), there is no debt
// to amortise once the two missing rows are back-filled, and a warning here would
// re-create the original defect one layer up: this README's own verdict is that a
// permanently-noisy check is a check nobody reads.
//
// WHAT IT DID NOT CHECK, and why that changed at #7377. The count COLUMNS were
// scoped out here on purpose: holding the numbers to the gate was a larger job
// than holding the ROW SET to `GOVERNED`, and conflating them would have made
// this check unlandable — 9 of 30 rows disagreed with `--json` at the time, and
// several Notes cells enumerate their own dead sets BY HAND, so regenerating the
// numbers without re-reading each Note would have left a row saying `dead 6` next
// to a sentence naming four. That is worse than the drift, because the prose is
// the part a reader believes.
//
// #7377 did that per-row reconciliation and then removed the columns from the
// README altogether, on #5107's precedent: hand-maintained counts merge CLEAN AND
// WRONG. Two PRs each move a different row by their own correct delta, the rows
// do not overlap, and git composes a table nobody wrote. So the numbers are a
// generated artifact carrying `merge=os-regen` and the README keeps the Notes
// prose — hand-written measurement, "how this type got where it is", the one part
// of the table a script cannot author.
//
// This module therefore serves two reconciliations over one parse:
//
//   - `reconcileReadmeTable` — the row set against `GOVERNED` (#7257, unchanged);
//   - `reconcileStateCounts` — the artifact against the gate's own report, the
//     README's row set against the artifact's, and the README against a count
//     column coming back (#7377).
//
// STILL NOT CHECKED, and it must stay that way: the Notes cell's CONTENT. A
// manufactured Note is worse than a missing row.

/** One parsed row of the "Current state" table. */
export interface StateTableRow {
  /** The type named in the row's first cell. */
  type: string;
  /** 1-based line number in the README — so a failure can be opened, not hunted. */
  line: number;
  /**
   * Every cell of the row, trimmed, first cell included. Kept so the count-column
   * pin below can see a number coming back into the README without a second parse
   * of the same line (#7377).
   */
  cells: string[];
}

/** The "Current state" section, as data. */
export interface ParsedStateTable {
  /** 1-based line of the `## Current state — N governed types …` heading, or `null` if absent. */
  headingLine: number | null;
  /** `N` as the heading declares it, or `null` when the heading is absent / carries no count. */
  headingCount: number | null;
  /** The heading text verbatim, for the failure message. */
  headingText: string | null;
  /** Every row whose first cell is a type token, in file order. */
  rows: StateTableRow[];
  /**
   * Table lines inside the section that are neither the header, the separator, nor
   * a recognisable type row. Reported rather than skipped: a row this parser cannot
   * see is a row the reconciliation cannot govern, which is the #4956 shape again.
   */
  malformed: string[];
}

export interface ReadmeReconciliation {
  /** A `GOVERNED` type with no row — the #7257 defect itself. */
  missingRows: string[];
  /** A row for a type `GOVERNED` does not contain — the mirror, an orphan row. */
  orphanRows: string[];
  /** The same type claimed by two rows; the row count would then over-state coverage. */
  duplicateRows: string[];
  /** The heading is missing, unparseable, or its `N` disagrees with the row count / `GOVERNED`. */
  headingErrors: string[];
  /** Passed through from the parse so the caller reports one population, not two. */
  malformed: string[];
}

const HEADING_RE = /^##\s+Current state\b/;
const HEADING_COUNT_RE = /(\d+)\s+governed types/;
const SEPARATOR_CELL_RE = /^:?-{3,}:?$/;
const TYPE_CELL_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Parse the README's "Current state" section.
 *
 * The section runs from its own `##` heading to the next `##` heading or EOF, and
 * fenced code blocks inside it are skipped — the documented regeneration snippet
 * contains a `print(f"| {t} | …")` line that is a template for rows, not a row.
 */
export function parseStateTable(markdown: string): ParsedStateTable {
  const lines = markdown.split('\n');
  const result: ParsedStateTable = {
    headingLine: null,
    headingCount: null,
    headingText: null,
    rows: [],
    malformed: [],
  };

  let inSection = false;
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    if (!inSection) {
      if (HEADING_RE.test(line)) {
        inSection = true;
        result.headingLine = i + 1;
        result.headingText = line;
        result.headingCount = Number(line.match(HEADING_COUNT_RE)?.[1] ?? NaN);
        if (Number.isNaN(result.headingCount)) result.headingCount = null;
      }
      continue;
    }

    if (line.startsWith('```')) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (line.startsWith('## ')) break; // the section ended
    if (!line.startsWith('|')) continue;

    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const first = cells[0];
    if (first === 'Type') continue;                 // the header row
    if (SEPARATOR_CELL_RE.test(first)) continue;    // the `|---|` rule
    if (TYPE_CELL_RE.test(first)) { result.rows.push({ type: first, line: i + 1, cells }); continue; }
    result.malformed.push(`line ${i + 1}: ${line.slice(0, 80)}`);
  }

  return result;
}

/**
 * Reconcile the parsed table against `GOVERNED`.
 *
 * Three-way on the heading, and all three legs matter for a different reason:
 * `headingCount === rows.length` is the arithmetic a reader checks by eye and
 * never does; `rows.length === governed.length` is the coverage claim; and
 * `headingCount === governed.length` is the sentence itself. Two of the three
 * agreeing is exactly the state #7257 found — the heading matched the rows, and
 * both were short of the registry.
 */
export function reconcileReadmeTable({
  governed,
  table,
}: {
  governed: readonly string[];
  table: ParsedStateTable;
}): ReadmeReconciliation {
  const rowTypes = table.rows.map((r) => r.type);
  const rowSet = new Set(rowTypes);
  const governedSet = new Set(governed);

  const seen = new Set<string>();
  const duplicateRows: string[] = [];
  for (const r of table.rows) {
    if (seen.has(r.type)) duplicateRows.push(`${r.type} (line ${r.line})`);
    seen.add(r.type);
  }

  const headingErrors: string[] = [];
  if (table.headingLine === null) {
    headingErrors.push(
      'the "## Current state — N governed types" heading is gone — the table this ' +
      'gate reconciles is identified by it',
    );
  } else if (table.headingCount === null) {
    headingErrors.push(
      `the heading carries no "N governed types" count: ${table.headingText}`,
    );
  } else {
    if (table.headingCount !== rowTypes.length) {
      headingErrors.push(
        `heading says ${table.headingCount} governed types, the table has ${rowTypes.length} row(s)`,
      );
    }
    if (table.headingCount !== governed.length) {
      headingErrors.push(
        `heading says ${table.headingCount} governed types, GOVERNED has ${governed.length}`,
      );
    }
  }

  return {
    missingRows: governed.filter((t) => !rowSet.has(t)),
    orphanRows: rowTypes.filter((t) => !governedSet.has(t)).sort(),
    duplicateRows,
    headingErrors,
    malformed: table.malformed,
  };
}

/**
 * The prescription printed under a missing-row failure. It names the ONE thing a
 * script cannot do for you, because that is the whole reason the two rows this
 * check was written for were filed rather than back-filled (#7257).
 */
export const README_TABLE_GUIDANCE = [
  'Every type in GOVERNED needs a row in the README\'s "Current state" table. The',
  'table is the ledger\'s index — it is what a human or an AI reads first to learn',
  'what this ledger covers — and its heading claims complete registry coverage.',
  '',
  'Regenerate the count columns; never hand-edit them:',
  '',
  '  cd packages/spec && npx tsx scripts/liveness/check-liveness.mts --json | python3 …',
  '',
  '(the exact snippet is in the README, above the table; it now prints a SKELETON',
  'row for any governed type that has no row yet, so paste that row in.)',
  '',
  'Then write the Notes cell BY MEASUREMENT, never from a guess. It records how',
  'this type got where it is — the seeding PR, what that PR actually measured,',
  'which keys are dead and why. Do NOT infer one from the counts or from the',
  'type\'s name, and do not write one for somebody else\'s change: a manufactured',
  'Notes cell is the drill section\'s own prohibition ("do not drill by fanning a',
  'parent\'s status out over its children; that manufactures verdicts, which is',
  'worse than the gap") applied to this table. If a Note cannot be honestly',
  'sourced, write the measured counts plus a pointer to the seeding PR and stop.',
];

/** The prescription for the mirror direction — a row no `GOVERNED` entry backs. */
export const README_ORPHAN_ROW_GUIDANCE = [
  'A row for a type that is not in GOVERNED is the same rot as an orphan ledger',
  'row, one level up: it claims coverage of something this gate does not govern,',
  'and it inflates the row count the heading is checked against. Either govern the',
  'type (add it to GOVERNED and seed its ledger) or delete the row.',
];

/* ══════════════════════════════════════════════════════════════════════════
 * The count columns, as a generated artifact (#7377)
 * ══════════════════════════════════════════════════════════════════════════ */

/** Where the generated counts live, relative to the ledger root. */
export const STATE_COUNTS_FILE = 'state-counts.md';

/** Its repo-relative path, for failure messages a reader can open. */
export const STATE_COUNTS_PATH = `packages/spec/liveness/${STATE_COUNTS_FILE}`;

/** The one command that rewrites it. Named in every failure below. */
export const STATE_COUNTS_GEN_COMMAND = 'pnpm --filter @objectstack/spec gen:liveness-counts';

/** The four status columns the table published, in the order it published them. */
export const STATUS_COLUMNS = ['live', 'experimental', 'dead', 'planned'] as const;
export type StatusColumn = (typeof STATUS_COLUMNS)[number];

/** One governed type's counts, exactly as `types.<type>.byStatus` reports them. */
export interface StateCountsRow {
  type: string;
  live: number;
  experimental: number;
  dead: number;
  planned: number;
}

/**
 * Fold the gate's `types.<type>.byStatus` into one row per governed type, in
 * `GOVERNED` order.
 *
 * A type the report does not carry becomes a row of zeroes rather than being
 * skipped: a missing row would make the artifact silently shorter than
 * `GOVERNED`, and "not measured" and "measured as nothing" must not render the
 * same. The row-set reconciliation above is what catches the governance gap; this
 * function must not also hide it.
 */
export function foldStateCounts(
  governed: readonly string[],
  byStatus: Readonly<Record<string, Readonly<Record<string, number>> | undefined>>,
): StateCountsRow[] {
  return governed.map((type) => {
    const b = byStatus[type] ?? {};
    return {
      type,
      live: b.live ?? 0,
      experimental: b.experimental ?? 0,
      dead: b.dead ?? 0,
      planned: b.planned ?? 0,
    };
  });
}

/**
 * Render the whole artifact. The generator writes this; the gate renders it again
 * and compares BYTES.
 *
 * Byte comparison, deliberately not a second parser — #5107's rule, and the
 * reason it is a rule: two implementations of the same truth eventually disagree,
 * and the one that wins is whichever the gate happens to call, which is how a
 * green check ends up standing over a wrong file. Regeneration is WHOLESALE; this
 * function never patches a number in place and neither should anyone.
 */
export function renderStateCounts(rows: readonly StateCountsRow[]): string {
  const total = rows.reduce(
    (a, r) => ({
      type: 'total',
      live: a.live + r.live,
      experimental: a.experimental + r.experimental,
      dead: a.dead + r.dead,
      planned: a.planned + r.planned,
    }),
    { type: 'total', live: 0, experimental: 0, dead: 0, planned: 0 },
  );

  const body = rows.map(
    (r) => `| \`${r.type}\` | ${r.live} | ${r.experimental} | ${r.dead} | ${r.planned} | ${r.live + r.experimental + r.dead + r.planned} |`,
  );

  return [
    '<!-- GENERATED — DO NOT EDIT BY HAND. -->',
    `<!-- Regenerate: ${STATE_COUNTS_GEN_COMMAND} -->`,
    '',
    '# Liveness state table — the counts (generated)',
    '',
    'Every number the [liveness ledger README](./README.md)\'s "Current state" table',
    'used to publish, computed by the gate that enforces them —',
    '`scripts/liveness/check-liveness.mts --json`, `types.<type>.byStatus`, the',
    'counting method fixed in #4488. The Notes prose, which is hand-written',
    'measurement of how each type got where it is, stays in the README and is never',
    'regenerated.',
    '',
    'Split out at #7377 on #5107\'s precedent. Nine of the thirty rows had drifted',
    'from the gate by the time anyone re-ran the documented snippet, and',
    'hand-maintained counts merge in the one way that hides: two PRs each move a',
    'different row by their own correct delta, the rows do not overlap, git merges',
    'them without complaint, and the result is a table nobody wrote down. The',
    'correct resolution was always "recompute from the merged tree", so this path',
    'carries `merge=os-regen` (#4675) and the recomputation is mandatory rather than',
    'remembered. **Never hand-patch a number here** — fix the ledger or the schema',
    'and regenerate.',
    '',
    'Counts are at the gate\'s one-level walk granularity and include the ADR-0010',
    'protection envelope, which the gate auto-classifies `live` on every type that',
    'spreads `MetadataProtectionFields`. See the README\'s counting-method section',
    'for both corollaries.',
    '',
    '| Type | live | exp | dead | planned | classified |',
    '|---|---|---|---|---|---|',
    ...body,
    `| **total** | **${total.live}** | **${total.experimental}** | **${total.dead}** | **${total.planned}** | **${total.live + total.experimental + total.dead + total.planned}** |`,
    '',
  ].join('\n');
}

/** What `reconcileStateCounts` found. Separate from `ReadmeReconciliation` on purpose — one population per failure heading. */
export interface StateCountsReconciliation {
  /** The artifact is absent, or its bytes are not what the gate renders right now. */
  artifactErrors: string[];
  /** The README's row set and the artifact's disagree, in either direction. */
  rowSetErrors: string[];
  /** A count column has come back into the README — a hand-maintained number in the merge path again. */
  handCountErrors: string[];
}

/** A cell that is a bare count, or the `–` this table used for "none of these". */
const COUNT_CELL_RE = /^(\d+|[–—-])$/;

/**
 * Reconcile the generated artifact against the gate, and the README against the
 * artifact.
 *
 * Three legs, and each fails for a reason the other two cannot see:
 *
 *   A. FRESHNESS — the artifact equals what the gate measures right now. This is
 *      the leg the hand-edit used to buy for free: touching a schema forced you
 *      back through the table to confirm the Note beside the number still held.
 *      It still does, and the failure says so — `gen:` then READ the diff.
 *   B. ROW SET — every artifact row has a README row and back. The README's rows
 *      are reconciled against `GOVERNED` separately (#7257) and the artifact is
 *      generated FROM `GOVERNED`, so in a green tree this is implied; it is
 *      checked anyway because "implied by two other checks" is how the heading's
 *      completeness claim survived unfalsifiable for a year.
 *   C. NO HAND COUNTS — a README row whose cells beyond the type name include a
 *      bare number. The whole point of the split is that a number in that file is
 *      back in the merge path, and a re-added column would be *invisible* to legs
 *      A and B: both would stay green while the table published two sets of
 *      numbers, which is strictly worse than the drift #7377 started from.
 */
export function reconcileStateCounts({
  table,
  rendered,
  onDisk,
}: {
  /** The parsed README section — rows and their cells. */
  table: ParsedStateTable;
  /** What `renderStateCounts` produces from the gate's report right now. */
  rendered: string;
  /** The artifact's bytes, or `null` when the file does not exist. */
  onDisk: string | null;
}): StateCountsReconciliation {
  const artifactErrors: string[] = [];
  const rowSetErrors: string[] = [];
  const handCountErrors: string[] = [];

  if (onDisk === null) {
    artifactErrors.push(`${STATE_COUNTS_PATH} is MISSING — the table's numbers are published by nothing.`);
  } else if (onDisk !== rendered) {
    artifactErrors.push(
      `${STATE_COUNTS_PATH} is STALE — it does not match what the gate measures right now.\n` +
        `    ${firstStateCountsDifference(onDisk, rendered)}`,
    );
  }

  // Leg B reads the artifact the gate just RENDERED, not the copy on disk: on a
  // stale artifact leg A has already fired, and reconciling against a file we
  // know to be wrong would report the same defect twice under two headings.
  const artifactTypes = parseRenderedCountRows(rendered);
  const readmeTypes = table.rows.map((r) => r.type);
  const readmeSet = new Set(readmeTypes);
  const artifactSet = new Set(artifactTypes);
  for (const t of artifactTypes) {
    if (!readmeSet.has(t)) rowSetErrors.push(`${t} — counted in ${STATE_COUNTS_FILE}, no row in the README table`);
  }
  for (const t of readmeTypes) {
    if (!artifactSet.has(t)) rowSetErrors.push(`${t} — a README row with no counts in ${STATE_COUNTS_FILE}`);
  }

  for (const row of table.rows) {
    const counts = row.cells.slice(1).filter((c) => COUNT_CELL_RE.test(c));
    if (counts.length) {
      handCountErrors.push(
        `line ${row.line} (${row.type}) — ${counts.length} count cell(s): ${counts.join(', ')}`,
      );
    }
  }

  return { artifactErrors, rowSetErrors, handCountErrors };
}

/** The type names the rendered artifact publishes, in its own order. */
function parseRenderedCountRows(rendered: string): string[] {
  const out: string[] = [];
  for (const line of rendered.split('\n')) {
    const m = line.match(/^\|\s*`([a-z][a-z0-9_]*)`\s*\|/);
    if (m) out.push(m[1]);
  }
  return out;
}

/** The first differing line pair, as `- on disk` / `+ expected`. */
function firstStateCountsDifference(actual: string, expected: string): string {
  const a = actual.split('\n');
  const b = expected.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    return `first difference at line ${i + 1}:\n      - ${a[i] ?? '(end of file)'}\n      + ${b[i] ?? '(end of file)'}`;
  }
  return 'the files differ but no line does — a trailing-newline difference.';
}

/** The prescription printed under a stale or missing artifact. */
export const STATE_COUNTS_GUIDANCE = [
  `The count columns are GENERATED (#7377). Regenerate them, wholesale:`,
  '',
  `  ${STATE_COUNTS_GEN_COMMAND}`,
  '',
  'Then READ the diff. A count that moved means a property entered or left the',
  'walked shape, or a ledger verdict changed — and the Notes cell beside that row',
  'in README.md may now describe a set it no longer has. That re-read is exactly',
  'what the hand-edited number used to force, and it is the half of it worth',
  'keeping: #7377 found `translation` publishing `dead 2` next to a sentence',
  'naming one key, and that key had already been removed.',
  '',
  '⛔ Never hand-patch a number in the artifact, and never put a count column back',
  'into the README table. Both put the numbers back in the merge path, where they',
  'merge clean and wrong (#5107).',
];
