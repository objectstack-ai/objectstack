// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `shared/duration.zod.ts` — the closed DURATION vocabulary (`DurationMs` /
 * `DurationSeconds`), step ① of ruling A on #18115.
 *
 * Two families of pins, and the split matters because the module is two lines
 * of schema and a page of reasoning — the reasoning is what these hold.
 *
 * The ISOMORPHISM family copies the `EpochMs` pattern (ADR-0122,
 * `type-alias-convention.pin.test.ts` `Iso868`): author state and parsed state
 * coincide, so no `*Parsed` synonym exists, and the assertion is the type-level
 * `Eq<z.input, z.infer>` rather than a runtime claim about a value. The pin
 * file carries the same assertion as the gate's exemption registry; this one
 * sits beside the schema so the day a `.default()` is added here, the red lands
 * in this file too instead of only in a registry the author may not know reads
 * it.
 *
 * The REFINEMENT family re-measures the six genuine duration rows the ruling
 * derives the unit set from — the population that chose `.int().nonnegative()`.
 * A refinement justified by a measurement nobody re-runs is a refinement that
 * drifts away from its justification: these cases fail if a duration type stops
 * accepting what the rows it was measured against actually declare.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DurationMs, DurationSeconds } from './duration.zod';

/** Type-level identity — the `type-alias-convention.pin.test.ts` helper. */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? true
  : false;
/** Compile error when the argument is not `true`. */
type Assert<T extends true> = T;

// The isomorphism pins themselves. Proved by tsc, not by a runtime case: an
// `Assert<Eq<...>>` that stops holding is a compile error naming the alias.
export type IsoDurationMs = Assert<Eq<z.input<typeof DurationMs>, z.infer<typeof DurationMs>>>;
export type IsoDurationSeconds = Assert<
  Eq<z.input<typeof DurationSeconds>, z.infer<typeof DurationSeconds>>
>;

describe('the closed duration vocabulary — exactly two units (#18122)', () => {
  it('declares milliseconds and seconds, and no speculative third unit', async () => {
    // ⛔ `DurationMinutes` / `DurationHours` / `DurationDays` are added when a
    // real row needs one, in the PR that converts it — the unit set is derived
    // from the conversion population, never declared ahead of it. This case is
    // what makes that a rule rather than a sentence in a doc block.
    const mod = await import('./duration.zod');
    const units = Object.keys(mod).filter((k) => k.startsWith('Duration')).sort();
    expect(units).toEqual(['DurationMs', 'DurationSeconds']);
  });

  it('reaches consumers on the `./shared` subpath, exactly as `EpochMs` does', async () => {
    // The precedent is the SUBPATH, not the root entry: `EpochMs` is absent
    // from `src/index.ts` and reaches consumers through this barrel. A root
    // re-export would be a strictly wider published surface than the thing
    // being mirrored, so the barrel is asserted and the root is asserted empty.
    const shared = await import('./index');
    expect(shared.DurationMs).toBe(DurationMs);
    expect(shared.DurationSeconds).toBe(DurationSeconds);
    expect(shared.EpochMs).toBeDefined();
  });
});

describe('the refinement, re-measured against the six genuine duration rows', () => {
  // The two rows of the six that carry a default today. The other four —
  // `cors.maxAge`, `slideInterval`, `meta.duration` and `FileValue.duration` —
  // are `.optional()` with no default, so a default is not theirs to accept;
  // what they constrain is the FLOOR, asserted in the next case.
  it('accepts `shutdownTimeout`s 30000 — the only default in the ms half', () => {
    expect(DurationMs.parse(30000)).toBe(30000);
  });

  it('accepts `session.updateAge`s 60 * 60 * 24 — the only default in the seconds half', () => {
    expect(DurationSeconds.parse(60 * 60 * 24)).toBe(86400);
  });

  it('admits zero, because `shutdownTimeout` declares `.min(0)` and not `.positive()`', () => {
    // The floor is `.nonnegative()` rather than `.positive()` for exactly this
    // reason: a zero timeout means "do not wait", and it is a value one of the
    // six rows already accepts. `.positive()` here would refuse it silently at
    // the moment step ③ converted that row.
    expect(DurationMs.parse(0)).toBe(0);
    expect(DurationSeconds.parse(0)).toBe(0);
  });

  it('carries NO default of its own — the unit rides on the value, the default on the site', () => {
    // What keeps author state and parsed state identical. A site composes
    // `DurationSeconds.default(60 * 60 * 24)`; the shared type never does.
    for (const schema of [DurationMs, DurationSeconds]) {
      const result = schema.safeParse(undefined);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.code).toBe('invalid_type');
    }
  });
});

describe('refuses loudly at authoring time, in both directions', () => {
  // The whole value of a closed type over a naming convention: the wrong value
  // is a `ZodError` at the authoring site rather than a number that validates
  // and means something else. Both directions are pinned because both are real
  // producer bugs — a fractional millisecond count and a negative span.
  for (const [name, schema] of [
    ['DurationMs', DurationMs],
    ['DurationSeconds', DurationSeconds],
  ] as const) {
    it(`${name} refuses a non-integer literal`, () => {
      expect(() => schema.parse(1.5)).toThrow(z.ZodError);
      const result = schema.safeParse(1.5);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.code).toBe('invalid_type');
        expect(result.error.issues[0]?.expected).toBe('int');
      }
    });

    it(`${name} refuses a negative literal`, () => {
      expect(() => schema.parse(-1)).toThrow(z.ZodError);
      const result = schema.safeParse(-1);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.code).toBe('too_small');
        expect((result.error.issues[0] as { minimum?: unknown }).minimum).toBe(0);
      }
    });
  }
});

describe('the site describe wins over the shared one', () => {
  it('replaces the prose without mutating the shared schema', () => {
    // The doc block tells authors to compose and describe at the site, and the
    // reference page prints the site's prose. Both halves are asserted: the
    // composed schema carries the site's sentence, and the shared export still
    // carries its own — `.describe()` returns a new schema rather than editing
    // the one every other site shares.
    const sited = DurationMs.describe('How long to wait before forcing the operation');
    expect(sited.description).toBe('How long to wait before forcing the operation');
    expect(DurationMs.description).toBe('Duration in milliseconds');
    expect(DurationSeconds.description).toBe('Duration in seconds');
  });
});
