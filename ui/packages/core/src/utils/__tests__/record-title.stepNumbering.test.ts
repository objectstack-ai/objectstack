/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6634 / objectui#6843 — the precedence STEP NUMBERS around
 * `record-title.ts` have to agree with each other.
 *
 * The module states its ADR-0079 ladder several times over — the module
 * docblock, the `getRecordDisplayName` docblock, and the inline `// N.` labels
 * on the branches themselves — and other files cite those numbers BY HAND
 * (objectui#6572 corrected `InterfaceListPage`'s prose, which names steps
 * 0/1/2/3/4 and takes them from here). Nothing mechanical noticed when one rung
 * ended up carrying two numbers: the `NAME_ISH_RECORD_KEYS` probe was `4b` in
 * the resolver docblock and on the branch, but `3b` in the
 * `RecordDisplayNameOptions.deriveFromRecordKeys` docblock — 26 lines apart in
 * the same file. `3` is `objectDef.titleFormat` in BOTH ladders, so a reader
 * who carried away `3b` had the record-key probe filed under the legacy
 * template.
 *
 * The numbers live only in comment text, so no behavioural assertion can tell
 * the two states apart — `deriveFromRecordKeys` behaves identically either way.
 * This is the assertion that can. It checks the labels against the ladder the
 * module itself states rather than against a number hard-coded here, so the
 * consistency checks stay relative; what fails is a label that disagrees with
 * the ladder it sits under.
 *
 * objectui#6843 — the second site. The first version of this pin scanned
 * `record-title.ts` and nothing else, and said so. The sibling
 * `record-title.test.ts` then turned out to carry the identical drift — "step
 * 3b" for the record-key probe at one site, `4b` at three others in the same
 * file — inside the pin's declared blind spot. Two things changed:
 *
 *   - The scanned set is an explicit list ({@link SCAN_SET}) that names the
 *     sibling test file, and every entry has to declare how many labels it
 *     carries ({@link CONTROL_LABEL_COUNTS}), so a file that stops being
 *     measured is a red control, not a quieter green.
 *   - The set is guarded against the failure a source-reading scan is prone
 *     to: an empty or mis-pathed set iterates nothing, asserts nothing and
 *     passes. The guard requires both files by name, on disk, non-empty.
 *
 * Measured before widening (objectui#6843): of the 49 files under
 * `packages/core/src/utils/__tests__/`, exactly one besides this pin cites the
 * ladder — `record-title.test.ts`. This file's own docblock also spells `3b`,
 * as the bug it describes, and is deliberately NOT in the set.
 *
 * One check is absolute rather than relative (see the last `it`): the ladder's
 * `3 = titleFormat` / `4 = fields derivation` numbering is cited by hand from
 * outside this module, so the plausible WRONG fix for a stray label — moving
 * the module's ladder to meet it — is a cross-file edit, not a local one. That
 * pin turns a renumbering into a deliberate edit of two constants here instead
 * of a silent reconciliation.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** packages/core/src/utils/__tests__ → packages/core/src/utils */
const UTILS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The file that OWNS the ladder — the only place the rung numbers are defined. */
const LADDER = 'record-title.ts';

/**
 * Every file whose sub-step labels are checked against the ladder, as paths
 * relative to `packages/core/src/utils/`. A rename or a typo here shows up as a
 * missing file in the vacuity guard below, not as a silently smaller set.
 */
const SCAN_SET = [LADDER, '__tests__/record-title.test.ts'] as const;
type ScanFile = (typeof SCAN_SET)[number];

/**
 * How many sub-step labels each scanned file carries today, as a floor. Typed
 * over {@link SCAN_SET} so adding a file to the set without declaring its
 * control is a compile error. A drop below the floor means the wording moved
 * and the pin stopped measuring that file — re-aim the regex or the floor, do
 * not delete the entry.
 *
 *   - `record-title.ts`: resolver docblock `4b.`, branch `// 4b.`, and the
 *     `deriveFromRecordKeys` docblock's `precedence step 4b` — 3.
 *   - `record-title.test.ts`: `step 4b` three times and `step-4b` once — 4,
 *     floored at 3 so one rewritten test comment is not a false red.
 */
const CONTROL_LABEL_COUNTS = {
  'record-title.ts': 3,
  '__tests__/record-title.test.ts': 3,
} satisfies Record<ScanFile, number>;

/** The numbers the hand-citing sites outside this module carry (see docblock). */
const TITLE_FORMAT_STEP = 3;
const FIELDS_DERIVATION_STEP = 4;

function absolutePath(rel: ScanFile): string {
  return path.join(UTILS_DIR, rel);
}

function read(rel: ScanFile): string {
  return readFileSync(absolutePath(rel), 'utf8');
}

/** A numbered label with where it was found, so a red names the exact line. */
interface Label {
  file: string;
  line: number;
  number: number;
  text: string;
}

function lineAt(src: string, index: number): number {
  return src.slice(0, index).split('\n').length;
}

function describeLabel(l: Label): string {
  return `${l.file}:${l.line} "${l.text}" says ${l.number}`;
}

/**
 * The verdict: every label that disagrees with `expected`, rendered so a red
 * names the file and line. Factored out so the fixture self-test below can
 * prove it depends on both inputs — a verdict that is constant for every
 * input is the caricature a scan pin has to be able to fail.
 */
function strayLabels(labels: Label[], expected: number): string[] {
  return labels.filter((l) => l.number !== expected).map(describeLabel);
}

/**
 * Every number a file hangs on the type-aware-derivation rung, wherever it
 * states the ladder: `*   4. Type-aware derivation …` (the two precedence
 * docblocks) and `// 4. Type-aware derivation …` (the branch itself).
 */
function derivationStepLabels(src: string, file: string): Label[] {
  return [...src.matchAll(/^[ \t]*(?:\*|\/\/)[ \t]+(\d+)\.[ \t]+type-aware derivation/gim)].map(
    (m) => ({ file, line: lineAt(src, m.index ?? 0), number: Number(m[1]), text: m[0].trim() }),
  );
}

/**
 * Every number a file hangs on the `titleFormat` rung: the ladder lines
 * (`*   3. \`objectDef.titleFormat\` …`, `// 3. titleFormat …`) and the prose
 * form (`\`titleFormat\` (step 3) is a …`).
 */
function titleFormatStepLabels(src: string, file: string): Label[] {
  const ladder = [
    ...src.matchAll(/^[ \t]*(?:\*|\/\/)[ \t]+(\d+)\.[ \t]+`?(?:objectDef\.)?titleFormat/gm),
  ];
  const prose = [...src.matchAll(/titleFormat`?[^\n]*?\(step (\d+)\)/g)];
  return [...ladder, ...prose].map((m) => ({
    file,
    line: lineAt(src, m.index ?? 0),
    number: Number(m[1]),
    text: m[0].trim(),
  }));
}

/**
 * Every SUB-step label — the `b` variant sitting under a numbered rung. Three
 * spellings are in use across the scanned set and all are collected: the
 * ladder/branch label on a comment line (`4b. …`), inline prose
 * (`precedence step 4b`, `step 4b(ii)`) and hyphenated prose (`step-4b rung`).
 *
 * NOT collected, on purpose: `it('0b. …')` / `it('1b. …')` test NAMES in the
 * sibling file. Those letter that file's own sub-cases under steps 0/1/2 — they
 * are not labels for the record-key probe — and the comment-line anchor
 * (`*` / `//`) keeps them out. The collector self-test below pins both halves.
 */
function subStepLabels(src: string, file: string): Label[] {
  const toLabel = (m: RegExpMatchArray): Label => ({
    file,
    line: lineAt(src, m.index ?? 0),
    number: Number(m[1]),
    text: m[0].trim(),
  });
  return [
    ...[...src.matchAll(/^[ \t]*(?:\*|\/\/)[ \t]+(\d+)b\.[ \t]/gm)].map(toLabel),
    ...[...src.matchAll(/\bstep[ -](\d+)b\b/g)].map(toLabel),
  ];
}

describe('record-title — precedence-step numbering across the scanned set', () => {
  it('scans a NON-EMPTY set that names the ladder and the sibling test file, both on disk', () => {
    // The vacuity guard. A source-reading scan over an empty or mis-globbed
    // set iterates nothing, asserts nothing and passes — so the set is pinned
    // by name, and every entry has to exist and have content before any other
    // assertion here counts as a measurement.
    expect(SCAN_SET.length).toBeGreaterThanOrEqual(2);
    expect(SCAN_SET).toContain('record-title.ts');
    expect(SCAN_SET).toContain('__tests__/record-title.test.ts');
    // This file spells `3b` in its own docblock (as the bug it describes) and
    // must never enter its own population.
    expect(SCAN_SET.some((f) => f.endsWith('record-title.stepNumbering.test.ts'))).toBe(false);

    for (const rel of SCAN_SET) {
      expect(existsSync(absolutePath(rel)), `${rel} is missing from disk`).toBe(true);
      expect(read(rel).length, `${rel} is empty`).toBeGreaterThan(0);
    }
  });

  it('finds sub-step labels in EVERY scanned file (per-file control)', () => {
    for (const rel of SCAN_SET) {
      const found = subStepLabels(read(rel), rel).length;
      expect(
        found,
        `${rel}: ${found} sub-step label(s) found, control floor is ${CONTROL_LABEL_COUNTS[rel]}`,
      ).toBeGreaterThanOrEqual(CONTROL_LABEL_COUNTS[rel]);
    }
  });

  it('gives the type-aware derivation rung ONE number everywhere the ladder states it', () => {
    const numbers = derivationStepLabels(read(LADDER), LADDER).map((l) => l.number);
    // Control: three sites label that rung today (module docblock, resolver
    // docblock, the branch comment). A drop here means the wording moved and
    // this pin stopped measuring — re-aim the regex, do not delete the test.
    expect(numbers.length).toBeGreaterThanOrEqual(3);
    expect(new Set(numbers).size).toBe(1);
  });

  it('numbers every `b` sub-step, in every scanned file, under the rung it actually sits below', () => {
    const derivation = derivationStepLabels(read(LADDER), LADDER);
    expect(derivation.length).toBeGreaterThanOrEqual(3);
    const parent = derivation[0].number;

    const labels = SCAN_SET.flatMap((rel) => subStepLabels(read(rel), rel));
    // Control across the set: the per-file floors add up, so an emptied or
    // mis-pathed entry cannot make this assertion cheaper to pass.
    const floor = SCAN_SET.reduce((sum, rel) => sum + CONTROL_LABEL_COUNTS[rel], 0);
    expect(floor).toBeGreaterThan(0);
    expect(labels.length).toBeGreaterThanOrEqual(floor);

    // The regression this file exists for, twice over: `3b` in the options
    // docblock (objectui#6634) and `3b` in the sibling test's comment
    // (objectui#6843) while the ladders and the branch said `4b`.
    expect(
      strayLabels(labels, parent),
      `sub-step labels disagreeing with the ladder's ${parent}b`,
    ).toEqual([]);
  });

  it('cites that same number in the `deriveTitleField` docblock', () => {
    const src = read(LADDER);
    const cited = /derivation \(precedence step (\d+)\)/i.exec(src);
    // Control: the citation has to still be there for this to be a measurement.
    expect(cited).not.toBeNull();
    expect(Number(cited?.[1])).toBe(derivationStepLabels(src, LADDER)[0].number);
  });

  it('the collector tells a wrong label from a right one (control on a fixture, not a scan)', () => {
    // Guards the caricature where the extractor returns a constant, or nothing:
    // a fixture carrying the ORIGINAL uncorrected `record-title.test.ts:133`
    // text plus each collected spelling has to come back with ITS numbers and
    // lines, and the excluded `it('0b. …')` test name has to stay out.
    const fixture = [
      "  it('0b. falls through when explicit titleField is empty on the record', () => {",
      ' *   3b. standard name-ish keys probed directly on the record',
      '    // record-level name probe (step 3b) resolves it (better than `Record #7`).',
      '    // and `headline` is name-ish by NEITHER step-3b rung — not a',
      "    // `legacy_title`, which step 4b(ii)'s `*_title` affix rule answers on its",
    ].join('\n');
    const labels = subStepLabels(fixture, 'fixture');
    expect(labels.map((l) => [l.line, l.number])).toEqual([
      [2, 3],
      [3, 3],
      [4, 3],
      [5, 4],
    ]);
    expect(labels.some((l) => l.number === 0)).toBe(false);

    // The verdict depends on BOTH inputs: against a `4b` ladder the three `3b`
    // sites are stray and the `4b(ii)` one is not; against a `3b` ladder it is
    // the other way round.
    expect(strayLabels(labels, 4)).toEqual([
      'fixture:2 "*   3b." says 3',
      'fixture:3 "step 3b" says 3',
      'fixture:4 "step-3b" says 3',
    ]);
    expect(strayLabels(labels, 3)).toEqual(['fixture:5 "step 4b" says 4']);

    // The rung collectors read the number too, rather than recognising a shape.
    expect(
      derivationStepLabels(' *   9. Type-aware derivation — the first field', 'fixture').map(
        (l) => l.number,
      ),
    ).toEqual([9]);
    expect(
      titleFormatStepLabels(
        ' *   7. `objectDef.titleFormat` — LEGACY\n  // 8. titleFormat (LEGACY)\n`titleFormat` (step 6) is a',
        'fixture',
      ).map((l) => l.number),
    ).toEqual([7, 8, 6]);
  });

  it(`keeps the cited numbering: titleFormat is step ${TITLE_FORMAT_STEP}, the objectDef.fields derivation is step ${FIELDS_DERIVATION_STEP}`, () => {
    // The one ABSOLUTE check. Everything above is relative to the ladder so a
    // deliberate renumbering stays legal inside the module — but the numbers
    // are cited by hand outside it (`InterfaceListPage`'s prose, the #6530
    // changeset, the sibling test), so "fixing" a stray label by moving the
    // ladder to meet it would break every one of those silently. Renumbering
    // is a real change; it edits the two constants above, on purpose.
    const src = read(LADDER);

    const titleFormat = titleFormatStepLabels(src, LADDER);
    // Control: module docblock, resolver docblock, branch comment, and the
    // `resolveNameField` prose — four sites today.
    expect(titleFormat.length).toBeGreaterThanOrEqual(3);
    expect(
      strayLabels(titleFormat, TITLE_FORMAT_STEP),
      `titleFormat sites not on step ${TITLE_FORMAT_STEP}`,
    ).toEqual([]);

    const derivation = derivationStepLabels(src, LADDER);
    expect(derivation.length).toBeGreaterThanOrEqual(3);
    expect(
      strayLabels(derivation, FIELDS_DERIVATION_STEP),
      `fields-derivation sites not on step ${FIELDS_DERIVATION_STEP}`,
    ).toEqual([]);
  });
});
