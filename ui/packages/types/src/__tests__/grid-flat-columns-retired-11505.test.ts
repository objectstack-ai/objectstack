/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11505 — the `grid` node's flat per-breakpoint column keys,
 * `smColumns`, `mdColumns`, `lgColumns` and `xlColumns`, are retired on both
 * faces. The breakpoint object of `columns` is the one spelling.
 *
 * ## The split this closes
 *
 * The `grid` registration offered the four keys as inputs and the renderer
 * read them over the breakpoint object, but no face of `GridSchema` declared
 * them: the strict authoring face refused each key at every value
 * (`unrecognized_keys`), and the tolerant face (`safeValidateSchema`) passed
 * any value through `BaseSchema`'s
 * `.passthrough()`, so `mdColumns: 'wide'` validated. Triage's ruling A on the
 * card: retire the flat channel, with no alias and no deprecation window.
 *
 * ## The pins
 *
 * Each key is a `?: never` tombstone on the TypeScript face and a
 * `retirementTombstone` on the zod face. ⛔ Not a deletion: the index
 * signature and `.passthrough()` would type it `any` and parse it green. Every
 * value is refused at the key's own path on the strict face, the tolerant face
 * and the mirror, and the message names the breakpoint object member to write.
 * The prescription is checked by evaluation, not by reading: the migrated
 * document it describes parses on both faces. That it draws the classes the
 * flat document drew is the render half, pinned in
 * `components/src/__tests__/grid-flat-columns-retired-11505.test.tsx`.
 *
 * ## Two instruments, and which half each one reads
 *
 * The `Expect` / `Equal` aliases and the `@ts-expect-error` directives are
 * TYPE-level: `tsc -p tsconfig.test.json` (a leg of this package's
 * `type-check` script) reads them. The `safeParse` / `safeValidateSchema` rows
 * are RUNTIME, and vitest reads them. A green run of either alone says nothing
 * about the other.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { GridSchema, StrictAnyComponentSchema, safeValidateSchema } from '../zod/index.zod.js';
import type { GridSchema as Ts_GridSchema } from '../layout';

/* ── Type-level pins: the `tsc` channel ────────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type Shape = (typeof GridSchema)['shape'];
type InputOf<K extends keyof Shape> = Shape[K] extends z.ZodType ? z.input<Shape[K]> : never;

/**
 * Each retired key READS as `undefined` on the TypeScript face (`?: never`
 * without `exactOptionalPropertyTypes` collapses to `undefined`), which
 * `Equal` separates from the `any` a deletion left behind `BaseSchema`'s index
 * signature until objectui#8347 (a deletion fails to compile at the indexed
 * access now).
 */
export type assertionRetiredKeysReadAsTombstones = [
  Expect<Equal<Ts_GridSchema['smColumns'], undefined>>,
  Expect<Equal<Ts_GridSchema['mdColumns'], undefined>>,
  Expect<Equal<Ts_GridSchema['lgColumns'], undefined>>,
  Expect<Equal<Ts_GridSchema['xlColumns'], undefined>>,
];

/** The zod face agrees: each retired key accepts nothing but absence. */
export type assertionZodFaceAcceptsOnlyAbsence = [
  Expect<Equal<InputOf<'smColumns'>, undefined>>,
  Expect<Equal<InputOf<'mdColumns'>, undefined>>,
  Expect<Equal<InputOf<'lgColumns'>, undefined>>,
  Expect<Equal<InputOf<'xlColumns'>, undefined>>,
];

/** Non-vacuity: `columns`, the one spelling, keeps its breakpoint object on both faces. */
export type assertionColumnsKeepsTheBreakpointObject = [
  Expect<Equal<Extract<Ts_GridSchema['columns'], object>['md'], Extract<InputOf<'columns'>, object>['md']>>,
];

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const RETIRED = {
  smColumns: 'sm',
  mdColumns: 'md',
  lgColumns: 'lg',
  xlColumns: 'xl',
} as const;

/**
 * Values the tolerant face used to pass through, unexamined: the counts the
 * registration offered, a count outside them, and values no count spells.
 */
const FORMER_VALUES: readonly unknown[] = [2, 12, 13, 0, 'wide', null, { md: 2 }];

const NODE = { type: 'grid' as const, columns: 4 as const, children: [] };
const UNKNOWN_KEY = 'zzzNotAKeyAnySurfaceDeclares11505';

type Issue = { code: string; path: PropertyKey[]; message: string };
type Parse = { success: boolean; error?: { issues: Issue[] } };

const strict = StrictAnyComponentSchema as unknown as { safeParse: (v: unknown) => Parse };
const issuesOf = (result: Parse): Issue[] => (result.success ? [] : (result.error?.issues ?? []));
const pathsOf = (result: Parse): string[] => issuesOf(result).map((i) => i.path.map(String).join('.'));

/* ── The `tsc` half on fresh literals ─────────────────────────────────────── */

describe('authoring a flat grid column key is a `tsc` error (objectui#11505)', () => {
  it('refuses each of the four — presence is the error, not the value', () => {
    // @ts-expect-error `smColumns` is retired (objectui#11505) — write `columns: { sm: N }`
    const a: Ts_GridSchema = { type: 'grid', smColumns: 2 };
    // @ts-expect-error `mdColumns` is retired (objectui#11505) — write `columns: { md: N }`
    const b: Ts_GridSchema = { type: 'grid', columns: 1, mdColumns: 2 };
    // @ts-expect-error `lgColumns` is retired (objectui#11505) — write `columns: { lg: N }`
    const c: Ts_GridSchema = { type: 'grid', lgColumns: 4 };
    // @ts-expect-error `xlColumns` is retired (objectui#11505) — write `columns: { xl: N }`
    const d: Ts_GridSchema = { type: 'grid', columns: { xs: 1 }, xlColumns: 6 };
    // The one spelling compiles: the control that the four rows above measure the keys.
    const e: Ts_GridSchema = { type: 'grid', columns: { xs: 1, sm: 2, md: 2, lg: 4, xl: 6 } };
    expect([a, b, c, d, e].every((n) => n.type === 'grid')).toBe(true);
  });
});

/* ── The runtime half: refused by name, with the prescription ─────────────── */

describe('the zod face refuses each flat grid column key by name (objectui#11505)', () => {
  for (const [key, breakpoint] of Object.entries(RETIRED)) {
    it(`\`${key}\` is refused at its own path on the strict face, the tolerant face and the mirror, at every value`, () => {
      for (const value of FORMER_VALUES) {
        const doc = { ...NODE, [key]: value };
        const label = `${key}: ${JSON.stringify(value)}`;
        expect(pathsOf(strict.safeParse(doc)), `strict, ${label}`).toEqual([key]);
        expect(pathsOf(safeValidateSchema(doc) as Parse), `tolerant, ${label}`).toEqual([key]);
        expect(pathsOf(GridSchema.safeParse(doc) as Parse), `mirror, ${label}`).toEqual([key]);
      }
    });

    it(`\`${key}\`'s refusal is the tombstone's, on both doors, and names \`columns: { ${breakpoint}: N }\``, () => {
      const doc = { ...NODE, [key]: 2 };
      for (const [face, result] of [
        ['strict', strict.safeParse(doc)],
        ['tolerant', safeValidateSchema(doc) as Parse],
      ] as const) {
        const [issue] = issuesOf(result);
        // `invalid_type`, the tombstone's code, and not the strict face's
        // `unrecognized_keys`: the key is declared, and refused by name.
        expect(issue?.code, face).toBe('invalid_type');
        expect(issue?.message.startsWith(`RETIRED (objectui#11505, ADR-0049) — \`${key}\` on \`grid\``), face).toBe(true);
        expect(issue?.message, face).toContain('Instead:');
        expect(issue?.message, face).toContain(`\`columns: { ${breakpoint}: N }\``);
      }
    });
  }

  it('the prescription parses: each migrated document the refusal describes validates on both faces', () => {
    // A bare `columns: C` beside a flat key becomes the object's `xs: C`; with
    // no `columns`, the object takes `xs: 2`. Every breakpoint at once, too.
    const migrated = [
      { type: 'grid', columns: { xs: 1, md: 2, lg: 4 } },
      { type: 'grid', columns: { xs: 2, sm: 3 } },
      { type: 'grid', columns: { xs: 4, sm: 1, md: 2, lg: 3, xl: 6 } },
    ];
    for (const doc of migrated) {
      expect(issuesOf(strict.safeParse(doc)), JSON.stringify(doc)).toEqual([]);
      expect(issuesOf(safeValidateSchema(doc) as Parse), JSON.stringify(doc)).toEqual([]);
    }
  });

  it('lit control: the node without the keys parses on every face, and an undeclared key stays green on the tolerant one', () => {
    expect(issuesOf(strict.safeParse(NODE))).toEqual([]);
    expect(issuesOf(safeValidateSchema(NODE) as Parse)).toEqual([]);
    expect(issuesOf(safeValidateSchema({ ...NODE, [UNKNOWN_KEY]: 2 }) as Parse)).toEqual([]);
    // … and the strict face refuses that undeclared key as `unrecognized_keys`,
    // the answer the four retired keys got before they were declared refusals.
    expect(issuesOf(strict.safeParse({ ...NODE, [UNKNOWN_KEY]: 2 })).map((i) => i.code)).toEqual(['unrecognized_keys']);
  });
});
