// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Unit tests for the README state-table reconciliation (#7257) — the liveness
// gate's fourth direction. See readme-table.mts for why it exists.
//
// Same reasoning as orphans.test.ts and drill.test.ts, and it applies harder
// here: once the two missing rows are back-filled the table is COMPLETE, so a
// green `check:liveness` proves nothing about whether this check can fire. That
// proof comes from here (the logic, including every case it must stay quiet on)
// and from check-liveness.test.ts (the real gate, against a mutated copy of the
// real README, reaching a real `process.exit(1)`).

import { describe, it, expect } from 'vitest';
import {
  README_ORPHAN_ROW_GUIDANCE,
  README_TABLE_GUIDANCE,
  STATE_COUNTS_GEN_COMMAND,
  STATE_COUNTS_GUIDANCE,
  STATE_COUNTS_PATH,
  STATE_COUNTS_TOTALS_GUIDANCE,
  STATUS_COLUMNS,
  foldStateCounts,
  parseStateTable,
  reconcileReadmeTable,
  reconcileStateCountTotals,
  reconcileStateCounts,
  renderStateCounts,
} from './readme-table.mts';

/** A miniature README with the same section shape as the real one. */
function readme({
  heading = '## Current state — 3 governed types (complete registry coverage)',
  rows = ['| object | 49 | – | 0 | 1 | notes |', '| field | 66 | 0 | 0 | 0 | notes |', '| api | 25 | 0 | 0 | 2 | notes |'],
  before = '## Adding a type\n\nSome prose.\n\n| Status | Meaning |\n|---|---|\n| `live` | Has a runtime consumer. |\n',
  after = '',
}: { heading?: string; rows?: string[]; before?: string; after?: string } = {}): string {
  return [
    before,
    heading,
    '',
    '| Type | live | exp | dead | planned | Notes |',
    '|---|---|---|---|---|---|',
    ...rows,
    after,
  ].join('\n');
}

describe('parseStateTable', () => {
  it('reads the heading count, the heading line and one row per type', () => {
    const t = parseStateTable(readme());
    expect(t.headingCount).toBe(3);
    expect(t.headingLine).toBeGreaterThan(0);
    expect(t.rows.map((r) => r.type)).toEqual(['object', 'field', 'api']);
    expect(t.malformed).toEqual([]);
  });

  it('ignores the header row and the |---| rule', () => {
    const t = parseStateTable(readme());
    expect(t.rows.map((r) => r.type)).not.toContain('Type');
    expect(t.rows).toHaveLength(3);
  });

  // The boundary that decides whether the parser sees the table or the file. A
  // `## Status vocabulary` table above the section is table-shaped and its rows
  // are NOT governed types; counting them would inflate the row count and make
  // the heading check fire on a correct file.
  it('only reads rows inside the "Current state" section', () => {
    const t = parseStateTable(readme());
    expect(t.rows.map((r) => r.type)).not.toContain('live');
  });

  it('stops at the next ## heading', () => {
    const t = parseStateTable(readme({ after: '\n## Something else\n\n| ghost | 1 | 0 | 0 | 0 |\n' }));
    expect(t.rows.map((r) => r.type)).not.toContain('ghost');
  });

  // The documented regeneration snippet contains `print(f"| {t} | …")`, which is
  // a TEMPLATE for rows. Reading it as a row would make the gate fail on the
  // instructions for fixing it.
  it('skips fenced code blocks — the regeneration snippet is not a row', () => {
    const t = parseStateTable(
      readme({ after: '\n```bash\nfor t in x: print(f"| {t} | 1 | 0 | 0 | 0 |")\n```\n' }),
    );
    expect(t.rows).toHaveLength(3);
    expect(t.malformed).toEqual([]);
  });

  it('reports a table line it cannot read rather than skipping it', () => {
    const t = parseStateTable(readme({ rows: ['| object | 49 | – | 0 | 1 | notes |', '| ??? | 1 | 0 | 0 | 0 |'] }));
    expect(t.rows.map((r) => r.type)).toEqual(['object']);
    expect(t.malformed).toHaveLength(1);
    expect(t.malformed[0]).toContain('???');
  });

  it('records a missing heading as absent rather than throwing', () => {
    const t = parseStateTable('# Spec liveness ledger\n\nNo state section at all.\n');
    expect(t.headingLine).toBeNull();
    expect(t.headingCount).toBeNull();
    expect(t.rows).toEqual([]);
  });

  it('records a heading that carries no count', () => {
    const t = parseStateTable(readme({ heading: '## Current state' }));
    expect(t.headingLine).toBeGreaterThan(0);
    expect(t.headingCount).toBeNull();
  });
});

describe('reconcileReadmeTable — what it must catch', () => {
  const governed = ['object', 'field', 'api'];

  it('is quiet when every governed type has a row and the heading agrees', () => {
    const r = reconcileReadmeTable({ governed, table: parseStateTable(readme()) });
    expect(r).toEqual({
      missingRows: [],
      orphanRows: [],
      duplicateRows: [],
      headingErrors: [],
      malformed: [],
    });
  });

  // #7257 itself: the type is governed, ledgered and counted by the gate, and
  // the index that claims to cover it does not.
  it('catches a governed type with no row', () => {
    const table = parseStateTable(
      readme({ heading: '## Current state — 2 governed types (complete registry coverage)', rows: ['| object | 49 | – | 0 | 1 | n |', '| field | 66 | 0 | 0 | 0 | n |'] }),
    );
    const r = reconcileReadmeTable({ governed, table });
    expect(r.missingRows).toEqual(['api']);
    // ...and the heading's own arithmetic is intact, which is exactly how the
    // real defect stayed invisible: N matched the ROWS and both were short of
    // GOVERNED. Two of the three legs agreeing is not coverage.
    expect(r.headingErrors).toEqual(['heading says 2 governed types, GOVERNED has 3']);
  });

  it('names every missing row, not just the first', () => {
    const r = reconcileReadmeTable({
      governed: [...governed, 'capability', 'qa'],
      table: parseStateTable(readme()),
    });
    expect(r.missingRows).toEqual(['capability', 'qa']);
  });

  it('catches the mirror — a row GOVERNED does not back', () => {
    const table = parseStateTable(
      readme({ heading: '## Current state — 4 governed types (complete registry coverage)', rows: ['| object | 49 | – | 0 | 1 | n |', '| field | 66 | 0 | 0 | 0 | n |', '| api | 25 | 0 | 0 | 2 | n |', '| retired | 1 | 0 | 0 | 0 | n |'] }),
    );
    const r = reconcileReadmeTable({ governed, table });
    expect(r.orphanRows).toEqual(['retired']);
    expect(r.missingRows).toEqual([]);
  });

  // A duplicate would let the row count reach GOVERNED.length while a real type
  // has no row — the heading check alone would pass.
  it('catches a duplicated row', () => {
    const table = parseStateTable(
      readme({ rows: ['| object | 49 | – | 0 | 1 | n |', '| field | 66 | 0 | 0 | 0 | n |', '| field | 66 | 0 | 0 | 0 | n |'] }),
    );
    const r = reconcileReadmeTable({ governed, table });
    expect(r.duplicateRows).toHaveLength(1);
    expect(r.duplicateRows[0]).toContain('field');
    expect(r.missingRows).toEqual(['api']);
  });

  it('catches a heading count skewed away from the rows', () => {
    const t = parseStateTable(readme({ heading: '## Current state — 30 governed types (complete registry coverage)' }));
    const r = reconcileReadmeTable({ governed, table: t });
    expect(r.headingErrors).toEqual([
      'heading says 30 governed types, the table has 3 row(s)',
      'heading says 30 governed types, GOVERNED has 3',
    ]);
  });

  it('fails loudly when the heading is gone', () => {
    const r = reconcileReadmeTable({ governed, table: parseStateTable('# Spec liveness ledger\n') });
    expect(r.headingErrors).toHaveLength(1);
    expect(r.headingErrors[0]).toContain('heading is gone');
    // Every governed type is also missing — the failure is real, not a parse
    // artefact being quietly swallowed.
    expect(r.missingRows).toEqual(governed);
  });

  it('fails when the heading carries no count', () => {
    const r = reconcileReadmeTable({ governed, table: parseStateTable(readme({ heading: '## Current state' })) });
    expect(r.headingErrors).toHaveLength(1);
    expect(r.headingErrors[0]).toContain('no "N governed types" count');
  });

  it('passes malformed table lines through so the caller reports one population', () => {
    const table = parseStateTable(readme({ rows: [...['| object | 49 | – | 0 | 1 | n |', '| field | 66 | 0 | 0 | 0 | n |', '| api | 25 | 0 | 0 | 2 | n |'], '| Total | 140 |'] }));
    const r = reconcileReadmeTable({ governed, table });
    expect(r.malformed).toHaveLength(1);
    expect(r.missingRows).toEqual([]);
  });
});

describe('the prescriptions', () => {
  // The one thing a script cannot do for the author, and the reason #7257 was
  // filed rather than fixed on the spot. If this sentence ever leaves the
  // guidance, the next agent to hit the failure will fabricate a Notes cell.
  it('tells the author to source the Notes cell from measurement, never a guess', () => {
    const text = README_TABLE_GUIDANCE.join('\n');
    expect(text).toContain('Notes cell');
    expect(text).toContain('never from a guess');
    expect(text).toContain('seeding PR');
  });

  it('tells the author both ways out of an orphan row', () => {
    const text = README_ORPHAN_ROW_GUIDANCE.join('\n');
    expect(text).toContain('GOVERNED');
    expect(text).toContain('delete the row');
  });
});

/* ── the count columns as a generated artifact (#7377) ──────────────────────
 *
 * Same argument as the block above, one direction over: on a green tree the
 * artifact is current and the README carries no numbers, so `check:liveness`
 * passing proves nothing about whether these three legs can fire. That proof is
 * here (the logic) and in check-liveness.test.ts (the real gate, against a
 * mutated copy of the real ledger root, reaching a real `process.exit(1)`).
 */

const COUNTS = [
  { type: 'object', live: 49, experimental: 0, 'live-elsewhere': 0, dead: 0, planned: 1 },
  { type: 'field', live: 66, experimental: 0, 'live-elsewhere': 0, dead: 0, planned: 0 },
  { type: 'api', live: 25, experimental: 0, 'live-elsewhere': 0, dead: 0, planned: 2 },
];

/** The 2-column README the split produced — prose only, no numbers. */
function proseReadme(rows = ['| object | notes |', '| field | notes |', '| api | notes |']) {
  return readme({ rows });
}

describe('foldStateCounts', () => {
  it('reads one row per governed type, in GOVERNED order', () => {
    const rows = foldStateCounts(['field', 'object'], {
      object: { live: 49, planned: 1 },
      field: { live: 66 },
    });
    expect(rows.map((r) => r.type)).toEqual(['field', 'object']);
    expect(rows[1]).toEqual({ type: 'object', live: 49, experimental: 0, 'live-elsewhere': 0, dead: 0, planned: 1 });
  });

  // The fifth column (#13483) folds like the other four — a bucket the fold
  // could not name is exactly the #13083 shape this file exists to prevent.
  it('folds a live-elsewhere bucket into its own column', () => {
    const rows = foldStateCounts(['manifest'], {
      manifest: { live: 22, 'live-elsewhere': 1, dead: 15 },
    });
    expect(rows[0]).toEqual({ type: 'manifest', live: 22, experimental: 0, 'live-elsewhere': 1, dead: 15, planned: 0 });
  });

  // "Not measured" and "measured as nothing" must not render the same. A skipped
  // row would make the artifact silently shorter than GOVERNED, which is the
  // completeness shape #7257 was filed about.
  it('renders a type the report does not carry as zeroes rather than skipping it', () => {
    const rows = foldStateCounts(['object', 'ghost'], { object: { live: 49 } });
    expect(rows.map((r) => r.type)).toEqual(['object', 'ghost']);
    expect(rows[1]).toEqual({ type: 'ghost', live: 0, experimental: 0, 'live-elsewhere': 0, dead: 0, planned: 0 });
  });
});

describe('renderStateCounts', () => {
  it('publishes a row per type, a classified column, and a total', () => {
    const out = renderStateCounts(COUNTS);
    expect(out).toContain('| Type | live | exp | elsewhere | dead | planned | classified |');
    expect(out).toContain('| `object` | 49 | 0 | 0 | 0 | 1 | 50 |');
    expect(out).toContain('| **total** | **140** | **0** | **0** | **0** | **3** | **143** |');
  });

  // The fifth column counts into `classified` like the other four (#13483) —
  // an elsewhere-verdict is a CLASSIFIED property, precisely not a gap.
  it('counts live-elsewhere into the row and total classified sums', () => {
    const out = renderStateCounts([
      { type: 'manifest', live: 22, experimental: 0, 'live-elsewhere': 1, dead: 15, planned: 0 },
    ]);
    expect(out).toContain('| `manifest` | 22 | 0 | 1 | 15 | 0 | 38 |');
    expect(out).toContain('| **total** | **22** | **0** | **1** | **15** | **0** | **38** |');
  });

  it('says it is generated and names the one command that rewrites it', () => {
    const out = renderStateCounts(COUNTS);
    expect(out).toContain('GENERATED — DO NOT EDIT BY HAND');
    expect(out).toContain(STATE_COUNTS_GEN_COMMAND);
  });

  // The whole scheme rests on the generator and the gate rendering the same
  // bytes from the same model. A renderer that varied by call would make the
  // freshness check fail on a file it had itself just written.
  it('is deterministic — the same model renders the same bytes', () => {
    expect(renderStateCounts(COUNTS)).toBe(renderStateCounts(COUNTS));
  });
});

describe('reconcileStateCounts — what it must catch', () => {
  const rendered = renderStateCounts(COUNTS);

  it('is quiet when the artifact is current and the README carries prose only', () => {
    const r = reconcileStateCounts({ table: parseStateTable(proseReadme()), rendered, onDisk: rendered });
    expect(r).toEqual({ artifactErrors: [], rowSetErrors: [], handCountErrors: [] });
  });

  it('catches a MISSING artifact', () => {
    const r = reconcileStateCounts({ table: parseStateTable(proseReadme()), rendered, onDisk: null });
    expect(r.artifactErrors).toHaveLength(1);
    expect(r.artifactErrors[0]).toContain('MISSING');
    expect(r.artifactErrors[0]).toContain(STATE_COUNTS_PATH);
  });

  // The leg that replaces what the hand-edit used to buy: touching a schema
  // forced you back through the table. A stale artifact must be loud, and it must
  // point at the line that moved rather than at the file.
  it('catches a SKEWED count and names the first differing line', () => {
    const onDisk = rendered.replace('| `field` | 66 |', '| `field` | 67 |');
    const r = reconcileStateCounts({ table: parseStateTable(proseReadme()), rendered, onDisk });
    expect(r.artifactErrors).toHaveLength(1);
    expect(r.artifactErrors[0]).toContain('STALE');
    expect(r.artifactErrors[0]).toContain('- | `field` | 67 |');
    expect(r.artifactErrors[0]).toContain('+ | `field` | 66 |');
  });

  it('catches a type with counts and no README row', () => {
    const table = parseStateTable(proseReadme(['| object | notes |', '| field | notes |']));
    const r = reconcileStateCounts({ table, rendered, onDisk: rendered });
    expect(r.rowSetErrors).toEqual([expect.stringContaining('api')]);
  });

  it('catches the mirror — a README row with no counts', () => {
    const table = parseStateTable(proseReadme([...['| object | n |', '| field | n |', '| api | n |'], '| ghost | n |']));
    const r = reconcileStateCounts({ table, rendered, onDisk: rendered });
    expect(r.rowSetErrors).toEqual([expect.stringContaining('ghost')]);
  });

  // The leg neither of the other two can see. A re-added column leaves the
  // artifact fresh and the row sets equal, so the table would publish two sets of
  // numbers with only one of them enforced — strictly worse than the drift #7377
  // started from.
  it('catches a count column coming back into the README', () => {
    const table = parseStateTable(proseReadme(['| object | 49 | – | 0 | 1 | notes |', '| field | n |', '| api | n |']));
    const r = reconcileStateCounts({ table, rendered, onDisk: rendered });
    expect(r.handCountErrors).toHaveLength(1);
    expect(r.handCountErrors[0]).toContain('object');
    // `–` counts: it is the spelling the old table used for "none of these", so
    // treating it as prose would let half a column back in.
    expect(r.handCountErrors[0]).toContain('–');
    expect(r.artifactErrors).toEqual([]);
    expect(r.rowSetErrors).toEqual([]);
  });

  // A Notes cell is prose about measurements and says numbers constantly
  // ("Dead 9 = the seven #4142 tombstones"). Only a cell that is NOTHING BUT a
  // number is a column; anything looser would make the pin unsatisfiable.
  it('stays quiet on a Notes cell that merely mentions numbers', () => {
    const table = parseStateTable(proseReadme(['| object | Dead 9 = the seven #4142 tombstones + 2 | ', '| field | n |', '| api | n |']));
    const r = reconcileStateCounts({ table, rendered, onDisk: rendered });
    expect(r.handCountErrors).toEqual([]);
  });

  it('reconciles the row set against the RENDERED artifact, not the stale copy on disk', () => {
    // Otherwise a stale artifact missing a row would report the same defect twice,
    // under two headings, and the second one would be a lie about the row set.
    const onDisk = rendered.split('\n').filter((l) => !l.startsWith('| `api` |')).join('\n');
    const r = reconcileStateCounts({ table: parseStateTable(proseReadme()), rendered, onDisk });
    expect(r.artifactErrors).toHaveLength(1);
    expect(r.rowSetErrors).toEqual([]);
  });
});

describe('the counts prescription', () => {
  it('names the generator and forbids both ways of hand-writing a number', () => {
    const text = STATE_COUNTS_GUIDANCE.join('\n');
    expect(text).toContain(STATE_COUNTS_GEN_COMMAND);
    expect(text).toContain('Never hand-patch a number');
    expect(text).toContain('never put a count column back');
  });

  // The half of the hand-edit worth keeping: a moved number means a Note beside
  // it may now describe a set it no longer has. If that sentence leaves, the
  // regeneration becomes the mechanical rewrite #7377 refused to do.
  it('tells the author to READ the diff, not just run the command', () => {
    const text = STATE_COUNTS_GUIDANCE.join('\n');
    expect(text).toContain('READ the diff');
    expect(text).toContain('Notes cell');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The fold's own blind spot (#13083)
//
// Every leg above reads the README or the artifact, and a fold that dropped a
// status satisfies all of them: `renderStateCounts` computes `classified` as the
// sum of the four columns beside it, the freshness leg re-renders the same fold
// and compares bytes, and the README agrees with that. So the population these
// cases describe is invisible to every test above this line, and the real gate
// is GREEN on it — which is why the proof has to be here and in
// check-liveness.test.ts, and cannot come from `pnpm check:liveness` passing.
// ─────────────────────────────────────────────────────────────────────────────
describe('reconcileStateCountTotals — the fold must not lose a property', () => {
  /** `byStatus` and `classified` as the gate reports them, always in agreement. */
  const HONEST = {
    governed: ['object', 'field'],
    byStatus: { object: { live: 49, planned: 1 }, field: { live: 66 } },
    classified: { object: 50, field: 66 },
  };

  it('stays quiet when every property sits in one of the published columns', () => {
    expect(reconcileStateCountTotals(HONEST)).toEqual([]);
  });

  // A type the report does not carry is zero and zero — "measured as nothing"
  // must not read as a gap, or the leg fires on every green tree and stops being
  // read. Same rule `foldStateCounts` states for its own zero row.
  it('stays quiet on a governed type the report does not carry at all', () => {
    expect(
      reconcileStateCountTotals({ governed: ['object', 'ghost'], byStatus: { object: { live: 49 } }, classified: { object: 49 } }),
    ).toEqual([]);
  });

  // THE CARD'S OWN INSTANCE. One row written `"status": "planed"`: the walk
  // classified 50, the four columns carry 49, and before this leg existed the
  // artifact published 49 with nothing able to say otherwise.
  it('FAILS when a status outside the four columns is counted by the walk', () => {
    const errors = reconcileStateCountTotals({
      governed: ['object'],
      byStatus: { object: { live: 49, planed: 1 } },
      classified: { object: 50 },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('object');
    expect(errors[0]).toContain('publishes 49 classified, the walk counted 50');
    expect(errors[0]).toContain('1 in `planed`');
  });

  it('names every unnamed bucket, so one run repairs all of them', () => {
    const errors = reconcileStateCountTotals({
      governed: ['object'],
      byStatus: { object: { live: 49, planed: 1, experimentl: 2 } },
      classified: { object: 52 },
    });
    expect(errors[0]).toContain('1 in `planed`');
    expect(errors[0]).toContain('2 in `experimentl`');
  });

  it('reports each offending type separately rather than one grand total', () => {
    const errors = reconcileStateCountTotals({
      governed: ['object', 'field', 'api'],
      byStatus: { object: { live: 1, planed: 1 }, field: { live: 66 }, api: { dead: 2, ded: 3 } },
      classified: { object: 2, field: 66, api: 5 },
    });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('object');
    expect(errors[1]).toContain('api');
  });

  // The OTHER way the fold loses a property, and the reason this leg is
  // arithmetic rather than a spell-check on bucket names: a status added to
  // STATUS_COLUMNS is published vocabulary, so the data-side guard in
  // check-liveness.mts accepts it — and `StateCountsRow` still names four fields
  // by hand, so the fold drops it anyway. Nothing else in either file catches
  // this, and the message must not claim a typo when there is none.
  it('FAILS, without blaming a typo, when the columns simply do not add up', () => {
    const errors = reconcileStateCountTotals({
      governed: ['object'],
      byStatus: { object: { live: 49 } },
      classified: { object: 51 },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('no unnamed status accounts for the gap');
  });

  // The vocabulary is read from STATUS_COLUMNS, never restated: the guard and
  // the fold that drops the value must not be able to disagree about the four
  // names. Pinned because a second copy is exactly how the two come apart.
  it('measures against the published vocabulary, not a second copy of it', () => {
    expect([...STATUS_COLUMNS]).toEqual(['live', 'experimental', 'live-elsewhere', 'dead', 'planned']);
    const errors = reconcileStateCountTotals({
      governed: ['object'],
      byStatus: { object: { live: 1, planed: 1 } },
      classified: { object: 2 },
    });
    expect(errors[0]).toContain(STATUS_COLUMNS.join(' / '));
  });
});

describe('the totals prescription', () => {
  // The failure a reader is most likely to "fix" the wrong way: it looks like
  // staleness, and regenerating re-publishes the same understated number,
  // because the generator folds through the same four names.
  it('says regeneration is not the repair, and names why', () => {
    const text = STATE_COUNTS_TOTALS_GUIDANCE.join('\n');
    expect(text).toContain(STATE_COUNTS_GEN_COMMAND);
    expect(text).toContain('is not the repair');
    expect(text).toContain('exactly the same names');
  });

  it('forbids widening the vocabulary to get green, and forbids editing the artifact', () => {
    const text = STATE_COUNTS_TOTALS_GUIDANCE.join('\n');
    expect(text).toContain('Never add the misspelling to STATUS_COLUMNS');
    expect(text).toContain('Never satisfy this by editing the artifact');
  });

  // The deliberate case has to be reachable from the message, or the only
  // documented reading is "somebody typo'd" and a real vocabulary change gets
  // hammered into the shape that makes the error go away.
  it('describes the deliberate fifth status as an artifact-shape decision', () => {
    const text = STATE_COUNTS_TOTALS_GUIDANCE.join('\n');
    expect(text).toContain('artifact-shape decision');
    expect(text).toContain('StateCountsRow');
  });
});
