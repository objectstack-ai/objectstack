// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0160 D3, "The body"] The outline reader: which lines and elements are
 * headings, and that reading them costs time in proportion to the body.
 */

import { describe, expect, it } from 'vitest';
import { headingsOf, sectionOf } from '../body-outline.js';

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
