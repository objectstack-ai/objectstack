/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#8466 — `ObjectCalendarSchema.colorField` and
 * `ObjectCalendarSchema.allDayField` declared, on both faces.
 *
 * ## The defect
 *
 * `ObjectCalendar.tsx`'s `getCalendarConfig` reads FIVE flat field-name keys off
 * the node, and `plugin-calendar/README.md` teaches all five in one sentence —
 * "point `titleField` / `startDateField` / `endDateField` / `allDayField` /
 * `colorField` at your own fields when they differ." Only THREE of the five were
 * declared. The other two reached the renderer through `BaseSchema`'s
 * `[key: string]: any` on the TS side and its `.passthrough()` on the mirror:
 * admitted, never examined by either published face. A misspelling therefore
 * left the calendar silently colourless while every published gate passed.
 *
 * ⚠️ Dated note, 2026-10-01 — objectui#8831. The README sentence quoted above
 * is no longer how `object-calendar` is taught. `ComponentPropsMap['object-calendar']`
 * refuses all five flat keys and its diagnostic prescribes the `calendar`
 * block, so the README now authors the five INSIDE that block and names the
 * flat spelling as the runtime handoff `ObjectView`/`ListView` emit (it keeps
 * the five-key sentence for `calendar-view` only, where flat is the one
 * spelling). The declarations this file pins did NOT move: they record that the
 * renderer READS the flat spelling, not that an author should write it. The
 * README row below pins the new teaching.
 *
 * ## Why BOTH keys, and the measurement that decided the second one
 *
 * The two keys look asymmetric and are not. `colorField` IS a spec key — but
 * only inside the NESTED `calendar` block (`CalendarConfigSchema`). At the FLAT
 * position, which is the position this interface declares,
 * `ComponentPropsMap['object-calendar']` refuses `colorField` and `allDayField`
 * IDENTICALLY, with the same `unrecognized_keys` diagnostic — and it refuses
 * `titleField`, `startDateField` and `endDateField` the same way, all three of
 * which have shipped DECLARED here for releases.
 *
 * So the "declaring `allDayField` widens past the contract" objection, if it
 * held, would condemn three shipped members too. It does not hold, and the
 * reason is the direction of travel: the flat face is objectui's own lane, taken
 * deliberately (`zod/objectql.zod.ts` keeps `.passthrough()` naming this very key
 * — "the renderers grow config knobs ahead of the protocol (calendar's
 * `allDayField`, for one), and stripping them here would silently disable a
 * shipped capability"). Under an index signature and a `.passthrough()` that
 * ALREADY admit any value, a declaration cannot widen anything; it only NARROWS,
 * by adding value validation where there was none. Commandment #0.1 bans the
 * lenient direction, and this is the strict one.
 *
 * That whole argument rests on measurements, so this file PINS them — the spec's
 * five refusals and its accepting controls — rather than restating them in prose
 * that could rot when the spec moves.
 *
 * ## The boundary this card does NOT cross
 *
 * Neither key is added to `plugin-calendar`'s registration `inputs`, and that is
 * load-bearing, not an oversight: the FORWARD direction of
 * `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts` refuses an
 * `inputs` entry the spec props schema does not accept, so declaring these there
 * would redden the merge queue. The three sibling flat keys are absent from
 * `inputs` for exactly the same reason. Pinned below.
 *
 * ## What declaring buys — and what it does NOT, measured not assumed
 *
 * objectui#7927 measured the ceiling: `BaseSchema` ended in `[key: string]: any`,
 * so no annotation here could catch a MISSPELLED key. objectui#8347 removed the
 * signature, so the TS face refuses `colourField` on a fresh literal now (pinned
 * below); the tolerant zod face still admits it, and the control assertions
 * below PIN that, so nobody reads this file as claiming more than it does. What
 * the ceiling never capped is the VALUE
 * dimension, and that is the half this file pins — on the TS face through
 * `@ts-expect-error` directives that go UNUSED (TS2578, a hard type-check
 * failure) the moment their member is widened (since objectui#8347 a deletion
 * keeps them used and is caught by the `Equal` rows), and on the mirror through
 * refusals that land ON the key and reach `safeValidateSchema`, the path the
 * CLI's `validate` / `check` take.
 *
 * ## Instruments, borrowed from `kanban-calendar-filter-sort-8174.test.ts`
 *
 * Membership is asserted on the mirror's OWN `.shape`, never on parse acceptance
 * (under `.passthrough()` acceptance cannot tell "declared" from "admitted
 * unexamined"). Type-level pins use invariant equality, so a member that fell
 * back to the index signature read as `any` and therefore as a failure (since
 * objectui#8347 removed the signature, a deleted member's indexed access does
 * not compile at all). And
 * every claim carries a CONTROL asserted to hold the opposite verdict, so no
 * assertion can pass vacuously.
 *
 * ## What an off-disk assertion may anchor to (objectui#8832)
 *
 * Three of the off-disk assertions below used to anchor to FORMATTING rather
 * than to behaviour: the renderer's `(schema as any).KEY` cast SPELLING, a regex
 * over a `useMemo` dependency list's TEXT, and the README's LINE WRAP. A fourth
 * `it` asserted a record literal it had written three lines earlier, which
 * cannot fail at all. The cast pin was the sharpest: dropping that cast is the
 * cleanup declaring these keys makes possible, so the pin reddened on the
 * improvement it existed to enable.
 *
 * The rule they now follow: read the FACT off disk — this key is read off the
 * node; this key is in that memo's dependency list; these five are authored
 * inside the `calendar` block and never flat (objectui#8831) — never the shape
 * the fact happens to be written in. Casts, whitespace,
 * dep ordering and fill width are all formatting, and each helper below is built
 * so none of them can move a verdict. Each carries a control known to fire in
 * the same region, because a re-anchor that can no longer go red has not fixed
 * the assertion, it has deleted it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CalendarConfigSchema, ComponentPropsMap } from '@objectstack/spec/ui';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

import { ObjectCalendarSchema, safeValidateSchema } from '../zod/index.zod';
import type { ObjectCalendarSchema as TsObjectCalendarSchema } from '../objectql';
import type { CalendarViewSchema as TsCalendarViewSchema } from '../complex';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

const CALENDAR_READER = 'packages/plugin-calendar/src/ObjectCalendar.tsx';
const CALENDAR_REGISTRATION = 'packages/plugin-calendar/src/index.tsx';
const CALENDAR_README = 'packages/plugin-calendar/README.md';

/**
 * The five field-name keys `getCalendarConfig` reads off the node FLAT (the
 * runtime handoff), and that the README authors inside the `calendar` block.
 */
const FLAT_KEYS = ['titleField', 'startDateField', 'endDateField', 'allDayField', 'colorField'] as const;
/** The three that were already declared — the precedent the two new ones join. */
const ALREADY_DECLARED = ['titleField', 'startDateField', 'endDateField'] as const;
/** The two this card declares. */
const NEWLY_DECLARED = ['colorField', 'allDayField'] as const;

/**
 * A key the renderer never reads and neither face declares. Non-vacuity control
 * for every "declared" assertion: it must stay no member of the TS face (it
 * read `any` there until objectui#8347) and out of the mirror shape, while
 * still being ADMITTED by the tolerant mirror's `.passthrough()`.
 */
const CONTROL_KEY = 'swatchField';
/** A declared-and-read control for the off-disk read census, read BARE. */
const READ_CONTROL_KEY = 'objectName';
/** The same, read through a CAST — the census must see both forms, not one. */
const CAST_READ_CONTROL_KEY = 'defaultView';
/** The misspelling the tolerant mirror still admits (the TS face refuses it since objectui#8347). */
const MISSPELLING = 'colourField';

const CALENDAR_NODE = { type: 'object-calendar', objectName: 'event' } as const;

/* ── Type-level pins (invariant equality, house form) ─────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
/** The canonical `any` detector: only `any` absorbs `1 &` down to something `0` extends. */
type IsAny<T> = 0 extends (1 & T) ? true : false;
/** An object with no keys is assignable to `Pick<T, K>` only when `K` is optional on `T`. */
type IsOptional<T, K extends keyof T> = Record<string, never> extends Pick<T, K> ? true : false;

// `colorField` is DERIVED from the spec's `CalendarConfig`, so it resolves to
// that member's type. Delete the member and the indexed access fell back to
// `[key: string]: any`, making `IsAny` true and this `Equal` false; since
// objectui#8347 it stops compiling instead.
export type _ColorFieldIsString = Expect<Equal<TsObjectCalendarSchema['colorField'], string | undefined>>;
export type _ColorFieldIsNotAny = Expect<Equal<IsAny<TsObjectCalendarSchema['colorField']>, false>>;
export type _ColorFieldIsOptional = Expect<IsOptional<TsObjectCalendarSchema, 'colorField'>>;
export type _AllDayFieldIsString = Expect<Equal<TsObjectCalendarSchema['allDayField'], string | undefined>>;
export type _AllDayFieldIsNotAny = Expect<Equal<IsAny<TsObjectCalendarSchema['allDayField']>, false>>;
export type _AllDayFieldIsOptional = Expect<IsOptional<TsObjectCalendarSchema, 'allDayField'>>;
// The control key is undeclared, exactly as the two above were before this card.
// Until objectui#8347 it fell through `BaseSchema`'s index signature and read
// `any`; that signature is gone, so it is no member at all. `IsAny<any>` is the
// lit control that keeps the `IsNotAny` lines above readings rather than a
// type that says `false` for everything.
export type _IsAnyCanAnswerTrue = Expect<IsAny<any>>;
export type _ControlKeyIsNoMember = Expect<Equal<'swatchField' extends keyof TsObjectCalendarSchema ? true : false, false>>;
// objectui#7927's ceiling ("a misspelling is still admitted") was pinned here
// rather than claimed away; objectui#8347 removed it, so the misspelling is no
// member either, and a fresh literal carrying it is refused (below).
export type _MisspellingIsNoMember = Expect<Equal<'colourField' extends keyof TsObjectCalendarSchema ? true : false, false>>;

// The SIBLING interface in the same plugin — served by its OWN renderer, which
// reads the same five flat keys — already declares all five. A member that fell
// back to the index signature read as `any` and failed these (since
// objectui#8347 a deleted member's indexed access does not compile), so these five
// lines are what would catch the shared flat vocabulary drifting apart.
type Declared<T, K extends keyof T> = Equal<IsAny<T[K]>, false>;
const siblingPins: [
  Expect<Declared<TsCalendarViewSchema, 'titleField'>>,
  Expect<Declared<TsCalendarViewSchema, 'startDateField'>>,
  Expect<Declared<TsCalendarViewSchema, 'endDateField'>>,
  Expect<Declared<TsCalendarViewSchema, 'allDayField'>>,
  Expect<Declared<TsCalendarViewSchema, 'colorField'>>,
] = [true, true, true, true, true];
// Control: a key the sibling does not declare either is no member of it — it
// read `any` through the index signature until objectui#8347 removed it.
export type _SiblingControlIsNoMember = Expect<Equal<'swatchField' extends keyof TsCalendarViewSchema ? true : false, false>>;

// The TS face ACCEPTS the flat handoff shape…
const calendarLiteral: TsObjectCalendarSchema = {
  ...CALENDAR_NODE,
  colorField: 'status_colour',
  allDayField: 'is_all_day',
};

// …and REFUSES wrong-typed values the index signature used to admit. Each
// directive goes unused — TS2578, a hard failure — if its member is widened to
// accept the value. A deletion keeps it used since objectui#8347 (the value is
// refused as an undeclared key) and is caught by the `Equal` rows above.
// @ts-expect-error — `colorField` names a FIELD, so it is a string, not the colour itself
const calendarBadColorField: TsObjectCalendarSchema = { ...CALENDAR_NODE, colorField: 0xff0000 };
// @ts-expect-error — `allDayField` names a FIELD; a boolean is the VALUE, the confusion this declaration catches
const calendarBadAllDayField: TsObjectCalendarSchema = { ...CALENDAR_NODE, allDayField: true };
// …and, since objectui#8347 removed `BaseSchema`'s index signature, the misspelling itself.
// @ts-expect-error — `colourField` is no member of `ObjectCalendarSchema`; the key is `colorField`
const calendarMisspelledKey: TsObjectCalendarSchema = { ...CALENDAR_NODE, colourField: 'status_colour' };

/* ── Off-disk derivations ─────────────────────────────────────────────────── */

function readRepo(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/**
 * Every key read off the schema node, in EITHER form: the bare `schema.KEY` and
 * the cast `(schema as any).KEY`. Both spell the same FACT — the renderer reads
 * this key — and only one of them spells it through a cast that a future cleanup
 * deletes once the key is declared. Reading the fact rather than the spelling is
 * what stops the verdicts below reddening on that cleanup (objectui#8832).
 */
const SCHEMA_READ = /(?:\bschema\b|\(\s*schema\s+as\s+[^)]*\))\s*\.\s*([A-Za-z_$][\w$]*)/g;

function schemaReads(source: string): Set<string> {
  return new Set([...source.matchAll(SCHEMA_READ)].map((m) => m[1]));
}

/** Every key a renderer reads off the node, off disk. */
function rendererReads(rel: string): Set<string> {
  return schemaReads(readRepo(rel));
}

/**
 * Everything `getCalendarConfig` ITSELF reads off the node, sliced out of the
 * renderer by brace matching so the verdict is about that function and not about
 * the file that happens to contain it. Throws rather than returning empty when
 * the function is gone, so a vanished anchor reads as a failure, never a pass.
 */
function configReaderReads(source: string): Set<string> {
  const open = /function\s+getCalendarConfig\s*\([^)]*\)\s*:\s*[^{]*\{/.exec(source);
  if (!open) {
    throw new Error(`${CALENDAR_READER}: \`getCalendarConfig\` is gone; the reads it records moved somewhere else`);
  }
  const from = open.index + open[0].length;
  let depth = 1;
  let i = from;
  for (; i < source.length && depth > 0; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') depth -= 1;
  }
  return schemaReads(source.slice(from, i - 1));
}

/**
 * The dependency list of the memo that recomputes the calendar config, sliced
 * out by bracket matching and then read with the same census. The locator
 * tolerates any whitespace and the census ignores order, so a formatter run, a
 * reordered dep or a changed print width cannot move the verdict — only the memo
 * ceasing to depend on a key can. Throws rather than returning empty when the
 * memo is gone, so a vanished anchor reads as a failure and never as a pass.
 */
function configMemoDeps(source: string): Set<string> {
  const open = /useMemo\s*\(\s*\(\s*\)\s*=>\s*getCalendarConfig\s*\(\s*schema\s*\)\s*,\s*\[/.exec(source);
  if (!open) {
    throw new Error(`${CALENDAR_READER}: the calendar config is no longer memoised on the node's keys`);
  }
  const from = open.index + open[0].length;
  let depth = 1;
  let i = from;
  for (; i < source.length && depth > 0; i += 1) {
    if (source[i] === '[') depth += 1;
    else if (source[i] === ']') depth -= 1;
  }
  return schemaReads(source.slice(from, i - 1));
}

const OPENERS = '{[(';
const CLOSERS = '}])';

/** The index of the bracket that closes the one opened at `open`. Throws rather than guessing. */
function matchingClose(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (OPENERS.includes(code[i])) depth += 1;
    else if (CLOSERS.includes(code[i])) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unterminated literal from offset ${open}`);
}

/**
 * Every node a markdown document AUTHORS with `type: '<type>'` in a TypeScript
 * fence, as the text of the object literal that carries that `type` key
 * (objectui#8831). Brace-matched, never line- or indent-based, so a re-wrap or
 * a re-indent cannot move a verdict; comments are masked first, so a key named
 * in a comment is not read as one written.
 */
function authoredNodes(markdown: string, type: string): string[] {
  const nodes: string[] = [];
  const typeKey = new RegExp(`\\btype\\s*:\\s*['"]${type}['"]`, 'g');
  for (const fence of markdown.matchAll(/^```(?:ts|tsx|typescript)\n([\s\S]*?)^```/gm)) {
    const code = mask(fence[1]);
    for (const m of code.matchAll(typeKey)) {
      // Walk BACK to the bracket that opens the literal holding this key.
      let depth = 0;
      let open = -1;
      for (let i = (m.index ?? 0) - 1; i >= 0 && open < 0; i -= 1) {
        if (CLOSERS.includes(code[i])) depth += 1;
        else if (OPENERS.includes(code[i])) {
          if (depth === 0) open = i;
          else depth -= 1;
        }
      }
      if (open < 0 || code[open] !== '{') {
        throw new Error(`a \`type: '${type}'\` key outside any object literal`);
      }
      nodes.push(code.slice(open, matchingClose(code, open) + 1));
    }
  }
  return nodes;
}

/** An object literal's text with every NESTED bracket region blanked, so only its own top level is left. */
function topLevelText(literal: string): string {
  // Indexed by UTF-16 unit, not by code point, so offsets into the result are
  // offsets into `literal` — `memberLiteral` below depends on that.
  let depth = 0;
  let out = '';
  for (let i = 0; i < literal.length; i += 1) {
    const c = literal[i];
    if (OPENERS.includes(c)) depth += 1;
    out += depth === 1 ? c : ' ';
    if (CLOSERS.includes(c)) depth -= 1;
  }
  return out;
}

/** The keys written at the top level of an object literal — a nested block's keys are not among them. */
function topLevelKeys(literal: string): string[] {
  return [...topLevelText(literal).matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]);
}

/** The object literal written as the value of top-level `key`, or `undefined` when there is none. */
function memberLiteral(literal: string, key: string): string | undefined {
  const m = new RegExp(`[{,]\\s*${key}\\s*:`).exec(topLevelText(literal));
  if (!m) return undefined;
  // Skip whitespace in the ORIGINAL text: in the top-level text the nested
  // opener is itself blanked to a space, so it cannot be looked for there.
  let at = m.index + m[0].length;
  while (/\s/.test(literal[at] ?? '')) at += 1;
  return literal[at] === '{' ? literal.slice(at, matchingClose(literal, at) + 1) : undefined;
}

function shapeKeys(schema: unknown): string[] {
  return Object.keys((schema as { shape: Record<string, unknown> }).shape);
}

/**
 * ⚠️ `ComponentPropsMap` entries are read through `Record<string, any>` on
 * purpose — here, and again at the `unrecognized_keys` census below. Both raise
 * an `@typescript-eslint/no-explicit-any` WARNING, never an error (eslint over
 * this file: exit 0, 0 errors, exactly these 2 warnings), and both are KEPT.
 * `_def` is a zod INTERNAL for which the spec publishes no type, so a
 * hand-written shape for it would be a local ASSERTION about a third-party
 * runtime that nothing re-checks — it would go stale in silence, which is the
 * exact failure mode this file exists to catch. The sibling instrument file
 * these were borrowed from (`kanban-calendar-filter-sort-8174.test.ts`) carries
 * three of the same warnings for the same reason.
 *
 * ⛔ An `eslint-disable` is not the remedy — THIS COMMENT is, because it records
 * WHY. A directive only silences, and `eslint.config.js` sets
 * `reportUnusedDisableDirectives: 'error'` on every linted path, so a directive
 * left behind after the cast is ever retyped stops being a silencer and becomes
 * a hard error.
 */
function specShapeKeys(type: string): string[] {
  const entry = (ComponentPropsMap as unknown as Record<string, any>)[type];
  const def = entry._def;
  const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
  return Object.keys(shape);
}

/* ── The reads: the fact the declarations record ──────────────────────────── */

describe('objectui#8466 — the renderer reads these keys, which is what the declarations record', () => {
  it('`getCalendarConfig` reads all five flat keys off the node', () => {
    // The FACT, not the spelling. This used to assert the source contained the
    // literal `(schema as any).KEY` — the very cast a cleanup deletes once the
    // key is declared, which this card is what makes possible. So the pin went
    // red on the improvement it existed to enable (objectui#8832; PR #8799 is
    // the precedent, dropping `(schema as any).navigation` once `navigation`
    // was declared). The census reads both forms, so the cleanup lands green.
    const reads = configReaderReads(readRepo(CALENDAR_READER));
    for (const key of FLAT_KEYS) {
      expect([...reads], `getCalendarConfig no longer reads the flat ${key}`).toContain(key);
    }
    // Controls, both fired in THIS slice: `calendar` is the config container the
    // function prefers over the flat five and is not one of them, so the slice is
    // not empty by accident; `objectName` is read all over the same FILE and
    // never inside this function, so a slice that had swallowed the file — which
    // is what would make the five verdicts above cheap — fails here instead.
    expect([...reads]).toContain('calendar');
    expect(reads.has(READ_CONTROL_KEY)).toBe(false);
  });

  it('…and `allDayField` is LOAD-BEARING, not merely resolved (objectui#8026)', () => {
    // The premise that removed triage's "declaring an inert key would be worse"
    // objection. If the renderer ever stops honouring the key, this reddens
    // BEFORE anyone trusts the declaration to mean something.
    //
    // The fact: the key is in the dependency list of the memo that recomputes
    // the config, which is what makes an authored change reach the screen. That
    // used to be a regex over the list's TEXT, so a formatter run, a reordered
    // dep or a changed print width moved the verdict with no behaviour moving
    // (objectui#8832). The list is sliced out structurally instead, and read
    // with the same census, so only the dependency itself can move it.
    const deps = configMemoDeps(readRepo(CALENDAR_READER));
    for (const key of FLAT_KEYS) {
      expect([...deps], `${key} left the config memo's dependency list`).toContain(key);
    }
    // Controls in both directions, each known to fire in THIS region: `calendar`
    // is in this very list and is not one of the five, so the slice is not empty
    // by accident; `objectName` and `filter` are read elsewhere in the same file
    // — `objectName` in the sibling `dataConfig` memo — and are deliberately out
    // of this one, so a slice that had swallowed the file, or caught the wrong
    // memo, fails here instead of passing.
    expect([...deps]).toContain('calendar');
    expect(deps.has(READ_CONTROL_KEY)).toBe(false);
    expect(deps.has('filter')).toBe(false);
  });

  it('the reads census returns a firing control, so the verdicts above are readings', () => {
    const reads = rendererReads(CALENDAR_READER);
    // One control per read FORM, because the census now claims to see both and a
    // single bare-form control would leave the cast form unmeasured: the renderer
    // reads `schema.objectName` bare and `(schema as any).defaultView` through a
    // cast, and neither is one of the five under test.
    expect(reads.has(READ_CONTROL_KEY)).toBe(true);
    expect(reads.has(CAST_READ_CONTROL_KEY)).toBe(true);
    expect(reads.has(CONTROL_KEY)).toBe(false);
  });

  it('the README authors the five INSIDE the `calendar` block on `object-calendar`, never flat (objectui#8831)', () => {
    // This row used to pin the opposite — that the README taught the five flat,
    // "which is what makes them authorable". objectui#8831 ruled that spelling
    // the runtime handoff: `ComponentPropsMap['object-calendar']` refuses it and
    // its diagnostic prescribes the `calendar` block. So the README teaches the
    // block, and the declarations this file pins stay because the renderer
    // READS the flat spelling, not because an author should write it.
    //
    // Read off the authored nodes by brace matching, never by line or indent,
    // so a re-wrap or re-indent cannot move the verdict (objectui#8832).
    const readme = readRepo(CALENDAR_README);
    const nodes = authoredNodes(readme, 'object-calendar');
    expect(nodes.length, 'the README authors no `object-calendar` node, so the rows below read nothing').toBeGreaterThan(0);
    for (const node of nodes) {
      const top = topLevelKeys(node);
      // Firing control at the SAME depth: the slice is the whole node.
      expect(top).toContain(READ_CONTROL_KEY);
      for (const key of FLAT_KEYS) {
        expect(top, `a README \`object-calendar\` node writes \`${key}\` flat`).not.toContain(key);
      }
    }
    // The teaching moved; it did not vanish. One node writes all five in its
    // block — `allDayField` included, which the spec declares there since 17.5.0.
    const blocks = nodes.map((node) => memberLiteral(node, 'calendar')).filter((b): b is string => b !== undefined);
    expect(
      blocks.some((block) => FLAT_KEYS.every((key) => topLevelKeys(block).includes(key))),
      'no README `calendar` block carries all five field-name keys',
    ).toBe(true);
    // Control, same instrument, opposite verdict: a `calendar-view` node has no
    // `calendar` block, so the README writes the keys flat there, and the
    // extractor sees a flat key when one is written.
    const views = authoredNodes(readme, 'calendar-view');
    expect(views.some((view) => topLevelKeys(view).includes('titleField'))).toBe(true);
  });
});

/* ── The spec face: the measurement that decided `allDayField` ────────────── */

describe('objectui#8466 — the spec refuses ALL FIVE flat keys, which is why declaring widens nothing', () => {
  it('`ComponentPropsMap["object-calendar"]` declares none of the five at top level', () => {
    const declared = specShapeKeys('object-calendar');
    for (const key of FLAT_KEYS) {
      expect(declared, `spec now declares the flat ${key}; revisit this card's reasoning`).not.toContain(key);
    }
    // Non-vacuity: the same extraction returns the keys the spec certainly does
    // declare at this position, so the five absences are readings.
    expect(declared).toContain(READ_CONTROL_KEY);
    expect(declared).toContain('calendar');
    expect(declared).toContain('defaultView');
  });

  it('…and refuses each of the five IDENTICALLY, with `unrecognized_keys`', () => {
    // This is the measurement that resolves the `colorField` / `allDayField`
    // asymmetry: at the FLAT position there is none. The three already-shipped
    // members are refused by exactly the same diagnostic as the two new ones.
    const oc = (ComponentPropsMap as unknown as Record<string, any>)['object-calendar'];
    for (const key of FLAT_KEYS) {
      const r = oc.safeParse({ [key]: 'x' });
      expect(r.success, `spec now accepts the flat ${key}`).toBe(false);
      expect(r.error.issues.map((i: { code: string }) => i.code)).toContain('unrecognized_keys');
    }
    // Both controls fire: keys the spec DOES declare parse green here.
    expect(oc.safeParse({ [READ_CONTROL_KEY]: 'event' }).success).toBe(true);
    expect(oc.safeParse({ locale: 'en-GB' }).success).toBe(true);
  });

  it('`colorField` and `allDayField` ARE spec keys — but only in the NESTED block, which is a different position', () => {
    // The distinction the whole decision turns on: what the spec declares
    // NESTED says nothing about the FLAT position, which the row above measures.
    // Through `@objectstack/spec` 17.4.0 `CalendarConfigSchema` was a
    // strictObject of four keys: it had `colorField` and refused `allDayField`
    // by name, an asymmetry that was real nested and absent flat. 17.5.0
    // declares `allDayField` in the nested block too (objectui#11073), so the
    // nested asymmetry is gone; the flat refusal of all five did not move.
    expect(Object.keys(CalendarConfigSchema.shape)).toEqual([
      'startDateField',
      'endDateField',
      'titleField',
      'colorField',
      'allDayField',
    ]);
    expect(CalendarConfigSchema.safeParse({ startDateField: 's', allDayField: 'x' }).success).toBe(true);
    expect(CalendarConfigSchema.safeParse({ startDateField: 's', colorField: 'c' }).success).toBe(true);
    // Firing control: a key the nested block never declared is still refused by name.
    const nested = CalendarConfigSchema.safeParse({ startDateField: 's', dateField: 'x' });
    expect(nested.success).toBe(false);
    if (!nested.success) {
      expect(nested.error.issues.map((i) => i.code)).toContain('unrecognized_keys');
    }
  });
});

/* ── The sibling interface: two renderers, one flat vocabulary ────────────── */

describe('objectui#8466 — `calendar-view` already declared all five, and the two must not fork', () => {
  it('ONE renderer serves both `object-calendar` and `calendar`', () => {
    // `ObjectCalendarRenderer` is registered twice — under `object-calendar`
    // and under `calendar`, and the same `getCalendarConfig` reads the same five
    // keys off both. ⛔ NOT under `calendar-view`: that element has its OWN
    // renderer (`calendar-view-renderer.tsx`, which imports neither
    // `ObjectCalendarRenderer` nor `getCalendarConfig`) and reads the five flat
    // keys off `schema` itself. So the flat vocabulary spans THREE registered
    // type names across TWO renderers, which is what makes a drift between the
    // two interfaces a real defect rather than a tidiness point.
    const src = readRepo(CALENDAR_REGISTRATION);
    expect(src).toContain("ComponentRegistry.register('object-calendar', ObjectCalendarRenderer");
    expect(src).toContain("ComponentRegistry.register('calendar', ObjectCalendarRenderer");
  });

  it('the sibling five are pinned at COMPILE time; this keeps that tuple referenced and its arity honest', () => {
    // READ THE TITLE. The pin that `CalendarViewSchema` declares all five — the
    // reason declaring `allDayField` is not a new precedent — is the
    // `siblingPins` tuple above: five `Expect<Declared<…>>` slots that only
    // type-check while the sibling declares all five, enforced by Type Check.
    //
    // This `it` cannot fail for that reason, and it used to read as though it
    // could: it asserted a record literal it had written three lines earlier,
    // and counted the tuple against a hard-coded 5 — both vacuous at runtime
    // (objectui#8832). A future reader trusting a green runtime test that never
    // had teeth is the failure mode, so the title now says what this is.
    //
    // What it does check, and the one way it goes red: the tuple carries one
    // slot per flat key, so a sixth key added to `FLAT_KEYS` without a sixth
    // slot would leave that key unpinned on the sibling — silently, because a
    // shorter tuple still type-checks. That arity is the runtime-checkable half.
    expect(siblingPins, 'a flat key has no `siblingPins` slot, so the sibling interface is unpinned for it')
      .toHaveLength(FLAT_KEYS.length);
  });
});

/* ── The boundary: `inputs` stays clear of the flat face ──────────────────── */

describe('objectui#8466 — the registration `inputs` deliberately declares NO flat key', () => {
  it('none of the five is an `inputs` entry, so the parity gate stays green', () => {
    // `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts` FORWARD
    // direction: a block may not declare a top-level input the spec refuses.
    // All five are refused, so all five must stay out of `inputs`.
    const src = readRepo(CALENDAR_REGISTRATION);
    for (const key of FLAT_KEYS) {
      expect(src, `${key} became an inputs entry; the parity gate's forward direction will refuse it`)
        .not.toMatch(new RegExp(`name:\\s*'${key}'`));
    }
    // Firing control: keys that ARE inputs entries are found by the same regex.
    expect(src).toMatch(/name:\s*'objectName'/);
    expect(src).toMatch(/name:\s*'defaultView'/);
  });
});

/* ── The zod mirror ───────────────────────────────────────────────────────── */

describe('objectui#8466 — the mirror declares what the interface declares', () => {
  it('membership, read off the mirror shape (acceptance cannot tell declared from admitted)', () => {
    const keys = shapeKeys(ObjectCalendarSchema);
    for (const key of [...ALREADY_DECLARED, ...NEWLY_DECLARED]) expect(keys).toContain(key);
    // The control stays out, which keeps the assertions above from being
    // satisfied by a shape that simply contains everything.
    expect(keys).not.toContain(CONTROL_KEY);
    expect(keys).not.toContain(MISSPELLING);
  });

  it('accepts the flat handoff shape `ObjectView`/`ListView` emit, and the values SURVIVE the parse', () => {
    const node = { ...CALENDAR_NODE, colorField: 'status_colour', allDayField: 'is_all_day' };
    const r = ObjectCalendarSchema.safeParse(node);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    if (r.success) {
      expect((r.data as Record<string, unknown>).colorField).toBe('status_colour');
      expect((r.data as Record<string, unknown>).allDayField).toBe('is_all_day');
    }
    // …and through the published union entry point, so the right arm is reached.
    expect(safeValidateSchema(node).success).toBe(true);
  });

  it('both members stay OPTIONAL: the node without them parses green — this adds no requiredness', () => {
    expect(ObjectCalendarSchema.safeParse(CALENDAR_NODE).success).toBe(true);
    expect(safeValidateSchema(CALENDAR_NODE).success).toBe(true);
  });

  it.each([
    ['colorField', 0xff0000],
    ['colorField', { hex: '#ff0000' }],
    // The confusion the declaration catches: the FLAG rather than the FIELD NAME.
    ['allDayField', true],
    ['allDayField', ['is_all_day']],
  ] as const)('refuses a wrong-typed `%s` (%j) AT the key — the verdict declaring MOVES', (key, value) => {
    // Before this card every one of these rode `.passthrough()` unexamined.
    const r = ObjectCalendarSchema.safeParse({ ...CALENDAR_NODE, [key]: value });
    expect(r.success).toBe(false);
    if (!r.success) {
      // The refusal must land ON the key, not merely somewhere in the node —
      // which is what distinguishes value validation from an unrelated refusal.
      const paths = r.error.issues.map((i) => (i.path ?? []).join('.'));
      expect(paths, JSON.stringify(paths)).toContain(key);
    }
    // …and the same refusal through the path the CLI's `validate` / `check` reach.
    expect(safeValidateSchema({ ...CALENDAR_NODE, [key]: value }).success).toBe(false);
  });

  it('the objectui#7927 ceiling is UNCHANGED: a misspelled key is still admitted', () => {
    // This card buys value validation, not misspelling detection. Pinning the
    // ceiling is what stops the change being read as more than it is — and
    // turns red if `.passthrough()` is ever tightened, which would be #7927's
    // job and would need this file revisited.
    expect(ObjectCalendarSchema.safeParse({ ...CALENDAR_NODE, [MISSPELLING]: 'x' }).success).toBe(true);
    expect(ObjectCalendarSchema.safeParse({ ...CALENDAR_NODE, [CONTROL_KEY]: 'x' }).success).toBe(true);
    // Even a wrong-TYPED misspelling rides through, which is the sharp edge:
    // the value validation above reaches only the spelling that is declared.
    expect(ObjectCalendarSchema.safeParse({ ...CALENDAR_NODE, [MISSPELLING]: true }).success).toBe(true);
  });
});

/* ── Keep the type-level consts referenced (they are the pins) ─────────────── */

describe('objectui#8466 — the TS face accepts the flat handoff node', () => {
  it('the accepted literal carries the values it was authored with', () => {
    expect(calendarLiteral.colorField).toBe('status_colour');
    expect(calendarLiteral.allDayField).toBe('is_all_day');
    // The refused literals exist only so their `@ts-expect-error` directives do;
    // referencing them keeps `noUnusedLocals` off this file's back.
    expect([calendarBadColorField, calendarBadAllDayField, calendarMisspelledKey]).toHaveLength(3);
  });
});
