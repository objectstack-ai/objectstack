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
// WHAT IT DOES NOT CHECK, deliberately: the count COLUMNS and the Notes cell. The
// counts are regenerated from `check-liveness.mts --json` (the method fixed in
// #4488) and the Notes cell is hand-written measurement — "how this type got where
// it is", the one part of the table a script cannot author. Holding the numbers to
// the gate is a separate, larger job than holding the ROW SET to `GOVERNED`, and
// conflating them would have made this check unlandable. Presence is the claim the
// heading makes; presence is what this resolves.

/** One parsed row of the "Current state" table. */
export interface StateTableRow {
  /** The type named in the row's first cell. */
  type: string;
  /** 1-based line number in the README — so a failure can be opened, not hunted. */
  line: number;
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

    const first = line.slice(1).split('|')[0].trim();
    if (first === 'Type') continue;                 // the header row
    if (SEPARATOR_CELL_RE.test(first)) continue;    // the `|---|` rule
    if (TYPE_CELL_RE.test(first)) { result.rows.push({ type: first, line: i + 1 }); continue; }
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
