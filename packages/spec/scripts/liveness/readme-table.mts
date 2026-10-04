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
// WHY THE ARTIFACT IS A DIRECTORY (#20361). #7377 made the numbers one generated
// file with a row per type AND a shared total row. `merge=os-regen` defers that
// file only in a LOCAL merge; GitHub's server-side merge — the one that decides a
// PR's `mergeable` state and builds the ref CI runs on — runs no custom driver. So
// every PR that moved a verdict rewrote the one total row, any two of them in
// flight conflicted on it, and the moment one landed every other went `dirty` and
// got no CI run at all. When the two deltas happened to be EQUAL the text merge
// was worse than a conflict: both sides wrote the same total, git took it once,
// and the merged table published a total short by one side's move. So the counts
// are sharded one file per governed type (`state-counts/<type>.md`, the
// `.gitattributes` cure its header already names), each shard carries only its
// own row, and NO total is committed — the gate sums the shards when it reads
// them. Two PRs that move different types now touch disjoint files; a same-type
// pair still conflicts on that type's one row, which is the residue sharding
// cannot remove and the local driver still owns.
//
// This module therefore serves two reconciliations over one parse:
//
//   - `reconcileReadmeTable` — the row set against `GOVERNED` (#7257, unchanged);
//   - `reconcileStateCounts` — every shard against the gate's own report, the
//     README's row set against the shards', and the README against a count
//     column coming back (#7377, sharded at #20361).
//
// STILL NOT CHECKED, and it must stay that way: the Notes cell's CONTENT. A
// manufactured Note is worse than a missing row.

import { reconcileTextShardDir } from '../lib/sharded-artifacts';

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
 * The count columns, as a generated artifact (#7377), sharded (#20361)
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Where the generated counts live, relative to the ledger root: a DIRECTORY
 * holding one `<type>.md` shard per governed type, and nothing else (#20361).
 */
export const STATE_COUNTS_DIR = 'state-counts';

/** Its repo-relative path, for failure messages a reader can open. */
export const STATE_COUNTS_PATH = `packages/spec/liveness/${STATE_COUNTS_DIR}/`;

/**
 * The single file the shards replaced. Named for exactly one live reason: a
 * branch cut before #20361 still carries it, and a merge of `main` into that
 * branch meets it as a modify/delete. Kept, it would publish a stale table and a
 * stale total beside the shards, and nothing would re-render it — so its presence
 * is an artifact error, and the generator deletes it.
 */
export const LEGACY_STATE_COUNTS_FILE = 'state-counts.md';

/** The one command that rewrites it. Named in every failure below. */
export const STATE_COUNTS_GEN_COMMAND = 'pnpm --filter @objectstack/spec gen:liveness-counts';

/** The shard file that carries one governed type's row. */
export function stateCountShardName(type: string): string {
  return `${type}.md`;
}

/**
 * The status columns the table publishes, in the order it publishes them.
 * `live-elsewhere` is the deliberate fifth (#13483): dead here by measurement,
 * genuinely enforced in a sibling repo — a verdict that must read as NOT
 * deletable, for a key whose load side belongs to this repo's loader, which
 * does not enforce it. The gate does not refuse `live` on cloud-only evidence
 * (the boundary pin in check-liveness.test.ts); this status's own executable
 * criteria live in elsewhere.mts. Widening this list is an
 * artifact-shape decision (#7377): `StateCountsRow`, `foldStateCounts` and
 * `renderStateCountShard` name every column by hand — move all of them together
 * with this line, then regenerate.
 */
export const STATUS_COLUMNS = ['live', 'experimental', 'live-elsewhere', 'dead', 'planned'] as const;
export type StatusColumn = (typeof STATUS_COLUMNS)[number];

/** One governed type's counts, exactly as `types.<type>.byStatus` reports them. */
export interface StateCountsRow {
  type: string;
  live: number;
  experimental: number;
  'live-elsewhere': number;
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
      'live-elsewhere': b['live-elsewhere'] ?? 0,
      dead: b.dead ?? 0,
      planned: b.planned ?? 0,
    };
  });
}

/**
 * The fold's own blind spot, made ARITHMETIC (#13083).
 *
 * `foldStateCounts` above reads the published names and nothing else, so a `byStatus`
 * bucket it cannot name — a ledger row written `"status": "planed"` — is dropped
 * on the floor. Every check downstream then agrees with every other, because
 * they are all reading the same understated fold: `renderStateCountShard` computes
 * the `classified` column as the SUM OF THE FOUR COLUMNS BESIDE IT, the
 * freshness leg compares those bytes against a re-render of the same fold, and
 * the README agrees with that. The published total is smaller than the ledger by
 * exactly the typo'd population and nothing in the gate can say so — a reading
 * that cannot come back wrong because the thing it reads is invisible to it.
 *
 * The fix is a SECOND, INDEPENDENT source for that number. `cat.classified` is
 * counted by its own `++` in the walk, one per classified property, never
 * through the `byStatus` map — so binding the artifact's total to it is the one
 * comparison in this file whose two sides cannot be the same measurement twice.
 *
 * Deliberately NOT an "other" column. That would change what the artifact
 * PUBLISHES — a fifth column, new bytes, a re-render of every row — and the
 * defect here is that the gate cannot SEE a dropped status, not that the table
 * should carry one. This leg leaves `renderStateCountShard` byte-identical and adds
 * a reading; the file's idiom for "a population the artifact must not hide" is a
 * `reconcile*` returning named errors (see `reconcileStateCounts`, and the
 * heading rule its interface states), not a wider table.
 *
 * Two failures reach here and only one of them is a typo:
 *   • a bucket outside `STATUS_COLUMNS` — the #13083 case, named row by row;
 *   • a status ADDED to `STATUS_COLUMNS` without a matching field on
 *     `StateCountsRow` — accepted by the data-side guard in check-liveness.mts
 *     precisely because it IS published vocabulary, and dropped here anyway.
 *     Nothing else in either file catches that one.
 *
 * A `byStatus` key that is not a governed TYPE is not this leg's population: the
 * row set is reconciled against `GOVERNED` separately (#7257), and both callers
 * build `governed` from the same report they build `byStatus` from, so the case
 * cannot arise here without arising there first. One population per heading.
 */
export function reconcileStateCountTotals({
  governed,
  byStatus,
  classified,
}: {
  /** The governed type list the fold renders, in its order. */
  governed: readonly string[];
  /** The gate's `types.<type>.byStatus`, exactly as the fold reads it. */
  byStatus: Readonly<Record<string, Readonly<Record<string, number>> | undefined>>;
  /** The gate's `types.<type>.classified` — the walk's own counter, not derived from `byStatus`. */
  classified: Readonly<Record<string, number | undefined>>;
}): string[] {
  const named = new Set<string>(STATUS_COLUMNS);
  const errors: string[] = [];

  for (const row of foldStateCounts(governed, byStatus)) {
    const columnSum = STATUS_COLUMNS.reduce((a, c) => a + row[c], 0);
    const walked = classified[row.type] ?? 0;
    if (columnSum === walked) continue;

    const unnamed = Object.entries(byStatus[row.type] ?? {}).filter(([s]) => !named.has(s));
    errors.push(
      `${row.type} — ${STATE_COUNTS_DIR}/${stateCountShardName(row.type)} publishes ${columnSum} classified, ` +
        `the walk counted ${walked}` +
        (unnamed.length
          ? `; ${unnamed.map(([s, n]) => `${n} in \`${s}\``).join(', ')} — not one of ${STATUS_COLUMNS.join(' / ')}`
          : '; no unnamed status accounts for the gap — the fold and the walk have come apart for another reason'),
    );
  }

  return errors;
}

/** The prescription printed under a total that does not reconcile. */
export const STATE_COUNTS_TOTALS_GUIDANCE = [
  `The count columns are a FOLD of the ${STATUS_COLUMNS.length} published status names, and this is the`,
  'arithmetic that says the fold dropped something (#13083). It is NOT a stale-artifact',
  `failure, and \`${STATE_COUNTS_GEN_COMMAND}\` is not the repair: the generator folds through`,
  'exactly the same names, so it would only re-publish the same understated total.',
  '',
  'Read the buckets named above:',
  '',
  `  • a MISSPELLED status in a ledger — the ordinary case. Fix the value in`,
  '    packages/spec/liveness/<type>.json; the unrecognized-status failure above names',
  '    the offending row. Never add the misspelling to STATUS_COLUMNS to get green.',
  '',
  '  • a status DELIBERATELY added to STATUS_COLUMNS — then the vocabulary grew and',
  '    the fold did not. `StateCountsRow`, `foldStateCounts` and `renderStateCountShard`',
  '    all name every column by hand, and a new one publishes as a COLUMN, which',
  '    changes what the artifact contains. That is an artifact-shape decision (#7377):',
  '    make it deliberately, move all the named sites together, and regenerate —',
  '    `live-elsewhere` (#13483) is the precedent to copy.',
  '',
  '⛔ Never satisfy this by editing the artifact. The number it publishes is not the',
  'one in dispute — the population behind it is.',
];

/**
 * Render ONE governed type's shard. The generator writes these; the gate renders
 * them again and compares BYTES, shard by shard.
 *
 * Byte comparison, deliberately not a second parser — #5107's rule, and the
 * reason it is a rule: two implementations of the same truth eventually disagree,
 * and the one that wins is whichever the gate happens to call, which is how a
 * green check ends up standing over a wrong file. Regeneration is WHOLESALE; this
 * function never patches a number in place and neither should anyone.
 *
 * Everything in a shard is about its own type and nothing else (#20361). That is
 * the whole locality claim: a line naming a sibling type, the governed-type count
 * or a total would be a line two PRs moving different types both rewrite, which
 * is exactly the conflict the shard exists to remove. So the prose names only
 * this type, links the README without the heading anchor (that anchor carries
 * the governed-type count), and the total is left to the reader that sums.
 */
export function renderStateCountShard(row: StateCountsRow): string {
  return [
    '<!-- GENERATED — DO NOT EDIT BY HAND. -->',
    `<!-- Regenerate: ${STATE_COUNTS_GEN_COMMAND} -->`,
    '',
    `# \`${row.type}\` — liveness counts (generated)`,
    '',
    `This type's row of the liveness state table, computed by the gate that enforces`,
    'it (`scripts/liveness/check-liveness.mts --json`, `types.<type>.byStatus`). Its',
    `Notes prose is the \`${row.type}\` row of [the ledger README](../README.md), which`,
    'also states the counting method. One file per governed type, and no total is',
    'committed anywhere: `check:liveness` sums the shards when it reads them.',
    '**Never hand-patch a number here** — fix the ledger or the schema and regenerate.',
    '',
    '| Type | live | exp | elsewhere | dead | planned | classified |',
    '|---|---|---|---|---|---|---|',
    `| \`${row.type}\` | ${row.live} | ${row.experimental} | ${row['live-elsewhere']} | ${row.dead} | ` +
      `${row.planned} | ${classifiedOf(row)} |`,
    '',
  ].join('\n');
}

/** Every shard, keyed by its file name, in `GOVERNED` order. */
export function renderStateCountShards(rows: readonly StateCountsRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    const name = stateCountShardName(row.type);
    if (out.has(name)) throw new Error(`two governed rows render the same shard ${name} — GOVERNED lists a type twice`);
    out.set(name, renderStateCountShard(row));
  }
  return out;
}

/** The `classified` column: the published status columns, summed. */
function classifiedOf(row: Omit<StateCountsRow, 'type'>): number {
  return STATUS_COLUMNS.reduce((a, c) => a + row[c], 0);
}

/** The table's total, which no file carries any more — summed where it is read. */
export interface StateCountsTotal {
  live: number;
  experimental: number;
  'live-elsewhere': number;
  dead: number;
  planned: number;
  classified: number;
}

/**
 * Sum the rows at READ time (#20361). This is the number the single-file artifact
 * used to commit as its `**total**` row — the one line every liveness PR rewrote,
 * so the one line any two of them conflicted on. It is computed by whoever needs
 * it, from the same fold the shards are rendered from, and written nowhere.
 */
export function sumStateCounts(rows: readonly StateCountsRow[]): StateCountsTotal {
  const total: StateCountsTotal = { live: 0, experimental: 0, 'live-elsewhere': 0, dead: 0, planned: 0, classified: 0 };
  for (const row of rows) {
    for (const c of STATUS_COLUMNS) total[c] += row[c];
    total.classified += classifiedOf(row);
  }
  return total;
}

/** `940 live · 5 experimental · … = 1103 classified` — one line, column order. */
export function formatStateCountsTotal(total: StateCountsTotal): string {
  return `${STATUS_COLUMNS.map((c) => `${total[c]} ${c}`).join(' · ')} = ${total.classified} classified`;
}

/** What `reconcileStateCounts` found. Separate from `ReadmeReconciliation` on purpose — one population per failure heading. */
export interface StateCountsReconciliation {
  /** A shard is absent, stale or stray, the directory is gone, or the retired single file came back. */
  artifactErrors: string[];
  /** The README's row set and the shards' disagree, in either direction. */
  rowSetErrors: string[];
  /** A count column has come back into the README — a hand-maintained number in the merge path again. */
  handCountErrors: string[];
}

/** A cell that is a bare count, or the `–` this table used for "none of these". */
const COUNT_CELL_RE = /^(\d+|[–—-])$/;

/**
 * Reconcile the generated shards against the gate, and the README against the
 * shards.
 *
 * Three legs, and each fails for a reason the other two cannot see:
 *
 *   A. FRESHNESS — every shard equals what the gate measures right now, no shard
 *      is missing, nothing else sits in the directory, and the retired single
 *      file is gone. This is the leg the hand-edit used to buy for free: touching
 *      a schema forced you back through the table to confirm the Note beside the
 *      number still held. It still does, and the failure says so — `gen:` then
 *      READ the diff. A STRAY shard fails too: a type that left `GOVERNED` would
 *      otherwise keep publishing its last counts, beside rows that no longer
 *      include it, and nobody would re-render them.
 *   B. ROW SET — every rendered shard has a README row and back. The README's rows
 *      are reconciled against `GOVERNED` separately (#7257) and the shards are
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
  legacyOnDisk,
}: {
  /** The parsed README section — rows and their cells. */
  table: ParsedStateTable;
  /** What `renderStateCountShards` produces from the gate's report right now. */
  rendered: ReadonlyMap<string, string>;
  /** The shard directory as `readTextShardDir` reads it, or `null` when it does not exist. */
  onDisk: ReadonlyMap<string, string> | null;
  /** Whether the retired single-file artifact is still on disk beside the shards. */
  legacyOnDisk: boolean;
}): StateCountsReconciliation {
  const artifactErrors: string[] = [];
  const rowSetErrors: string[] = [];
  const handCountErrors: string[] = [];

  const shards = reconcileTextShardDir({ displayDir: STATE_COUNTS_PATH, rendered, onDisk });
  if (shards.missingDir) {
    artifactErrors.push(`${STATE_COUNTS_PATH} is MISSING — the table's numbers are published by nothing.`);
  }
  for (const p of shards.missing) {
    artifactErrors.push(`${p} is MISSING — a governed type whose counts nothing publishes.`);
  }
  for (const { name, onDisk: current, expected } of shards.stale) {
    artifactErrors.push(
      `${name} is STALE — it does not match what the gate measures right now.\n` +
        `    ${firstStateCountsDifference(current, expected)}`,
    );
  }
  for (const p of shards.stray) {
    artifactErrors.push(
      `${p} is STRAY — no governed type renders it. The directory is generator-owned: a type ` +
        'that left GOVERNED, or a file written by hand, and either way numbers nothing re-renders.',
    );
  }
  if (legacyOnDisk) {
    artifactErrors.push(
      `packages/spec/liveness/${LEGACY_STATE_COUNTS_FILE} is RETIRED — the counts are one shard per ` +
        `governed type under ${STATE_COUNTS_PATH}, and this file's committed total row is the line every ` +
        'liveness PR rewrote. A branch cut before the split keeps it through a merge; delete it.',
    );
  }

  // Leg B reads the shards the gate just RENDERED, not the copies on disk: on a
  // stale shard leg A has already fired, and reconciling against a file we
  // know to be wrong would report the same defect twice under two headings.
  const artifactTypes = [...rendered.values()].flatMap(parseRenderedCountRows);
  const readmeTypes = table.rows.map((r) => r.type);
  const readmeSet = new Set(readmeTypes);
  const artifactSet = new Set(artifactTypes);
  for (const t of artifactTypes) {
    if (!readmeSet.has(t)) {
      rowSetErrors.push(`${t} — counted in ${STATE_COUNTS_DIR}/${stateCountShardName(t)}, no row in the README table`);
    }
  }
  for (const t of readmeTypes) {
    if (!artifactSet.has(t)) rowSetErrors.push(`${t} — a README row with no counts in ${STATE_COUNTS_DIR}/`);
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

/** The type names a rendered shard publishes, in its own order. */
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

/** The prescription printed under a stale, missing or stray shard. */
export const STATE_COUNTS_GUIDANCE = [
  `The count columns are GENERATED (#7377), one shard per governed type. Regenerate`,
  'them, wholesale — the generator rewrites only the shards whose counts moved and',
  'prunes anything else in the directory:',
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
  '⛔ Never hand-patch a number in a shard, never commit a total, and never put a',
  'count column back into the README table. All three put the numbers back in the',
  'merge path, where they merge clean and wrong (#5107) or conflict for every PR',
  'in flight at once.',
];
