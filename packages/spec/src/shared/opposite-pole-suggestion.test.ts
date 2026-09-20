// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The axis-silent key trap — `dateField` answered with `endDateField` while
 * every consumer folds `dateField` onto the event's START.
 *
 * What makes this defect worth its own file rather than a row in
 * `suggestions.test.ts` is that none of its parts is wrong on its own.
 * `findClosestMatches` ranks correctly, the budget is the right budget, and
 * `endDateField` is a real declared key the runtime honours perfectly. The
 * defect is the COMPOSITION: on a shape declaring both ends of a range, the
 * cheaper-spelled end wins a question the author never asked, and the answer
 * parses. So the legs below are written to fail for different reasons — the
 * arithmetic leg re-measures the premise, the bright leg pins that the raw
 * suggester still WOULD name the wrong end, the main leg pins what ships, and
 * the dark legs pin everything that must not have moved.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { levenshteinDistance, findClosestMatches } from './suggestions.zod';
import { strictObject } from './strict-object';
import { POLARITY_AXES, oppositePoleAmbiguity } from './polarity-axes';
import { CalendarConfigSchema, GanttConfigSchema, TimelineConfigSchema } from '../ui/view.zod';

/** The budget `strictUnknownKeyError` actually spends, reproduced, not imported. */
const budget = (key: string) => Math.max(2, Math.floor(key.length / 3));
/** The fold `findClosestMatches` scores under. */
const fold = (v: string) => v.toLowerCase().replace(/[-\s]/g, '_');

const RANGE_SURFACES = {
  'this calendar configuration': CalendarConfigSchema,
  'this gantt configuration': GanttConfigSchema,
  'this timeline configuration': TimelineConfigSchema,
} as const;

/** The one `unrecognized_keys` message a probe object produces, or `undefined`. */
function rejectionMessage(schema: z.ZodType, doc: unknown): string | undefined {
  const result = schema.safeParse(doc);
  if (result.success) return undefined;
  return result.error.issues.find((i) => i.code === 'unrecognized_keys')?.message;
}

/** A probe that is valid except for the one key under test. */
const CANONICAL = { startDateField: 'starts_at', endDateField: 'ends_at', titleField: 'name' } as const;
const probe = (key: string) => ({ ...CANONICAL, [key]: 'due_date' });

// ---------------------------------------------------------------------------
// LEG 1 — the arithmetic, RE-MEASURED. Never 3 and 5 as literals.
// ---------------------------------------------------------------------------

describe('the distance arithmetic that creates the trap', () => {
  // Filed as "`datefield` is 3 from `enddatefield` and 5 from `startdatefield`,
  // against a 9-character key's budget of 3". Those two numbers are the premise
  // the whole card rests on, and a premise copied forward is how this card came
  // to carry a mechanism its own filer had retracted. So the relation is
  // recomputed here on every run and the numbers are never written down: if a
  // rename, a fold change or a budget change moves it, this fails and names the
  // measurement rather than leaving a stale comment behind.
  it('re-derives that the WRONG end is reachable and the right one is not', () => {
    const authored = 'dateField';
    const toEnd = levenshteinDistance(fold(authored), fold('endDateField'));
    const toStart = levenshteinDistance(fold(authored), fold('startDateField'));
    const allowed = budget(authored);

    expect(toEnd).toBeLessThanOrEqual(allowed);
    expect(toStart).toBeGreaterThan(allowed);
    // The asymmetry is pure spelling: `end` is a 3-letter token, `start` a
    // 5-letter one. Nothing semantic separates them, which is exactly why the
    // ranking cannot be trusted to choose between them.
    expect(toStart - toEnd).toBe('start'.length - 'end'.length);
  });

  it('re-derives that `endField` is out of budget — the dark control is structural', () => {
    // The filer's own control table observed "no hint for `endField`" without
    // knowing why. This is why: an 8-character key buys a budget of 2 and the
    // nearest declared key is further than that.
    const authored = 'endField';
    const allowed = budget(authored);
    for (const candidate of ['endDateField', 'startDateField']) {
      expect(levenshteinDistance(fold(authored), fold(candidate))).toBeGreaterThan(allowed);
    }
  });
});

// ---------------------------------------------------------------------------
// LEG 2 — BRIGHT CONTROL. The raw suggester still points at the wrong end.
// ---------------------------------------------------------------------------

describe('bright control: the trap candidate is still what the ranking produces', () => {
  // This is the leg that keeps the main leg honest. If `endDateField` ever
  // stopped being the nearest-within-budget candidate, the main leg below would
  // pass for a reason that has nothing to do with the guard, and deleting the
  // guard would leave every test green. Pin the input to the guard, not just
  // its output.
  it.each(Object.keys(RANGE_SURFACES))('%s: unguarded ranking answers `endDateField`', (surface) => {
    const schema = RANGE_SURFACES[surface as keyof typeof RANGE_SURFACES];
    const declared = Object.keys((schema as unknown as { _zod: { def: { shape: object } } })._zod.def.shape);
    expect(declared).toContain('startDateField');
    expect(declared).toContain('endDateField');
    expect(findClosestMatches('dateField', declared, budget('dateField'), 1)[0]).toBe('endDateField');
  });
});

// ---------------------------------------------------------------------------
// LEG 3 — MAIN. What actually ships to the author.
// ---------------------------------------------------------------------------

describe('main: an axis-silent key is answered with BOTH ends, never one', () => {
  it.each(Object.keys(RANGE_SURFACES))('%s: `dateField` names both ends', (surface) => {
    const message = rejectionMessage(RANGE_SURFACES[surface as keyof typeof RANGE_SURFACES], probe('dateField'));
    expect(message).toBeDefined();
    // The defect, stated as the assertion that would have failed before:
    // a single rename pointing at the end of the event.
    expect(message).not.toContain('→ `endDateField`');
    expect(message).not.toMatch(/Did you mean/);
    // What replaces it names both ends, in axis order.
    expect(message).toContain('`startDateField`');
    expect(message).toContain('`endDateField`');
    expect(message!.indexOf('`startDateField`')).toBeLessThan(message!.indexOf('`endDateField`'));
    // And says out loud that the wrong choice is a SILENT one — the property
    // that made this worth a card rather than a note.
    expect(message).toContain('both parse');
  });

  it('gantt: the second attested pair on the same surface is covered too', () => {
    // `baselineStartField` / `baselineEndField`, found by census rather than by
    // reading the card: `baselineField` is 3 from `baselineendfield` inside a
    // 13-character key's budget of 4, and 5 from `baselinestartfield`.
    const declared = Object.keys(
      (GanttConfigSchema as unknown as { _zod: { def: { shape: object } } })._zod.def.shape,
    );
    expect(findClosestMatches('baselineField', declared, budget('baselineField'), 1)[0])
      .toBe('baselineEndField');
    const message = rejectionMessage(GanttConfigSchema, { ...CANONICAL, baselineField: 'x' });
    expect(message).not.toContain('→ `baselineEndField`');
    expect(message).toContain('`baselineStartField`');
    expect(message).toContain('`baselineEndField`');
  });

  it('⛔ the accepted key set does NOT move — `dateField` is still refused', () => {
    // The stop condition on this card is that declaring `dateField` as an alias
    // would widen the accepted surface. Nothing here accepts it: before the
    // change it was rejected with a misleading hint, after the change it is
    // rejected with an honest one.
    for (const [surface, schema] of Object.entries(RANGE_SURFACES)) {
      const withAxisSilentKey = schema.safeParse(probe('dateField'));
      expect(withAxisSilentKey.success, surface).toBe(false);
      expect(
        withAxisSilentKey.success ? [] : withAxisSilentKey.error.issues.map((i) => i.code),
      ).toContain('unrecognized_keys');
      // The canonical document still parses, so nothing was narrowed either.
      expect(schema.safeParse(CANONICAL).success, surface).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// LEG 4 — DARK CONTROLS. Refusal code AND text unchanged.
// ---------------------------------------------------------------------------

describe('dark controls: keys that had no hint before still have none', () => {
  it.each(Object.keys(RANGE_SURFACES))('%s: `endField` and a nonsense key are untouched', (surface) => {
    const schema = RANGE_SURFACES[surface as keyof typeof RANGE_SURFACES];
    const nonsense = rejectionMessage(schema, probe('zzqqwx'));
    const endField = rejectionMessage(schema, probe('endField'));
    expect(nonsense).toBeDefined();
    expect(endField).toBeDefined();
    for (const message of [nonsense!, endField!]) {
      expect(message).not.toMatch(/Did you mean/);
      expect(message).not.toContain('•');
    }
    // Stronger than "no hint": byte-identical to the no-suggestion shape, with
    // only the key name differing. This pins the refusal TEXT, not just the
    // absence of a suggestion, without transcribing the surface's `history`
    // sentence into this file where it would rot.
    expect(endField).toBe(nonsense!.replace('`zzqqwx`', '`endField`'));
  });
});

// ---------------------------------------------------------------------------
// LEG 5 — the guard's boundaries, on synthetic shapes.
// ---------------------------------------------------------------------------

describe('the guard fires on omission and NOT on a typo', () => {
  const RangeSurface = strictObject(
    { surface: 'this probe surface', history: 'History.' },
    {
      minLength: z.number().optional(),
      maxLength: z.number().optional(),
      startDateField: z.string().optional(),
      endDateField: z.string().optional(),
      titleField: z.string().optional(),
    },
  );

  it('keeps the rename for a dropped character in a pole-carrying key', () => {
    // `axLength` is one deleted character from `maxLength` and names no pole,
    // so conditions 1-3 of the guard all hold. Condition 4 — "closer to the
    // stripped key than to the key itself" — is what tells a typo apart from
    // an omission, and it is the reason this suggestion survives.
    const message = rejectionMessage(RangeSurface, { axLength: 1 });
    expect(message).toContain('Did you mean `axLength` → `maxLength`?');
  });

  it('suppresses the rename when the author simply omitted the axis', () => {
    const message = rejectionMessage(RangeSurface, { dateField: 'x' });
    expect(message).not.toMatch(/Did you mean/);
    expect(message).toContain('`startDateField`');
    expect(message).toContain('`endDateField`');
  });

  it('leaves a key that NAMES its end alone', () => {
    // `startDatField` carries `start`, so the author already answered the
    // question the guard exists to stop the suggester from answering for them.
    const message = rejectionMessage(RangeSurface, { startDatField: 'x' });
    expect(message).toContain('→ `startDateField`');
  });

  it('never screens a DECLARED alias, even onto one end of an axis', () => {
    // Precedence, pinned from the direction that matters: a human statement
    // about one spelling outranks this guard. ⛔ No in-repo surface declares
    // `dateField` — the stop condition on #18572 forbids exactly that — so the
    // precedence is proven on a synthetic table instead of by adding one.
    const Declared = strictObject(
      { surface: 'this declaring surface', history: 'History.', aliases: { dateField: 'startDateField' } },
      { startDateField: z.string().optional(), endDateField: z.string().optional() },
    );
    expect(rejectionMessage(Declared, { dateField: 'x' }))
      .toContain('Did you mean `dateField` → `startDateField`?');
  });

  it('does nothing when only ONE end of the axis is declared', () => {
    // Condition 3. With no sibling there is no coin flip — the suggestion is
    // the only reading available and stays.
    const OneEnded = strictObject(
      { surface: 'this one-ended surface', history: 'History.' },
      { endDateField: z.string().optional(), titleField: z.string().optional() },
    );
    expect(rejectionMessage(OneEnded, { dateField: 'x' })).toContain('→ `endDateField`');
  });

  it('screens the guessed candidate only — the helper is a pure predicate', () => {
    const candidates = ['startDateField', 'endDateField', 'titleField'];
    expect(oppositePoleAmbiguity('dateField', 'endDateField', candidates)?.poles)
      .toEqual(['startDateField', 'endDateField']);
    expect(oppositePoleAmbiguity('dateField', 'titleField', candidates)).toBeUndefined();
    expect(oppositePoleAmbiguity('endDatField', 'endDateField', candidates)).toBeUndefined();
    expect(oppositePoleAmbiguity('dateField', 'endDateField', ['endDateField'])).toBeUndefined();
  });
});

describe('the axis table', () => {
  it('declares each pair once, in a stable naming order, with distinct tokens', () => {
    const seen = new Set<string>();
    for (const [low, high] of POLARITY_AXES) {
      expect(low).not.toBe(high);
      for (const token of [low, high]) {
        expect(seen.has(token), `\`${token}\` appears on two axes`).toBe(false);
        seen.add(token);
      }
    }
  });
});
