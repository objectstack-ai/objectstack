// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0160 D3, "The body"] The outline reader: which lines and elements are
 * headings, that reading them costs time in proportion to the body, and that
 * the outline it lists is bounded whatever the body holds.
 */

import { describe, expect, it } from 'vitest';
import {
  RECORD_CONTEXT_BODY_MAX_CHARS,
  RECORD_CONTEXT_OUTLINE_MAX_ENTRIES,
  boundedOutline,
  headingsOf,
  sectionOf,
} from '../body-outline.js';

const outline = (text: string, html = false) => headingsOf(text, html).map((h) => [h.level, h.heading, h.anchor]);

describe('[ADR-0160 D3] Markdown headings', () => {
  it('reads ATX headings outside fences, with closing hashes and blanks trimmed', () => {
    const text = ['# Scope', 'intro', '## Terms ##  ', '```', '# not a heading', '```', '###\tExclusions', '#no-space', '####### seven'].join('\n');
    expect(outline(text)).toEqual([
      [1, 'Scope', 'scope'],
      [2, 'Terms', 'terms'],
      [3, 'Exclusions', 'exclusions'],
    ]);
  });

  it('numbers a repeated anchor and reads CRLF lines', () => {
    expect(outline('# Notes\r\nx\r\n# Notes\r\n')).toEqual([
      [1, 'Notes', 'notes'],
      [1, 'Notes', 'notes-2'],
    ]);
  });

  it('a section runs to the next heading of the same or a higher level', () => {
    const text = '# A\none\n## B\ntwo\n# C\nthree';
    expect(sectionOf(text, headingsOf(text, false), 'a')).toBe('# A\none\n## B\ntwo\n');
    expect(sectionOf(text, headingsOf(text, false), 'b')).toBe('## B\ntwo\n');
  });
});

describe('[ADR-0160 D3] HTML headings', () => {
  it('reads h1–h6 elements, any case, with attributes, inner tags and entities', () => {
    const html = '<p>x</p><H2 class="t">Terms &amp; <b>scope</b></H2 ><h7>no</h7><hr><h3>Ex&lt;clusions</h3>';
    expect(outline(html, true)).toEqual([
      [2, 'Terms & scope', 'terms-scope'],
      [3, 'Ex<clusions', 'ex-clusions'],
    ]);
  });

  it('an opener with no closer of its level is skipped, and later headings still read', () => {
    expect(outline('<h2>open<h1>Done</h1>', true)).toEqual([[1, 'Done', 'done']]);
  });

  it('a stray `<` inside a heading is kept as text', () => {
    expect(outline('<h1>a < b</h1>', true)).toEqual([[1, 'a < b', 'a-b']]);
  });
});

describe('[ADR-0160 D3] outline parsing is linear in body length', () => {
  /** Milliseconds to read the outline of `text`, best of three. */
  const timed = (text: string, html: boolean): number => {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      headingsOf(text, html);
      best = Math.min(best, performance.now() - t0);
    }
    return best;
  };

  // Shapes that make a backtracking reader super-linear: long blank runs
  // inside a heading line, and many openers that never close. Each is read at
  // two sizes; a linear reader takes a bounded multiple of the small one's
  // time, and the large one stays well inside any interactive budget.
  const shapes: Array<[string, (n: number) => string, boolean]> = [
    ['blank run in a heading line', (n) => `# a${' \t'.repeat(n)}x`, false],
    ['many heading lines of blanks', (n) => `# a${' '.repeat(200)}x\n`.repeat(n / 200), false],
    ['unclosed openers', (n) => '<h1>'.repeat(n / 4), true],
    ['openers without a tag end', (n) => '<h1 '.repeat(n / 4), true],
    ['unclosed tags inside a heading', (n) => `<h2>${'<'.repeat(n)}</h2>`, true],
  ];

  for (const [name, make, html] of shapes) {
    it(name, () => {
      const small = timed(make(20_000), html);
      const large = timed(make(200_000), html);
      expect(large).toBeLessThan(500);
      expect(large).toBeLessThan(Math.max(small, 1) * 40);
    });
  }
});

describe('[ADR-0160 D3] the outline is bounded whatever the body holds', () => {
  const md = (lines: string[]) => headingsOf(lines.join('\nbody text\n'), false);
  /** The outline bound's two constants hold for `outline`. */
  const assertBounded = (outline: unknown[]) => {
    expect(outline.length).toBeLessThanOrEqual(RECORD_CONTEXT_OUTLINE_MAX_ENTRIES);
    expect(JSON.stringify(outline).length).toBeLessThanOrEqual(RECORD_CONTEXT_BODY_MAX_CHARS);
  };

  it('an outline within the cap lists every heading and leaves none out', () => {
    const headings = md(['# Scope', '## Terms', '# Claims']);
    expect(boundedOutline(headings)).toEqual({
      outline: [
        { anchor: 'scope', heading: 'Scope', level: 1 },
        { anchor: 'terms', heading: 'Terms', level: 2 },
        { anchor: 'claims', heading: 'Claims', level: 1 },
      ],
      omitted: 0,
    });
  });

  it('a body of many short headings is cut at the entry cap, in body order, and counts what it left out', () => {
    const headings = md(Array.from({ length: 300 }, (_, i) => `## Clause ${i + 1}`));
    const { outline, omitted } = boundedOutline(headings);
    expect(outline).toHaveLength(RECORD_CONTEXT_OUTLINE_MAX_ENTRIES);
    expect(omitted).toBe(300 - RECORD_CONTEXT_OUTLINE_MAX_ENTRIES);
    expect(outline.map((h) => h.anchor)).toEqual(headings.slice(0, RECORD_CONTEXT_OUTLINE_MAX_ENTRIES).map((h) => h.anchor));
    assertBounded(outline);
  });

  it('a cut leaves out the deepest headings first, and lists what it keeps in body order', () => {
    const lines: string[] = [];
    for (let a = 1; a <= 10; a++) {
      lines.push(`# Part ${a}`);
      for (let b = 1; b <= 20; b++) lines.push(`## Part ${a} clause ${b}`);
    }
    const headings = md(lines);
    const { outline, omitted } = boundedOutline(headings);
    expect(outline).toHaveLength(RECORD_CONTEXT_OUTLINE_MAX_ENTRIES);
    expect(omitted).toBe(210 - RECORD_CONTEXT_OUTLINE_MAX_ENTRIES);
    // Every top-level part is listed; the level-2 slots go to the first clauses in body order.
    expect(outline.filter((h) => h.level === 1)).toHaveLength(10);
    const keptClauses = headings.filter((h) => h.level === 2).slice(0, RECORD_CONTEXT_OUTLINE_MAX_ENTRIES - 10);
    const expected = headings.filter((h) => h.level === 1 || keptClauses.includes(h));
    expect(outline.map((h) => h.anchor)).toEqual(expected.map((h) => h.anchor));
    assertBounded(outline);
  });

  it('long headings are held to the character bound before the entry cap', () => {
    const headings = md(Array.from({ length: 40 }, (_, i) => `# ${'Long heading '.repeat(25)}${i}`));
    const { outline, omitted } = boundedOutline(headings);
    expect(outline.length).toBeGreaterThan(0);
    expect(outline.length).toBeLessThan(40);
    expect(omitted).toBe(40 - outline.length);
    assertBounded(outline);
  });

  it('a heading too long to list within the bound is left out, never carried past it', () => {
    const headings = md([`# ${'x'.repeat(RECORD_CONTEXT_BODY_MAX_CHARS)}`]);
    expect(boundedOutline(headings)).toEqual({ outline: [], omitted: 1 });
  });

  it('a listed anchor is the one the reader gave, cut or not', () => {
    const headings = md(Array.from({ length: 100 }, () => '## Notes'));
    const { outline } = boundedOutline(headings);
    expect(outline.map((h) => h.anchor)).toEqual(['notes', ...Array.from({ length: 79 }, (_, i) => `notes-${i + 2}`)]);
  });
});
