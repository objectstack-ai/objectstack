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
  parseStateTable,
  reconcileReadmeTable,
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
