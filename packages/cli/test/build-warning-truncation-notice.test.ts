// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11529 — `os build` / `os compile` printed a fixed 50 author-time advisories
 * and then stopped, with NOTHING in the output saying the list had been cut.
 *
 * Measured on `objectstack-ai/hotcrm` with the published 17.1.0 CLI: two
 * `objectstack build` runs over the same tree, before and after a five-warning
 * fix, printed 50 detailed entries each — 184 output lines, 52 warning lines,
 * both times — while the summary line counted 80 and then 75. Removing five
 * warnings did not shorten the list; it made room, and five advisories that
 * had been present all along appeared for the first time.
 *
 * The defect is the SILENCE, not the cap. A truncated report that carries no
 * notice is indistinguishable from a complete one, so an author who reads it
 * and sees their file is clean has read a list that stopped early. Same shape
 * as the dropped summary rows pinned in `print-metadata-stats-zero-row.test.ts`
 * (#10504, #10952): output that cannot distinguish "none" from "not shown".
 *
 * WHAT THESE PINS ASSERT — the pair, not the cap. A test that only checked
 * "50 entries printed" passes on the silent tree and pins nothing. So the
 * behaviour is pinned from both ends:
 *
 *   - over the limit  -> the output states how many were withheld;
 *   - at or under it  -> no such line appears at all.
 *
 * ALTITUDE: this pins `printAuthoringAdvisories` — the function `os build`'s
 * advisory block now consists of — rather than spawning the CLI, following the
 * `printMetadataStats` precedent set by the sibling fixes in this same family
 * (`print-metadata-stats-zero-row.test.ts`) and the `formatZodErrors` pattern
 * in `format-zod-union.test.ts`. No child process, so nothing here touches
 * `check:cli-test-child-env`.
 */

import { describe, expect, it } from 'vitest';
import {
  AUTHORING_ADVISORY_PRINT_LIMIT,
  printAuthoringAdvisories,
  type AuthoringAdvisory,
} from '../src/utils/format.js';

/** Drop SGR sequences so an assertion reads the words, not chalk's opinion. */
const stripAnsi = (s: string) => s.replace(/\u001B\[[0-9;]*m/g, '');

/** Run the printer and return everything it printed, as one string. */
function render(advisories: readonly AuthoringAdvisory[], limit?: number): string {
  const captured: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    captured.push(args.map(String).join(' '));
  };
  try {
    if (limit === undefined) printAuthoringAdvisories(advisories);
    else printAuthoringAdvisories(advisories, limit);
  } finally {
    console.log = original;
  }
  return stripAnsi(captured.join('\n'));
}

/** One advisory in the shape the authoring-rule registry emits. */
const advisory = (i: number): AuthoringAdvisory => ({
  where: `view "views[${i}]" form`,
  message: `absolute colSpan ${i}`,
  rule: 'absolute-colspan-discouraged',
  path: `views[${i}].form`,
  hint: 'use a fractional colSpan',
});

const many = (n: number): AuthoringAdvisory[] => Array.from({ length: n }, (_, i) => advisory(i));

/** How many detail entries the output carries — one `rule:` line per entry. */
const detailCount = (out: string) => out.split('\n').filter((l) => l.includes('rule: ')).length;

/**
 * The notice, recognised by what makes it honest rather than by its full
 * wording: it names a remainder and says that remainder was not shown.
 */
const NOTICE = /and (\d+) more author-time warning\(s\) not shown/;

describe('[#11529] the author-time advisory printer names what it withheld', () => {
  it('OVER the limit: states how many were withheld, and how many of how many were printed', () => {
    // The card's own measured run: 80 advisories against the shipped cap.
    // Literal numbers on purpose — this is the reproduction, so changing the
    // cap has to be a deliberate edit here rather than a silently-passing one.
    expect(AUTHORING_ADVISORY_PRINT_LIMIT).toBe(50);

    const out = render(many(80));

    // Before the fix the output simply ended after the 50th entry.
    expect(out).toMatch(NOTICE);
    expect(out).toContain('and 30 more author-time warning(s) not shown (50 of 80)');
    // And it points at a path that really does carry the whole set today,
    // rather than inventing a flag: `--json` publishes `warnings`.
    expect(out).toContain('--json');
  });

  it('AT the limit: prints every advisory and NO withheld line — the other half of the pair', () => {
    const out = render(many(50));
    expect(detailCount(out)).toBe(50);
    // "50 printed" is true here AND on the truncated run above; only the
    // absence of the notice tells the two apart.
    expect(out).not.toMatch(NOTICE);
    expect(out).not.toContain('not shown');
  });

  it('UNDER the limit: no withheld line', () => {
    const out = render(many(3), 10);
    expect(detailCount(out)).toBe(3);
    expect(out).not.toMatch(NOTICE);
  });

  it('ONE over the limit: the notice appears and reads exactly 1 — the tightest edge', () => {
    const out = render(many(11), 10);
    expect(detailCount(out)).toBe(10);
    expect(NOTICE.exec(out)?.[1]).toBe('1');
    expect(out).toContain('(10 of 11)');
  });

  it('the remainder is the EXACT count, not a fixed word', () => {
    const out = render(many(8), 5);
    expect(NOTICE.exec(out)?.[1]).toBe('3');
    expect(out).toContain('(5 of 8)');
  });

  it('control: the detail entries are unchanged — the notice adds, it does not replace', () => {
    const out = render(many(80));
    expect(detailCount(out)).toBe(50);
    expect(out).toContain('view "views[0]" form: absolute colSpan 0');
    expect(out).toContain('use a fractional colSpan');
    expect(out).toContain('rule: absolute-colspan-discouraged  at views[0].form');
    // The 50th entry is present and the 51st is not — the cap still caps.
    expect(out).toContain('at views[49].form');
    expect(out).not.toContain('at views[50].form');
  });

  it('control: an empty set prints nothing at all — no notice, no blank advisory block', () => {
    expect(render([])).toBe('');
  });
});
