/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9943 — the three tables in this package that are TOTAL over the
 * whole `ViewType` have to compile against TWO different unions at once:
 *
 *   · the `@objectstack/spec` this repository RESOLVES today, which still
 *     publishes the list-view kind `page`;
 *   · a spec built from objectstack `main`, which RETIRED it
 *     (objectstack#17063, ADR-0049 enforce-or-remove) and which objectui#9860's
 *     shape gate compiles this repository against.
 *
 * The spelling that failed was the ANNOTATION `Record<ViewType, X>` on
 * `ViewSwitcher`'s `DEFAULT_VIEW_LABELS` and `DEFAULT_VIEW_ICONS` and on
 * `ObjectView`'s `iconMap` — plus `satisfies Record<ViewType, true>` on this
 * package's own `ALL_VIEW_TYPES`, which fails identically because `satisfies`
 * runs the same excess-property check. An exact target is exact in BOTH
 * directions, so the day the kind left the union its row became TS2353, and
 * the only repair an exact target admits is DELETING the row — which the
 * resolved published spec forbids, because an author can still write a `page`
 * view against it.
 *
 * ⛔ This is NOT objectui#9880's repair, and the difference is the reason this
 * card exists separately. That card's two tables PARTITION the drawable half,
 * so it could derive the undrawable half with `Extract<ViewType, keyof typeof
 * TABLE>` and let a retired row go inert on its own. These tables partition
 * nothing — they are total over the whole union — so there is no second half to
 * derive from. What replaces the annotation is `satisfies Record<string, X>`
 * (value constraint kept, exactness dropped) PLUS a separate totality assert.
 *
 * ⛔ And the assert is not optional decoration. `satisfies Record<string, X>`
 * alone would make the retired member inert AND silently stop catching an ADDED
 * member — the guard objectui#5321 installed on `iconMap` and objectui#8127
 * installed on the switcher's pair. A repair that trades one for the other is a
 * regression wearing a fix's clothes, so both directions are pinned here, with
 * the failing spellings kept as FIRING CONTROLS: the green below can never be
 * the green of a check that stopped checking.
 *
 * ⚠️ Only ONE spec is installed in any single run, so the two legs cannot both
 * be observed at runtime. The vocabulary is therefore SIMULATED for the
 * type-level half — the same operators in the same composition, applied to a
 * published-shaped union, a main-shaped one and a grown one. The real
 * declarations are then read from SOURCE, because all four are module-private
 * and exporting them would widen the package's surface for the sake of a test.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ------------------------------------------------------------------ *
 * The mechanism, lifted off the live vocabulary so every leg is       *
 * reachable from one compile.                                         *
 * ------------------------------------------------------------------ */

/** The source's totality assert, verbatim. */
type AssertNever<T extends never> = T;

/** What the source asserts is `never`: the members no row covers. */
type Uncovered<Vocabulary, Table> = Exclude<Vocabulary, keyof Table>;

/** A stand-in for a repaired table, spelled the way the sources spell one. */
const SIMULATED_TABLE = {
  list: 'list',
  detail: 'file-text',
  grid: 'table',
  page: 'layout-template',
} satisfies Record<string, string>;
type SimulatedTable = typeof SIMULATED_TABLE;

/** The resolved spec's shape: the kind is still in the vocabulary. */
type PublishedVocabulary = 'list' | 'detail' | 'grid' | 'page';
/** objectstack `main`'s shape: the kind is gone. */
type MainVocabulary = 'list' | 'detail' | 'grid';
/** The direction the guard exists FOR: the spec grows a member. */
type GrownVocabulary = PublishedVocabulary | 'pivot';

// LEG 1 — the resolved spec. Every member has a row, so the assert is `never`.
export type _TotalUnderPublished = AssertNever<Uncovered<PublishedVocabulary, SimulatedTable>>;

// LEG 2 — objectstack `main`. The RETIRED row is simply never asked about: it
// is surplus to the vocabulary, and `satisfies Record<string, …>` does not mind
// surplus. This is the green the card is for.
export type _TotalUnderMain = AssertNever<Uncovered<MainVocabulary, SimulatedTable>>;

// …and the same table still types a total lookup under both legs.
export const lookupUnderPublished: Record<PublishedVocabulary, string> = {
  list: SIMULATED_TABLE.list,
  detail: SIMULATED_TABLE.detail,
  grid: SIMULATED_TABLE.grid,
  page: SIMULATED_TABLE.page,
};
export const lookupUnderMain: Record<MainVocabulary, string> = {
  list: SIMULATED_TABLE.list,
  detail: SIMULATED_TABLE.detail,
  grid: SIMULATED_TABLE.grid,
};

// FIRING CONTROL A — the ANNOTATION these three tables carried. Exact in both
// directions, so the retired row is an excess property the moment the
// vocabulary drops it. If this ever compiles, LEG 2 above has stopped meaning
// "tolerant of a retirement" and this file must be re-read.
export const retiredRowUnderTheAnnotation: Record<MainVocabulary, string> = {
  list: 'list',
  detail: 'file-text',
  grid: 'table',
  // @ts-expect-error — TS2353: 'page' does not exist in type 'Record<"list" | "detail" | "grid", string>'
  page: 'layout-template',
};

// FIRING CONTROL B — `satisfies Record<Vocabulary, X>`, this package's own
// previous spelling for `ALL_VIEW_TYPES`. It LOOKS like the repair and is not:
// `satisfies` runs the excess-property check too, so the retired row fails
// exactly as the annotation does. This control is why the repair says
// `Record<string, X>` and not `Record<ViewType, X>`.
export const retiredRowUnderSatisfiesExact = {
  list: true,
  detail: true,
  grid: true,
  // @ts-expect-error — TS2353: `satisfies` is exact too; 'page' is an excess property
  page: true,
} satisfies Record<MainVocabulary, true>;

// THE ADDED-MEMBER GUARD — objectui#5321 / objectui#8127, and ⛔ nothing here
// may drop it. A member NO row covers leaves `Uncovered` a live union, which
// does not satisfy the `never` constraint (TS2344). This is the whole reason
// the assert is separate: `satisfies Record<string, …>` alone says nothing
// about a missing key.
// @ts-expect-error — TS2344: Type '"pivot"' does not satisfy the constraint 'never'
export type _TotalUnderGrown = AssertNever<Uncovered<GrownVocabulary, SimulatedTable>>;

/** The other half of the guard: covering the new member clears the red. */
const SIMULATED_TABLE_WITH_PIVOT = {
  ...SIMULATED_TABLE,
  pivot: 'table-2',
} satisfies Record<string, string>;

export type _TotalUnderGrownOnceCovered = AssertNever<
  Uncovered<GrownVocabulary, typeof SIMULATED_TABLE_WITH_PIVOT>
>;

/* ------------------------------------------------------------------ *
 * The real declarations, read from source.                            *
 * ------------------------------------------------------------------ */

/**
 * Read a package source file, from the repo root or from the package directory.
 *
 * NOT `new URL('../x', import.meta.url)`: Vite rewrites `import.meta.url` to a
 * SERVER-ROOT-relative path. The two candidates mirror the pair
 * `ViewSwitcher.test.tsx` already uses for the same reason.
 */
const readPackageSource = (file: string): string => {
  const candidates = [
    resolve(process.cwd(), 'packages/plugin-view/src', file),
    resolve(process.cwd(), 'src', file),
  ];
  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) {
    throw new Error(
      `cannot locate plugin-view/src/${file} from ${process.cwd()} — tried:\n  ${candidates.join('\n  ')}`,
    );
  }
  return readFileSync(found, 'utf8');
};

/** The declaration head plus the line that closes its object literal. */
function readDeclaration(source: string, name: string): { head: string; close: string; body: string } | null {
  const head = new RegExp(`^[^\\S\\n]*const ${name}\\b[^\\n]*$`, 'm').exec(source);
  if (!head) return null;
  const after = source.slice(head.index + head[0].length);
  const close = /^[^\S\n]*\}[^\n]*$/m.exec(after);
  if (!close) return null;
  return { head: head[0].trim(), close: close[0].trim(), body: after.slice(0, close.index) };
}

/**
 * The four tables this card repaired, as `[file, declaration]`.
 *
 * `ALL_VIEW_TYPES_TABLE` lives in the sibling suite and is listed here because
 * it is the same defect in the same package: it carried `satisfies
 * Record<ViewType, true>`, which FIRING CONTROL B above shows fails identically
 * to the annotation.
 */
const REPAIRED_TABLES: ReadonlyArray<readonly [file: string, declaration: string]> = [
  ['ViewSwitcher.tsx', 'DEFAULT_VIEW_LABELS'],
  ['ViewSwitcher.tsx', 'DEFAULT_VIEW_ICONS'],
  ['ObjectView.tsx', 'iconMap'],
  ['__tests__/ViewSwitcher.test.tsx', 'ALL_VIEW_TYPES_TABLE'],
];

describe('the ViewType totals survive an upstream retirement (objectui#9943)', () => {
  it('keeps the simulated legs honest: every table above is a real, non-empty reading', () => {
    // A census over an empty set passes, so the simulated tables are sized
    // before the type-level assertions above are trusted.
    expect(Object.keys(SIMULATED_TABLE)).toEqual(['list', 'detail', 'grid', 'page']);
    expect(Object.keys(SIMULATED_TABLE_WITH_PIVOT)).toEqual(['list', 'detail', 'grid', 'page', 'pivot']);
    expect(Object.keys(lookupUnderPublished)).toHaveLength(4);
    expect(Object.keys(lookupUnderMain)).toHaveLength(3);
    expect(Object.keys(retiredRowUnderTheAnnotation)).toContain('page');
    expect(Object.keys(retiredRowUnderSatisfiesExact)).toContain('page');
  });

  it.each(REPAIRED_TABLES)('%s / %s is read out of source at all — the precondition', (file, name) => {
    const found = readDeclaration(readPackageSource(file), name);
    expect(found, `cannot read \`${name}\` out of ${file} — the declaration moved or was renamed`).not.toBeNull();
    expect(found!.body.length, `\`${name}\` in ${file} read as an empty literal`).toBeGreaterThan(0);
  });

  it.each(REPAIRED_TABLES)('%s / %s carries no exact `ViewType` target', (file, name) => {
    const found = readDeclaration(readPackageSource(file), name)!;
    const oneLine = `${found.head} … ${found.close}`;
    // Both exact spellings, because both produce the same TS2353 — the
    // annotation on the head, and `satisfies Record<ViewType, …>` on the close.
    expect(
      /Record<\s*ViewType\b/.test(oneLine),
      `\`${name}\` in ${file} is back on an exact \`ViewType\` target (${oneLine}). That makes the\n`
        + 'retired `page` row an excess property (TS2353) against a spec built from objectstack\n'
        + '`main`, and the only repair an exact target admits is deleting a row the RESOLVED spec\n'
        + 'still accepts. Use `satisfies Record<string, …>` plus the totality assert (objectui#9943).',
    ).toBe(false);
    expect(found.close, `\`${name}\` in ${file} no longer closes on a \`satisfies\` constraint`).toContain('satisfies Record<string,');
  });

  it.each(REPAIRED_TABLES)('%s / %s keeps the added-member assert beside it', (file, name) => {
    const source = readPackageSource(file);
    expect(
      source.includes(`_AssertNever<Exclude<ViewType, keyof typeof ${name}>>`),
      `\`${name}\` in ${file} has lost its totality assert. Without it \`satisfies Record<string, …>\`\n`
        + 'accepts a table that covers only SOME of `ViewType`, so a member the spec ADDS lands with no\n'
        + 'row and nothing goes red — the guard objectui#5321 and objectui#8127 installed. Dropping it\n'
        + 'while making `page` inert is the regression objectui#9943 exists to prevent.',
    ).toBe(true);
  });

  it('the two source readers above can FAIL — the controls', () => {
    // Control 1: a head back on the exact annotation is reported, not shrugged at.
    const exactFixture = 'const T: Record<ViewType, string> = {\n  grid: \'table\',\n};\n';
    const exact = readDeclaration(exactFixture, 'T')!;
    expect(/Record<\s*ViewType\b/.test(`${exact.head} … ${exact.close}`)).toBe(true);

    // Control 2: a `satisfies`-closed head with NO assert anywhere in the file
    // is reported by the assert reader.
    const assertlessFixture = 'const T = {\n  grid: \'table\',\n} satisfies Record<string, string>;\n';
    const assertless = readDeclaration(assertlessFixture, 'T')!;
    expect(/Record<\s*ViewType\b/.test(`${assertless.head} … ${assertless.close}`)).toBe(false);
    expect(assertlessFixture.includes('_AssertNever<Exclude<ViewType, keyof typeof T>>')).toBe(false);

    // Control 3: the reader returns null for a name that is not there, rather
    // than a vacuously passing empty read.
    expect(readDeclaration(exactFixture, 'NOT_A_DECLARATION')).toBeNull();
  });

  it('every repaired table still carries the retired `page` row at runtime', () => {
    // The row is kept ON PURPOSE. `satisfies Record<string, …>` removes it from
    // nothing; what changes is that the TYPE stops demanding it. While the
    // resolved `@objectstack/spec` still publishes the kind an author can still
    // write a `page` view, and it has to draw with a label and an icon.
    for (const [file, name] of REPAIRED_TABLES) {
      const found = readDeclaration(readPackageSource(file), name)!;
      expect(
        /^[^\S\n]*page:/m.test(found.body),
        `\`${name}\` in ${file} has lost its \`page\` row. The resolved spec still publishes that\n`
          + 'list-view kind, so deleting the row degrades a view an author can legitimately write.',
      ).toBe(true);
    }
  });
});
