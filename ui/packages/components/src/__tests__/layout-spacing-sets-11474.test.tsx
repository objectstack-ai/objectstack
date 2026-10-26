/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every numeric layout input is ONE set in three places: the values the
 * renderer maps to a class the stylesheet defines, the set the zod declaration
 * accepts at the authoring doors, and the closed `enum` the registration
 * publishes into the SDUI manifest.
 *
 * objectui#11474 generalised objectui#11424's `container.padding` pin into this
 * file for the SPACING keys and classified the rest as "not spacing", holding
 * them to nothing. objectui#11491 extended it in place to EVERY numeric layout
 * input, the `grid` column counts among them. The file name is the family's
 * (objectui#11474's), kept so the pointers to it stay true; its scope is this
 * header's.
 *
 * ## What is enumerated — derived, not listed
 *
 * Every registration this package makes that declares LAYOUT containment
 * (`isContainer`), and every input on it whose value can be a number: a
 * `number` arm, or an `enum` arm of numbers (an input may declare several
 * arms). Each such input is one POSITION; an input that also publishes an
 * `object` arm takes an object keyed by breakpoint (`grid.columns`), and adds
 * one position per breakpoint. Each position is rendered through the real
 * `SchemaRenderer` across a range of candidates and classified by the classes
 * its value moves: SPACING (`gap-*`, `p-*`, `m-*`, `space-*`), COUNT
 * (`grid-cols-*`), or OTHER when it moves no class at all
 * (`aspect-ratio.ratio`, which sizes through style); OTHER is held to nothing
 * else. A position whose value moves a class of neither family fails as
 * unclassified, so a new family is decided rather than skipped. A new layout
 * node with a numeric input joins the enumeration the day it is registered.
 *
 * ## What "mapped" means — the compiled stylesheet decides
 *
 * The renderer is the truth (the objectui#7759 ruling: none of these keys is a
 * spec key, so the read site decides), and what it draws only counts when a
 * rule exists for it. Tailwind compiles the class names it finds in scanned
 * source text. `grid` builds `gap-[N*0.25rem]` at runtime for a number outside
 * its map, and no stylesheet carries that rule (measured on objectui#11474), so
 * a class string on the element is not the test. A candidate is MAPPED when the
 * classes its value draws are all rules in this package's own compiled
 * stylesheet (`src/index.css`, the sheet it ships as `style.css`, compiled here
 * exactly as `scripts/build-css.mjs` compiles it) AND one of them spells the
 * value (`gap-2`, `md:grid-cols-12`). A value that draws only classes other
 * values spell is not mapped: a bare `13` draws `grid`'s mobile-first ramp,
 * `grid-cols-1 sm:grid-cols-2`, and no count of its own. This file lives under
 * `__tests__/`, which that sheet does not scan, so the class names written
 * below cannot create the rules they look for.
 *
 * ⛔ An unmapped number draws no class of its own — the renderers neither
 * round, clamp nor substitute it, on purpose; the declaration refuses it
 * instead. What it may still draw is a class several mapped values share (the
 * ramp), never one that only some other single value draws.
 *
 * ## What each mapped-set position is held to
 *
 * - its zod declaration, at the authored spelling (flat on the node, or in the
 *   `properties` bag when the node refuses it flat, as `flex` does; the
 *   breakpoint object for a breakpoint position), accepts exactly the mapped
 *   set on the tolerant face (`safeValidateSchema`) and on the strict
 *   authoring face, which `objectui validate` runs — except an input in
 *   {@link REGISTERED_NOT_DECLARED}, whose reading is held instead;
 * - its registration input publishes a closed `enum` of exactly the mapped
 *   set, and a breakpoint position's input publishes an `object` arm whose
 *   members (`of`) are that `enum`;
 * - an absent value draws no utility of its family the stylesheet lacks; a
 *   spacing key's absent value draws exactly what the registration's default
 *   step draws.
 *
 * Module-scope import of the renderers, not `beforeAll` (AGENTS.md §测试纪律).
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindPostcss from '@tailwindcss/postcss';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '../renderers';
import { SchemaRenderer } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import type { BreakpointName } from '@object-ui/types';
import { safeValidateSchema, StrictAnyComponentSchema } from '@object-ui/types/zod';

/** Every candidate the derivation renders: a range past the widest set, plus fractions and a negative. */
const CANDIDATES = [...Array.from({ length: 33 }, (_, i) => i), -1, 0.5, 1.5, 2.5, 9.5];

/** A spacing utility at any variant: `gap-2`, `sm:gap-3`, `md:p-0.5`, `mx-auto`, `gap-[2.25rem]`. */
const isSpacingUtility = (token: string) =>
  /^(?:[\w-]+:)*-?(?:gap(?:-[xy])?|p[xytrblse]?|m[xytrblse]?|space-[xy])-/.test(token);

/** A column-count utility at any variant: `grid-cols-3`, `2xl:grid-cols-12`. */
const isColumnUtility = (token: string) => /^(?:[\w-]+:)*grid-cols-/.test(token);

/** Does the utility spell this value? `md:grid-cols-12` spells 12, `gap-1.5` spells 1.5. */
const spells = (token: string, n: number) => {
  const utility = token.replace(/^(?:[\w-]+:)*/, '');
  return utility.slice(utility.lastIndexOf('-') + 1) === String(n);
};

const sortNumbers = (values: Iterable<unknown>) => [...values].map(Number).sort((a, b) => a - b);

/**
 * The breakpoint vocabulary an object-arm position is keyed by. `satisfies`
 * makes it exhaustive both ways at compile time: a missing or an extra name
 * fails `tsc -p tsconfig.test.json`.
 */
const BREAKPOINTS = Object.keys({
  xs: 0,
  sm: 0,
  md: 0,
  lg: 0,
  xl: 0,
  '2xl': 0,
} satisfies Record<BreakpointName, 0>) as BreakpointName[];

/**
 * Registration inputs the renderer reads and NEITHER face of the node's
 * declaration declares: the tolerant face passes any value through
 * (`BaseSchema` is `.passthrough()`), and the strict face refuses the key at
 * every value (`unrecognized_keys`). Such a row's reading is held instead of
 * its declaration, both ways: a key that gets declared turns its row red, and
 * an undeclared input missing here turns the population row red.
 *
 * EMPTY, and the population row holds it empty. objectui#11491 measured four
 * rows here, `grid`'s flat `smColumns` / `mdColumns` / `lgColumns` /
 * `xlColumns`; objectui#11505 retired them (triage's ruling A): the
 * registration no longer offers them, the renderer no longer reads them, and
 * both faces refuse them by name, so the breakpoint object of `columns` is the
 * one spelling. A row added back here is a second spelling being registered.
 */
const REGISTERED_NOT_DECLARED: readonly string[] = [];

/* ── The compiled stylesheet ─────────────────────────────────────────────── */

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const entry = resolve(packageRoot, 'src/index.css');

/** CSS identifier escapes undone: `\32 xl\:gap-1\.5` -> `2xl:gap-1.5`. */
const unescapeIdent = (escaped: string) =>
  escaped
    .replace(/\\([0-9a-fA-F]{1,6}) ?/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\(.)/g, '$1');

/** The class names the compiled sheet has a rule for, read off each rule's leading class selector. */
async function compileDefinedClasses(): Promise<Set<string>> {
  const source = await readFile(entry, 'utf8');
  const result = await postcss([tailwindPostcss({ base: packageRoot })]).process(source, { from: entry });
  const defined = new Set<string>();
  postcss.parse(result.css, { from: entry }).walkRules((rule) => {
    for (const selector of rule.selectors) {
      const m = /^\.((?:\\[0-9a-fA-F]{1,6} ?|\\.|[\w-])+)/.exec(selector.trim());
      if (m) defined.add(unescapeIdent(m[1]));
    }
  });
  return defined;
}

let definedCache: Promise<Set<string>> | undefined;
const definedClasses = () => (definedCache ??= compileDefinedClasses());

/* ── The enumeration ─────────────────────────────────────────────────────── */

interface LayoutInput {
  /** The authored type: the registry key without its namespace. */
  type: string;
  key: string;
  input: { type?: unknown; enum?: unknown[]; of?: unknown };
  defaultValue: unknown;
}

const enumValues = (input: LayoutInput['input']) =>
  (input.enum ?? []).map((e) => (typeof e === 'object' && e !== null ? (e as { value: unknown }).value : e));

/** The arms an input declares: one, or an array of them. */
const armsOf = (declared: unknown): unknown[] => (Array.isArray(declared) ? declared : [declared]);

/** Every input with a numeric arm on every registered layout container, once per registration. */
const NUMERIC_LAYOUT_INPUTS: LayoutInput[] = (() => {
  const seen = new Set<unknown>();
  const out: LayoutInput[] = [];
  for (const config of ComponentRegistry.getAllConfigs()) {
    if (seen.has(config.type)) continue;
    seen.add(config.type);
    if (!config.isContainer) continue;
    const prefix = config.namespace ? `${config.namespace}:` : '';
    const type = prefix && config.type.startsWith(prefix) ? config.type.slice(prefix.length) : config.type;
    for (const input of config.inputs ?? []) {
      const arms = armsOf(input.type);
      const values = enumValues(input as LayoutInput['input']);
      const numeric =
        arms.includes('number') ||
        (arms.includes('enum') && values.length > 0 && values.every((v) => typeof v === 'number'));
      if (!numeric) continue;
      out.push({
        type,
        key: input.name,
        input: input as LayoutInput['input'],
        defaultValue: (config.defaultProps as Record<string, unknown> | undefined)?.[input.name],
      });
    }
  }
  return out.sort((a, b) => `${a.type}.${a.key}`.localeCompare(`${b.type}.${b.key}`));
})();

/** One place a numeric input's value is authored: the input itself, or one breakpoint of its object arm. */
interface Position {
  entry: LayoutInput;
  name: string;
  breakpoint?: BreakpointName;
  /** The node props carrying `n` at this position, as rendered. */
  at: (n: unknown) => Record<string, unknown>;
  /** The node props with no value at this position. */
  absent: Record<string, unknown>;
}

const positionsOf = (entry: LayoutInput): Position[] => {
  const own: Position = {
    entry,
    name: `${entry.type}.${entry.key}`,
    at: (n) => ({ [entry.key]: n }),
    absent: {},
  };
  if (!armsOf(entry.input.type).includes('object')) return [own];
  return [
    own,
    ...BREAKPOINTS.map((bp) => ({
      entry,
      name: `${entry.type}.${entry.key}.${bp}`,
      breakpoint: bp,
      at: (n: unknown) => ({ [entry.key]: { [bp]: n } }),
      absent: { [entry.key]: {} },
    })),
  ];
};

const POSITIONS: Position[] = NUMERIC_LAYOUT_INPUTS.flatMap(positionsOf);

/* ── Rendering ───────────────────────────────────────────────────────────── */

function classesOf(type: string, extra: Record<string, unknown>): string[] {
  const { container, unmount } = render(<SchemaRenderer schema={{ type, children: [], ...extra } as never} />);
  const tokens = ((container.firstElementChild as HTMLElement | null)?.className ?? '').split(/\s+/).filter(Boolean);
  unmount();
  return tokens;
}

type Family = 'spacing' | 'count' | 'other' | 'unclassified';

interface Derivation {
  /** The classes each candidate's value draws, beyond those every candidate draws. */
  drawn: Map<number, string[]>;
  /** Candidates whose drawn classes are all rules in the compiled sheet, one of them spelling the candidate. */
  mapped: number[];
  /** Drawn classes at least two mapped candidates share (`grid`'s ramp) — not any one value's. */
  shared: string[];
  family: Family;
}

const derivations = new Map<string, Promise<Derivation>>();

function derive(position: Position): Promise<Derivation> {
  let derivation = derivations.get(position.name);
  if (!derivation) {
    derivation = (async () => {
      const defined = await definedClasses();
      const { type } = position.entry;
      const raw = new Map(CANDIDATES.map((n) => [n, classesOf(type, position.at(n))]));
      const constant = [...raw.values()].reduce((acc, tokens) => acc.filter((t) => tokens.includes(t)));
      const drawn = new Map([...raw].map(([n, tokens]) => [n, tokens.filter((t) => !constant.includes(t))]));
      const mapped = CANDIDATES.filter((n) => {
        const tokens = drawn.get(n)!;
        return tokens.length > 0 && tokens.every((t) => defined.has(t)) && tokens.some((t) => spells(t, n));
      });
      const uses = new Map<string, number>();
      for (const n of mapped) for (const t of drawn.get(n)!) uses.set(t, (uses.get(t) ?? 0) + 1);
      const shared = [...uses].filter(([, count]) => count > 1).map(([t]) => t);
      const moved = [...new Set([...drawn.values()].flat())];
      const family: Family =
        moved.length === 0
          ? 'other'
          : moved.every(isSpacingUtility)
            ? 'spacing'
            : moved.every(isColumnUtility)
              ? 'count'
              : 'unclassified';
      return { drawn, mapped, shared, family };
    })();
    derivations.set(position.name, derivation);
  }
  return derivation;
}

/* ── The authoring doors ─────────────────────────────────────────────────── */

const FACES = {
  tolerant: (doc: unknown) => safeValidateSchema(doc).success,
  strict: (doc: unknown) => StrictAnyComponentSchema.safeParse(doc).success,
} as const;

/**
 * The spelling the input is authored in: flat on the node when the tolerant
 * face takes the registration's default there, otherwise in the `properties`
 * bag (`flex`, objectui#11276). Derived from the declaration.
 */
function authoredSpelling({ type, key, defaultValue }: LayoutInput): (props: Record<string, unknown>) => Record<string, unknown> {
  const flat = (props: Record<string, unknown>) => ({ type, ...props });
  const bag = (props: Record<string, unknown>) => ({ type, properties: props });
  if (FACES.tolerant(flat({ [key]: defaultValue }))) return flat;
  expect(FACES.tolerant(bag({ [key]: defaultValue })), `${type}.${key}: no authored spelling takes the default ${String(defaultValue)}`).toBe(true);
  return bag;
}

/** The strict face refuses the input's key itself, at a mapped value: no face declares it. */
function undeclared(position: Position, mapped: number[]): boolean {
  const result = StrictAnyComponentSchema.safeParse(authoredSpelling(position.entry)(position.at(mapped[0])));
  if (result.success) return false;
  return result.error.issues.every(
    (issue) => issue.code === 'unrecognized_keys' && issue.keys.includes(position.entry.key),
  );
}

/* ── The pins ────────────────────────────────────────────────────────────── */

describe('numeric layout inputs: the rendered set, the declared set and the registered set are one (objectui#11474, objectui#11491)', () => {
  it('the instrument sees the stylesheet: mapped utilities, variants and arbitrary values are all readable', async () => {
    const defined = await definedClasses();
    expect(defined.size).toBeGreaterThan(800);
    // A variant and an escaped dot read back unescaped …
    expect(defined.has('sm:gap-2')).toBe(true);
    expect(defined.has('gap-1.5')).toBe(true);
    // … a digit-led variant does too (`\32 xl\:` in the sheet) …
    expect(defined.has('2xl:grid-cols-12')).toBe(true);
    // … and an arbitrary value is readable at all, so an absent `gap-[…]` is a real absence.
    expect([...defined].some((c) => /^[\w-]+-\[[^\]]+\]$/.test(c))).toBe(true);
  }, 60_000);

  it('the enumeration is not vacuous: it finds numeric layout inputs of every family, and the object arm is expanded', async () => {
    expect(NUMERIC_LAYOUT_INPUTS.length).toBeGreaterThan(0);
    const byFamily: Record<Family, string[]> = { spacing: [], count: [], other: [], unclassified: [] };
    for (const position of POSITIONS) byFamily[(await derive(position)).family].push(position.name);
    // Lit controls: the key objectui#11424 closed first, and the count objectui#11491 closed.
    expect(byFamily.spacing).toContain('container.padding');
    expect(byFamily.spacing.length).toBeGreaterThan(1);
    expect(byFamily.count).toContain('grid.columns');
    for (const bp of BREAKPOINTS) expect(byFamily.count).toContain(`grid.columns.${bp}`);
    expect(byFamily.unclassified, 'a numeric layout input moves a class of no known family').toEqual([]);
  }, 120_000);

  it('the registered-but-undeclared ledger is exactly the inputs no face declares', async () => {
    const found: string[] = [];
    for (const position of POSITIONS.filter((p) => !p.breakpoint)) {
      const { mapped } = await derive(position);
      if (mapped.length > 0 && undeclared(position, mapped)) found.push(position.name);
    }
    expect(found.sort()).toEqual([...REGISTERED_NOT_DECLARED].sort());
  }, 120_000);

  for (const position of POSITIONS) {
    const { entry, name } = position;

    it(`${name}: when it moves a class, its declaration and registration are its mapped set`, async () => {
      const { drawn, mapped, shared, family } = await derive(position);
      expect(family, `${name} moves a class of no known family`).not.toBe('unclassified');
      if (family === 'other') {
        // Moves no class: nothing else is held here.
        expect(mapped).toEqual([]);
        return;
      }

      // The derivation reads the defect itself: mapped values AND unmapped numbers.
      expect(mapped.length, `${name}: no candidate is mapped`).toBeGreaterThan(0);
      expect(mapped.length, `${name}: every candidate is mapped — an open scale is not a closed set`).toBeLessThan(
        CANDIDATES.length,
      );

      // An unmapped number draws no class of its own the stylesheet defines: not
      // rounded, not clamped, not substituted. A shared class (the ramp) may stay.
      const defined = await definedClasses();
      for (const n of CANDIDATES.filter((c) => !mapped.includes(c))) {
        expect(
          drawn.get(n)!.filter((t) => defined.has(t) && !shared.includes(t)),
          `${name} ${n}`,
        ).toEqual([]);
      }

      // The declaration, at both authoring doors.
      const spelling = authoredSpelling(entry);
      if (REGISTERED_NOT_DECLARED.includes(name)) {
        // Held as read: the tolerant face takes every candidate through, the strict face none.
        expect(CANDIDATES.filter((n) => !FACES.tolerant(spelling(position.at(n)))), `${name} on the tolerant face`).toEqual([]);
        expect(CANDIDATES.filter((n) => FACES.strict(spelling(position.at(n)))), `${name} on the strict face`).toEqual([]);
      } else {
        for (const [face, parse] of Object.entries(FACES)) {
          const declared = CANDIDATES.filter((n) => parse(spelling(position.at(n))));
          expect(sortNumbers(declared), `${name} on the ${face} face`).toEqual(sortNumbers(mapped));
        }
      }

      // The registration, as a closed enum; a breakpoint's members, through `of`.
      const arms = armsOf(entry.input.type);
      expect(arms, `${name} registration input`).toContain('enum');
      expect(sortNumbers(enumValues(entry.input)), `${name} registration enum`).toEqual(sortNumbers(mapped));
      if (position.breakpoint) {
        expect(arms, `${name}: the breakpoint object is published`).toContain('object');
        expect(armsOf(entry.input.of), `${name}: its members are the enum`).toContain('enum');
      }

      // Control: an absent value draws no utility of its family the stylesheet lacks …
      const ofFamily = family === 'spacing' ? isSpacingUtility : isColumnUtility;
      const absent = classesOf(entry.type, position.absent).filter(ofFamily);
      expect(absent.filter((t) => !defined.has(t)), `${name} absent`).toEqual([]);
      // … and a spacing key's absent value draws exactly the registration's default step.
      if (family === 'spacing') {
        expect(mapped).toContain(entry.defaultValue);
        expect(absent).toEqual(classesOf(entry.type, { [entry.key]: entry.defaultValue }).filter(ofFamily));
      }
    }, 60_000);
  }
});
