// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The protocol upgrade guide renders every entry's `surface` inside a code
// span, and a surface may carry backticks of its own: most semantic entries
// mark their inline code in it. CommonMark closes a span at the next backtick
// string of the opening length, so the span must be fenced longer than any run
// inside it — or the line renders as alternating code and prose fragments. A
// conversion's surface sits in a GFM table cell as well, where an unescaped
// pipe ends the cell, inside a code span or not. Three pins, kept apart:
//
// - the helper: `codeSpan` fences by that rule and leaves a text with no
//   backtick and no leading or trailing space byte-identical; `readCodeSpan`
//   reads a span the way a renderer does, and reads the OLD single-backtick
//   wrapping of a marked surface as broken (the lit control — a reader that
//   cannot see a break would prove nothing);
// - the real entry set: every conversion and semantic surface the registries
//   carry round-trips through the pair, so a new entry cannot bring the defect
//   back whatever backticks it carries;
// - the generated guide: the REAL generator's bytes, read back span by span and
//   cell by cell, give every entry's surface verbatim — pinned on what ships,
//   not on the helper.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALL_CONVERSIONS, CONVERSIONS_BY_MAJOR } from '../src/conversions/registry';
import { MIGRATION_SUPPORT_FLOOR, MIGRATIONS_BY_MAJOR } from '../src/migrations/registry';
import type { SemanticMigration } from '../src/migrations/types';
import { codeSpan, readCodeSpan } from './lib/markdown-code-span';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const TSX = path.join(PKG, 'node_modules', '.bin', 'tsx');
const SPAWN_TIMEOUT_MS = 120_000;

/** Every semantic entry with the major its hop arrives at. */
function semanticEntries(): { major: number; entry: SemanticMigration }[] {
  const out: { major: number; entry: SemanticMigration }[] = [];
  for (const [major, step] of Object.entries(MIGRATIONS_BY_MAJOR)) {
    for (const entry of step.semantic) out.push({ major: Number(major), entry });
  }
  return out;
}

/**
 * A GFM table row's cells, read the way the spec reads them: every `|` ends a
 * cell, inside a code span or not, except one escaped as `\|` (GFM §4.10,
 * example 200). The pieces outside the row's leading and trailing pipe are
 * dropped; each cell is trimmed.
 */
function gfmCells(row: string): string[] {
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\' && row[i + 1] === '|') {
      cell += '\\|';
      i++;
    } else if (row[i] === '|') {
      cells.push(cell);
      cell = '';
    } else {
      cell += row[i];
    }
  }
  cells.push(cell);
  return cells.slice(1, -1).map((c) => c.trim());
}

describe('codeSpan — one code span for any one-line text', () => {
  it('a text with no backtick and no leading or trailing space is wrapped in single backticks, byte for byte as before', () => {
    expect(codeSpan('flow.node.type')).toBe('`flow.node.type`');
    expect(codeSpan('data.query.aggregations[].distinct')).toBe('`data.query.aggregations[].distinct`');
  });

  it('a text with its own backticks is fenced one backtick longer than its longest run', () => {
    expect(codeSpan('x `a` y')).toBe('``x `a` y``');
    expect(codeSpan('a ``b`` c')).toBe('```a ``b`` c```');
  });

  it('a text that starts or ends with a backtick or a space is padded, which the reader strips again', () => {
    expect(codeSpan('`a` on b')).toBe('`` `a` on b ``');
    expect(codeSpan('on `b`')).toBe('`` on `b` ``');
    expect(codeSpan(' lead')).toBe('`  lead `');
  });

  it('a blank or multi-line text is refused, naming the subject, never rendered as a span that says nothing or breaks its row', () => {
    expect(() => codeSpan('')).toThrow(/^codeSpan: .*blank/);
    expect(() => codeSpan('   ')).toThrow(/blank/);
    expect(() => codeSpan('a\nb')).toThrow(/one line/);
    expect(() => codeSpan('', 'entry some-id')).toThrow(/^entry some-id: /);
  });

  it('round-trips through the reader', () => {
    for (const text of ['flow.node.type', 'x `a` y', '`a` on b', 'on `b`', 'a ``b`` c', ' lead', 'trail ', '`', '``']) {
      const span = codeSpan(text);
      expect(readCodeSpan(span, 0), span).toEqual({ content: text, end: span.length });
    }
  });
});

describe('readCodeSpan — CommonMark’s reading of a span', () => {
  it('closes at the next backtick string of the opening length, and strips one space from each end', () => {
    expect(readCodeSpan('`a` b', 0)).toEqual({ content: 'a', end: 3 });
    expect(readCodeSpan('`` `a` b `` c', 0)).toEqual({ content: '`a` b', end: 11 });
    expect(readCodeSpan('x `a`', 2)).toEqual({ content: 'a', end: 5 });
  });

  it('a line ending inside the span reads as a space; a span of spaces only keeps them', () => {
    expect(readCodeSpan('`a\nb`', 0)).toEqual({ content: 'a b', end: 5 });
    expect(readCodeSpan('`a\r\nb`', 0)).toEqual({ content: 'a b', end: 6 });
    expect(readCodeSpan('`  `', 0)).toEqual({ content: '  ', end: 4 });
    expect(readCodeSpan('` \t `', 0)).toEqual({ content: '\t', end: 5 });
  });

  it('an opener with no closer of its length is not a span', () => {
    expect(readCodeSpan('``a` b', 0)).toBeNull();
    expect(readCodeSpan('`a', 0)).toBeNull();
  });

  it('a position that is not the start of a backtick string is not a span', () => {
    expect(readCodeSpan('a `b`', 0)).toBeNull();
    expect(readCodeSpan('``a``', 1)).toBeNull();
  });

  it('the lit control: the old single-backtick wrapping of a real marked surface reads as broken', () => {
    // A surface with a single-backtick string inside: the old wrapper closed at
    // it, or opened a double-backtick span that never closes. (A run of two or
    // more inside a single-backtick span is literal and would not break it.)
    const marked = semanticEntries().filter(({ entry }) => /(?:^|[^`])`(?:[^`]|$)/.test(entry.surface));
    expect(marked.length).toBeGreaterThan(0);
    for (const { entry } of marked) {
      const old = `\`${entry.surface}\``;
      expect(readCodeSpan(old, 0)?.content, entry.id).not.toBe(entry.surface);
    }
  });
});

describe('the real entry set — every surface the registries carry renders as one unbroken span', () => {
  it('every semantic surface round-trips, whatever backticks it carries', () => {
    const entries = semanticEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const { entry } of entries) {
      const span = codeSpan(entry.surface);
      expect(readCodeSpan(span, 0)?.content, entry.id).toBe(entry.surface);
    }
  });

  it('every conversion surface round-trips, whatever backticks it carries, and never escapes a pipe itself', () => {
    expect(ALL_CONVERSIONS.length).toBeGreaterThan(0);
    for (const c of ALL_CONVERSIONS) {
      const span = codeSpan(c.surface);
      expect(readCodeSpan(span, 0)?.content, c.id).toBe(c.surface);
      // A backslash right before a pipe is where GFM renderers part ways once
      // the row escapes it again (`\\|` is a literal backslash and a cell
      // boundary to one, a backslash and an escaped pipe to another), so a
      // conversion surface never carries that pair — loudly.
      expect(c.surface, c.id).not.toMatch(/\\\|/);
    }
  });
});

describe('the generated guide — read back span by span, every entry’s surface is verbatim', () => {
  let tmp: string;
  let sections: Map<number, string[]>;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-guide-surface-'));
    const file = path.join(tmp, 'guide.md');
    const r = spawnSync(TSX, [path.join(HERE, 'build-upgrade-guide.ts'), '--out', file], {
      cwd: PKG,
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(r.status, `${r.stdout ?? ''}${r.stderr ?? ''}`).toBe(0);
    const text = fs.readFileSync(file, 'utf8');
    sections = new Map();
    for (const part of text.split(/^(?=## Protocol \d+ → \d+$)/m).slice(1)) {
      sections.set(Number(/→ (\d+)/.exec(part)![1]), part.split('\n'));
    }
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * Whether the guide renders a hop for `major`: it starts one above the chain's
   * support floor, so a registry major at or below the floor has no section,
   * and one above it must.
   */
  function rendered(major: number): boolean {
    const has = sections.has(major);
    if (!has) expect(major, `protocol ${major} has no section`).toBeLessThanOrEqual(MIGRATION_SUPPORT_FLOOR);
    return has;
  }

  /** The one line of a rendered `major`'s section that starts with `prefix`. */
  function lineOf(major: number, prefix: string): string {
    const hits = sections.get(major)!.filter((line) => line.startsWith(prefix));
    expect(hits, prefix).toHaveLength(1);
    return hits[0]!;
  }

  it('each semantic entry’s line carries its surface as one span, followed by the replacement arrow', () => {
    const entries = semanticEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const { major, entry } of entries) {
      if (!rendered(major)) continue;
      const prefix = `- **\`${entry.id}\`** — `;
      const line = lineOf(major, prefix);
      const span = readCodeSpan(line, prefix.length);
      expect(span?.content, entry.id).toBe(entry.surface);
      expect(line.slice(span!.end).startsWith(' → '), entry.id).toBe(true);
    }
  });

  it('each conversion’s table row is four cells, the surface one span filling its own cell', () => {
    for (const [key, list] of Object.entries(CONVERSIONS_BY_MAJOR)) {
      const major = Number(key);
      if (!rendered(major)) continue;
      for (const c of list) {
        const line = lineOf(major, `| \`${c.id}\` | `);
        const cells = gfmCells(line);
        expect(cells, c.id).toHaveLength(4);
        const span = readCodeSpan(cells[1]!, 0);
        expect(span?.end, c.id).toBe(cells[1]!.length);
        expect(span?.content.replace(/\\\|/g, '|'), c.id).toBe(c.surface);
      }
    }
  });

  it('the lit control: the old single-backtick row of a surface that carries a pipe splits into extra cells', () => {
    // A literal row first, so the control outlives the two pipe-carrying
    // conversions in today's registry (their retirement kits age out one
    // major on, ADR-0087); then every real one the registry carries.
    expect(gfmCells("| `a` | `x ('m' | 's')` | s | live |")).toHaveLength(5);
    for (const c of ALL_CONVERSIONS.filter((c) => c.surface.includes('|'))) {
      const old = `| \`${c.id}\` | \`${c.surface}\` | ${c.summary} | live |`;
      expect(gfmCells(old).length, c.id).toBeGreaterThan(4);
    }
  });
});
