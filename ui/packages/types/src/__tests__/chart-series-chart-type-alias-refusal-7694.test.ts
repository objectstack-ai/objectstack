/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7694 — `ChartDataSeriesSchema.chartType` is a NAMED ALIAS REFUSAL
 * pointing at `type` (`domain:ui` PM ruling on objectui#7546 and the contract
 * review of PR #7684: option A — the posture `@objectstack/spec` takes).
 *
 * ## The defect (measured on origin/main a00db9ef9 before this change)
 *
 * `ChartDataSeriesSchema` is a NON-STRICT `z.object` and `chartType` was
 * undeclared on it, so `{ name: 'r', chartType: 'line' }` parsed GREEN to
 * `{ name: 'r' }` — the key STRIPPED in silence — while the renderer's
 * `normalizeSeries` reads that very key FIRST
 * (`str(raw.chartType) ?? str(raw.type)`, `normalizeChartSchema.ts:244`). An
 * author who wrote the internal spelling met a validator that said nothing and,
 * on any path that keeps the parse output, a series drawn in the chart's own
 * family — precisely what they were overriding.
 *
 * ## Liveness, RE-MEASURED at implementation time (a lit control on every count)
 *
 * Series-level `chartType` on the authoring face, controls `dataKey` / `name` /
 * `type` / `color` in the same query: docs 0 (10 / 11 / 2 / 2), fixtures 0
 * (3 / 2 / 0 / 2), designer inputs 0 (the `chart` registration's `series` is
 * ONE `code` input), src literals 0 (13 / 3 / 1 / 0), tests 9 (70 / 48 / 11 /
 * 8) — every one of the nine an internal-shape array handed straight to
 * `ChartRenderer`, which never meets this mirror. Limb ablation over 304 files
 * / 5817 tests: deleting `str(raw.chartType) ??` left all 5817 green; deleting
 * the `?? str(raw.type)` sibling went 2 red. The instrument is lit, the zero is
 * a reading, and it agrees with the card's own table.
 *
 * ## The ruled shape, and the two refused
 *
 *   A. a named refusal pointing at `type` — TAKEN. The spec's `ChartSeriesSchema`
 *      lists `chartType` in its alias map as a spelling of `type` and answers
 *      "Did you mean `chartType` → `type`?"; block (e) measures that live.
 *   B. fold `chartType` onto `type` at parse — REFUSED: the renderer takes
 *      `chartType` FIRST, so a fold would let the alias overwrite the canonical
 *      key when both are written, inverting objectui#7113's precedence rule.
 *      Block (c) pins "both written" as a refusal, not a silent winner.
 *   C. declare it as a second writable name — REFUSED: contradicts the spec's
 *      alias map and the in-repo docblocks calling it the INTERNAL spelling —
 *      the N-dialects hazard of AGENTS.md #0.1.
 *
 * ## The primitive — `z.never`, not `z.custom`, measured
 *
 * `aliasKeyRefusal()` (`../zod/tombstone.zod.ts`) reuses `retirementTombstone`'s
 * primitive, `z.never({ error }).optional().describe()`, and NOT
 * `handlerKeyRefusal`'s `z.custom`. Measured on the base: `z.toJSONSchema`
 * represents a `z.never` arm as `{ not: {} }` with its description and THROWS
 * on a `z.custom` arm ("Custom types cannot be represented in JSON Schema").
 * `z.toJSONSchema(ChartDataSeriesSchema)` succeeded before this change (11
 * properties) and goes on succeeding; block (f) pins it.
 *
 * ## Predictions, written before the first run (red-first)
 *
 * On the unmodified tree: (a) is red on `success` (true, key stripped); (b) is
 * red on `.shape` (no `chartType`); (c)'s first case is red (parses green,
 * `type: 'bar'` kept); (d)'s `Eq` line and its second `@ts-expect-error` are
 * `tsc` errors (`ChartDataSeries` has no `chartType`, and the non-fresh
 * assignment compiles); (f)'s `chartType` property is red. The CONTROLS, (e)
 * and (f)'s counter-probe are GREEN before and after — they pin the reason for
 * the arm and the spec's posture, not this change.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ChartSeriesSchema as SpecChartSeriesSchema } from '@objectstack/spec/ui';
import type { ChartDataSeries } from '../data-display';
import { ChartDataSeriesSchema } from '../zod/data-display.zod';
import { aliasKeyRefusal, retirementTombstone } from '../zod/tombstone.zod';

/** The document that parsed green on the base, its key stripped. */
const AUTHORED = { name: 'r', chartType: 'line' } as const;

/** The remedy fragment both faces answer with. */
const DID_YOU_MEAN = /Did you mean `chartType` → `type`\?/u;

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

const shapeOf = (schema: unknown): Record<string, { description?: string }> =>
  (schema as { shape: Record<string, { description?: string }> }).shape;

type Issue = { code: string; path: string; message: string };
/** `null` when the document parses; the issues otherwise. */
const issuesOf = (input: unknown): Issue[] | null => {
  const r = ChartDataSeriesSchema.safeParse(input);
  return r.success ? null : r.error.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
};

/* ── (a) the refusal — by name, at its own path, with the remedy ──────────── */

describe('objectui#7694 — `{ name, chartType }` is REFUSED by name (it parsed green, key stripped, on the base)', () => {
  it('refuses with one issue, `invalid_type` at `chartType`', () => {
    const issues = issuesOf(AUTHORED);
    expect(issues).not.toBeNull();
    expect(issues).toHaveLength(1);
    expect(issues![0]).toMatchObject({ code: 'invalid_type', path: 'chartType' });
  });

  it('the message names the key, points at `type`, and says why', () => {
    const [issue] = issuesOf(AUTHORED)!;
    expect(issue.message).toMatch(DID_YOU_MEAN);
    expect(issue.message).toContain('INTERNAL spelling');
    expect(issue.message).toContain('objectui#7694');
    expect(issue.message).toContain('Write `type`');
  });

  it.each(['line', 'bar', 'pie', 1, null, true, {}])('every value is refused (%j) — the refusal is about the KEY, not a value domain', (value) => {
    const issues = issuesOf({ name: 'r', chartType: value });
    expect(issues?.map((i) => i.path)).toEqual(['chartType']);
  });

  it('ONE string feeds both channels — the issue message IS the `.describe()` metadata', () => {
    const [issue] = issuesOf(AUTHORED)!;
    expect(shapeOf(ChartDataSeriesSchema).chartType?.description).toBe(issue.message);
  });

  it('CONTROL — the series without the key parses; the arm is optional and absence is the accept set', () => {
    expect(ChartDataSeriesSchema.safeParse({ name: 'r' }).success).toBe(true);
  });
});

/* ── (b) declared, on the mirror's OWN shape — what zod-mirror-parity reads ── */

describe('objectui#7694 — `chartType` is on `.shape`, and its `z.input` is `undefined`', () => {
  it('is a key of the mirror\'s own shape', () => {
    expect(shapeOf(ChartDataSeriesSchema)).toHaveProperty('chartType');
  });

  it('the arm\'s input type is exactly `undefined` — what a `?: never` twin declares, so the pair does not drift', () => {
    type ArmInput = z.input<typeof ChartDataSeriesSchema>['chartType'];
    const armIsUndefined: Eq<ArmInput, undefined> = true;
    expect(armIsUndefined).toBe(true);
  });
});

/* ── (c) not a fold — both written is a refusal, nothing silently wins ─────── */

describe('objectui#7694 — when BOTH spellings are written the document is refused; no precedence is minted', () => {
  it('`{ type: "bar", chartType: "line" }` refuses at `chartType` alone — `type` is neither overwritten nor kept', () => {
    // A fold would have had to pick a winner. The renderer picks `chartType`
    // (its first limb), so a "canonical wins" fold would state the OPPOSITE of
    // what the reader does — the inversion of objectui#7113's `xAxis` →
    // `xAxisKey` rule, where the fold restates the reader's own precedence —
    // and an "alias wins" fold would let the internal spelling overwrite the
    // authored one. Neither is minted: the document is refused, and the author
    // is told which key to drop.
    const issues = issuesOf({ name: 'r', type: 'bar', chartType: 'line' });
    expect(issues?.map((i) => i.path)).toEqual(['chartType']);
  });

  it('CONTROL — `type` alone, the author spelling of the same override, survives with its value', () => {
    const r = ChartDataSeriesSchema.safeParse({ name: 'r', type: 'line' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ name: 'r', type: 'line' });
  });

  it('CONTROL — a truly undeclared key is STILL stripped in silence: the object is non-strict, which is why the arm exists', () => {
    // The deletion-not-chosen. This is what `chartType` looked like on the
    // base, and what it would look like again if someone "simplified" the arm
    // away. `chart-series-keys-7546.test.ts` (e) pins the same fact.
    const r = ChartDataSeriesSchema.safeParse({ name: 'r', notAKeyAtAll: 'x' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty('notAKeyAtAll');
  });
});

/* ── (d) the TypeScript face moves in lockstep ───────────────────────────── */

describe('objectui#7694 — `ChartDataSeries.chartType` is a `?: never` tombstone', () => {
  it('`undefined` is its whole domain — the same as the arm\'s input', () => {
    const tsIsUndefined: Eq<ChartDataSeries['chartType'], undefined> = true;
    expect(tsIsUndefined).toBe(true);
  });

  it('writing it is a `tsc` error at the authoring site', () => {
    // @ts-expect-error `chartType` is the renderer's INTERNAL spelling of `type` — write `type` (objectui#7694)
    const s: ChartDataSeries = { name: 'r', chartType: 'line' };
    expect(s.name).toBe('r');
  });

  it('a NON-fresh object carrying it no longer assigns structurally either — this is the TS-face narrowing', () => {
    // On the base the member did not exist, so this widened object assigned
    // (excess-property checking applies to fresh literals only). The `never`
    // member makes the assignment itself fail: `string` is not `undefined`.
    const widened = { name: 'r', chartType: 'line' as string };
    // @ts-expect-error the member exists and is `never`; structural assignment fails, not only excess-property checking
    const s: ChartDataSeries = widened;
    expect(s.name).toBe('r');
  });
});

/* ── (e) the spec agrees — same posture, same remedy, measured live ─────────── */

describe('objectui#7694 — `@objectstack/spec` takes the same posture, measured on the installed spec', () => {
  it('`ChartSeriesSchema` refuses `chartType` by name and points at `type`', () => {
    const r = SpecChartSeriesSchema.safeParse(AUTHORED);
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues[0]!;
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.message).toMatch(DID_YOU_MEAN);
  });

  it('CONTROL — the spec accepts `type`, the canonical spelling, and keeps it', () => {
    const r = SpecChartSeriesSchema.safeParse({ name: 'r', type: 'line' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toHaveProperty('type', 'line');
  });

  it('this mirror answers with the spec\'s OWN lead, derived from the installed spec at assert time — one remedy meets the author on both faces', () => {
    // ⚠️ Deliberately NOT two comparisons against a constant, which is what
    // this assertion held before: ours matched a literal and the spec's
    // matched a regex, never each other, so a spec reword of the lead left
    // BOTH green while the two faces silently diverged. The expected lead is
    // read off the spec's LIVE message here, so the pin reddens exactly when
    // they stop matching.
    const spec = SpecChartSeriesSchema.safeParse(AUTHORED);
    expect(spec.success).toBe(false);
    if (spec.success) return;
    const specMessage = spec.error.issues[0]!.message;

    // THE CUT: the spec's lead through its `Did you mean …?` remedy, and no
    // further. Measured on the installed 17.2.0 that cut is 91 bytes and is
    // byte-equal to ours. The clause after the `?` is the spec's own (a #4001
    // note) and is excluded on purpose — 17.3.0 rewords only that clause, so
    // pinning it would redden this repo on a spec bump for no author-facing
    // gain.
    const cut = specMessage.indexOf('?') + 1;
    const SHARED_LEAD = specMessage.slice(0, cut);
    // Guard the cut itself: if a reword moves the first `?` off the remedy,
    // this fails rather than quietly pinning a shorter, weaker prefix.
    expect(SHARED_LEAD).toMatch(DID_YOU_MEAN);

    const [ours] = issuesOf(AUTHORED)!;
    expect(ours.message.startsWith(SHARED_LEAD)).toBe(true);
  });
});

/* ── (f) the published JSON-Schema surface, and the primitive that keeps it ── */

describe('objectui#7694 — `z.toJSONSchema(ChartDataSeriesSchema)` still succeeds, because the arm is `z.never`, not `z.custom`', () => {
  it('succeeds, and now carries `chartType` as `{ not: {} }` with the guidance as its description', () => {
    const js = z.toJSONSchema(ChartDataSeriesSchema) as { properties?: Record<string, unknown> };
    expect(js.properties).toHaveProperty('chartType');
    expect(js.properties!.chartType).toMatchObject({ not: {}, description: expect.stringMatching(DID_YOU_MEAN) });
  });

  it('COUNTER-PROBE — `handlerKeyRefusal`\'s `z.custom` primitive would have made that call throw', () => {
    const custom = z.object({ chartType: z.custom<never>(() => false, { error: 'x' }).optional() });
    expect(() => z.toJSONSchema(custom)).toThrow(/cannot be represented in JSON Schema/);
    const never = z.object({ chartType: aliasKeyRefusal('chartType', 'type', 'this probe', 'detail.') });
    expect(() => z.toJSONSchema(never)).not.toThrow();
  });

  it('the arm reports `invalid_type` like a retirement tombstone and is told apart by its WORDING — an alias, not a retirement', () => {
    const arm = z.object({ k: aliasKeyRefusal('k', 'c', 'this probe', 'detail.') }).safeParse({ k: 1 });
    const tomb = z.object({ k: retirementTombstone('RETIRED (probe) — migration note.') }).safeParse({ k: 1 });
    expect(arm.error?.issues[0]?.code).toBe('invalid_type');
    expect(tomb.error?.issues[0]?.code).toBe('invalid_type');
    expect(arm.error?.issues[0]?.message).toBe('Unrecognized key(s) on this probe: `k`. Did you mean `k` → `c`? detail.');
    expect(arm.error?.issues[0]?.message).not.toContain('RETIRED');
    expect(tomb.error?.issues[0]?.message).not.toContain('Did you mean');
  });
});
