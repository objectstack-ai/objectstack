// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16322] THE shared `dateRange` conformance kit: the cases and the rules every
 * analytics face is held to, written ONCE so "memory and SQL agree" is a
 * measurement rather than an agreement.
 *
 * ## Why a kit and not one test file
 *
 * The ruling that split #16041 asked for exactly this — *"memory and SQL drivers
 * refuse identically and share one conformance fixture"* — because the defect it
 * closes was a DISAGREEMENT, not a bug in one backend. Measured on `b834b48e7a`,
 * one input, three different wrong answers:
 *
 *   - `driver-memory` matched EVERY `Date`-typed row (a `Date` compares above a
 *     `String` under BSON cross-type ordering, so both garbage bounds of the
 *     `[range, range]` fallback were satisfied) — 5/5 probe rows, 2020 and 2099
 *     included, at HTTP 200;
 *   - both `service-analytics` SQL strategies compiled the point window
 *     `created_at >= 'last_30_days' AND created_at <= 'last_30_days'`, whose
 *     answer is whatever the dialect decides a vocabulary word compares as;
 *   - and the VALID presets fared no better: `today` was the only one
 *     driver-memory resolved, and neither SQL strategy resolved even that one.
 *
 * ⛔ The faces cannot be driven from one file — `packages/runtime` is the only
 * package that can import all of them, and a new static consumer of
 * `@objectstack/driver-memory` there is a maintainer ruling under the #6664
 * census (`RULED_CEILING`), not a test-authoring decision. So the shape is the
 * repo's existing cross-driver one (`*-conformance.ts` in a shared package, a
 * thin runner per driver): the CASES and the RULES live here, each face's
 * runner lives in its own package, and the assertion body is not written twice.
 *
 * ## The oracle is this package's own lowering, and that is the point
 *
 * Every face is compared against {@link resolveAnalyticsDateRangeString} — the
 * one function all of them now call — so holding each face to it holds the
 * faces to each other, transitively, without a process that can see them all.
 * A face that grew a second interpretation goes red in its own package.
 *
 * ⛔ Returns FINDINGS rather than asserting: this file ships in `dist` and must
 * not import a test framework. Each runner asserts the list is empty, so one
 * rule set produces one failure text on every face.
 */

import { DATE_RANGE_PRESETS, type DateRangePreset } from '@objectstack/spec/data';
import {
  resolveAnalyticsDateRangeString,
  type AnalyticsDateRangeResolutionOptions,
  type ResolvedAnalyticsDateRange,
} from './analytics-date-range.js';

/**
 * What a face did with one `dateRange`, reduced to the three facts the
 * vocabulary decides: the two bounds, and whether the upper one is excluded.
 *
 * A face reports this in whatever currency it lowers into — a mingo `$match`,
 * an ObjectQL filter, a bound SQL statement — which is why the kit takes a
 * function rather than reading anything itself.
 */
export interface LoweredDateRangeWindow {
  readonly start: string;
  readonly end: string;
  readonly endExclusive: boolean;
}

/** One analytics face under conformance. */
export interface AnalyticsDateRangeFace {
  /** Named in every finding, so a failure says WHICH backend disagreed. */
  readonly name: string;
  /**
   * Lower one `dateRange` and report the window. ⛔ Must let a refusal
   * PROPAGATE — the kit reads the thrown envelope's `code` and `status`.
   *
   * ⚠️ The array arm is `readonly unknown[]`, not `readonly string[]`: the
   * ARITY case below drives shapes the schema's `z.array(z.string())` types
   * away but a real caller still reaches a face with — `[]` and `[null, null]`
   * among them (`POST /analytics/dataset/query` types its selection from
   * `AnalyticsQuery` and never Zod-parses it). A runner whose own parameter is
   * the narrower type still satisfies this — the declaration is a METHOD, so
   * its parameter is bivariant — and needs no change.
   */
  lower(range: string | readonly unknown[]): Promise<LoweredDateRangeWindow>;
}

/**
 * ⛔ Spellings the closed vocabulary does not contain — each a real one, not a
 * fuzz string:
 *
 * - `'Last 7 days'` — the schema's own former example, and #16041's case;
 * - `'last 7 days'` — the relative dialect #16322 deleted from the parser;
 * - `'not a range at all'` — the retired driver fence's input;
 * - `'last_60_days'` — a plausible near-miss the platform never declared;
 * - `'2026-01-20'` — the SQL single-day dialect, which is the ARRAY arm's job.
 */
export const ANALYTICS_DATE_RANGE_REFUSED_SPELLINGS: readonly string[] = [
  'Last 7 days',
  'last 7 days',
  'not a range at all',
  'last_60_days',
  '2026-01-20',
];

/**
 * The explicit-window control, as full timestamps.
 *
 * ⚠️ Deliberately not a bare `YYYY-MM-DD`: a bare day end means "through that
 * whole day" and each face widens it to `< nextDay` in its own currency
 * (#4042 / #3777) — a per-face calendar translation this vocabulary does not
 * touch, and which would make the faces differ here for a reason that has
 * nothing to do with presets.
 */
export const ANALYTICS_DATE_RANGE_EXPLICIT_WINDOW: readonly [string, string] = [
  '2026-09-01T00:00:00.000Z',
  '2026-09-30T00:00:00.000Z',
];

/**
 * [#17596] ⛔ Array arms that do not denote a window — the ARITY case's inputs,
 * each a shape an author or a generator really writes, ⛔ not fuzz.
 *
 * The kit's only array case used to be the two-element window above, so the
 * arity itself was governed NOWHERE and every face was free to invent a
 * reading for the rest. Four faces in one package had invented three —
 * MEASURED on `abc4b83ce` (#17124), one authored document over the same rows:
 * `['2026-01-01']` was a point window, an upper bound left unwritten, and a
 * window dropped to ALL OF HISTORY, depending on which backend answered. A
 * fifth face — `driver-memory`'s cube face — dropped it too (#17596, measured
 * end to end: the one-element array emitted a pipeline byte-identical to one
 * with no `dateRange` at all).
 *
 * ⭐ The rule asserted here is NOT invented for the kit: it is the one PR
 * #17593 already landed on the `service-analytics` faces — a non-two-bound
 * array is refused with the ADR-0112 `ANALYTICS_DATE_RANGE_UNRECOGNIZED` / 400
 * envelope — stated once here so every REGISTERED face is held to it instead
 * of one package pinning it for itself.
 *
 * ⛔ Why a refusal and not an alignment: all three readings are ungoverned, and
 * teaching every face the same guess is the "align them independently" shape
 * the kit exists to end. What IS governed is the contract the spec's own
 * refusal wording states — *an explicit window is the two-element array
 * [start, end]* — and the #16322 migration table, which tells an author to
 * write a single day as `['2026-01-20', '2026-01-20']`. TWO bounds.
 *
 * ⚠️ The two-element window case above is this case's CONTROL and is load
 * bearing: without it, "refuse every array" would satisfy the whole array arm.
 */
export const ANALYTICS_DATE_RANGE_NOT_A_WINDOW: readonly (readonly unknown[])[] = [
  // The card's own shape: one bound, which is not a window.
  ['2026-01-01'],
  // No bounds at all — a generator that filtered its list to nothing.
  [],
  // Three bounds: which two? Every face that answered picked a different pair.
  ['2026-09-01T00:00:00.000Z', '2026-09-30T00:00:00.000Z', '2026-10-31T00:00:00.000Z'],
  // Two bounds of the right ARITY that are not dates — the shape that reached
  // `parseUTC(null)` as a bare `TypeError` on one face, and lowered to the
  // string `'null'` on another. Two bounds is necessary, not sufficient.
  [null, null],
];

/** The three presets whose upper bound is NOW rather than a calendar boundary. */
const ROLLING: readonly DateRangePreset[] = ['last_7_days', 'last_30_days', 'last_90_days'];

interface ThrownEnvelope {
  code?: string;
  status?: number;
  message?: string;
}

async function attempt(
  face: AnalyticsDateRangeFace,
  range: string | readonly unknown[],
): Promise<{ window: LoweredDateRangeWindow } | { refusal: ThrownEnvelope }> {
  try {
    return { window: await face.lower(range) };
  } catch (e) {
    const err = e as ThrownEnvelope;
    return { refusal: { code: err.code, status: err.status, message: err.message } };
  }
}

/**
 * Run the whole rule set against one face and report what it got wrong.
 *
 * An EMPTY array is conformance. Each finding is one sentence naming the face,
 * the input and the disagreement, so the runner needs no message of its own.
 *
 * @param face - the backend under test.
 * @param options - the reference instant and timezone; the caller freezes the
 *   clock so the rolling presets (whose bound is NOW) are comparable at all.
 */
export async function analyticsDateRangeConformanceFindings(
  face: AnalyticsDateRangeFace,
  options: AnalyticsDateRangeResolutionOptions = {},
): Promise<string[]> {
  const findings: string[] = [];
  const say = (msg: string) => findings.push(`${face.name}: ${msg}`);
  const seenWindows = new Set<string>();

  // ── The thirteen declared names must resolve, and resolve identically ────
  for (const preset of DATE_RANGE_PRESETS) {
    const expected: ResolvedAnalyticsDateRange = resolveAnalyticsDateRangeString(preset, options);
    const got = await attempt(face, preset);
    if ('refusal' in got) {
      // ⭐ The control that keeps every refusal assertion below honest: a face
      // that refused EVERYTHING would satisfy them all, which is the opposite
      // defect and just as silent.
      say(`refused the DECLARED preset '${preset}' (${got.refusal.code ?? 'no code'})`);
      continue;
    }
    const w = got.window;
    if (w.start !== expected.start || w.end !== expected.end) {
      say(
        `lowered '${preset}' to [${w.start}, ${w.end}] but the shared resolver says `
        + `[${expected.start}, ${expected.end}]`,
      );
    }
    if (w.endExclusive !== expected.endExclusive) {
      say(
        `compares '${preset}''s upper bound ${w.endExclusive ? 'exclusively' : 'inclusively'}, `
        + `but a ${ROLLING.includes(preset) ? 'rolling window ends at NOW and REACHES its bound' : 'calendar window stops BEFORE its end instant'}`,
      );
    }
    // The fallback's shape, named directly: its two bounds were the preset's
    // own NAME, which is how twelve of thirteen windows became one.
    if (w.start === preset || w.end === preset) {
      say(`used the preset NAME '${preset}' as a window bound — the [range, range] fallback shape`);
    }
    seenWindows.add(`${w.start}..${w.end}`);
  }
  if (seenWindows.size > 0 && seenWindows.size !== DATE_RANGE_PRESETS.length) {
    say(
      `collapsed the ${DATE_RANGE_PRESETS.length} declared presets onto ${seenWindows.size} `
      + 'distinct window(s) — distinct names must select distinct rows',
    );
  }

  // ── Everything else is REFUSED, with one envelope ────────────────────────
  const envelopes = new Set<string>();
  /**
   * ⭐ ONE judgement for every refusal this kit demands — the STRING arm's
   * out-of-vocabulary spellings and the ARRAY arm's non-windows — so the two
   * arms cannot drift into two envelopes for one condition. ⛔ The thrown
   * MESSAGE is quoted only when there is no `code` at all, which is the case
   * where the text is the only evidence of what the face actually did (a face
   * that emitted no window and threw something of its own reads exactly like
   * one that refused, until you read it).
   */
  const judgeRefusal = (input: unknown, refusal: ThrownEnvelope): void => {
    if (refusal.code !== 'ANALYTICS_DATE_RANGE_UNRECOGNIZED') {
      say(
        `refused ${JSON.stringify(input)} with code ${String(refusal.code)}, `
        + `not ANALYTICS_DATE_RANGE_UNRECOGNIZED`
        + (refusal.code === undefined ? ` (${refusal.message ?? 'no message'})` : ''),
      );
    }
    if (refusal.status !== 400) {
      say(`refused ${JSON.stringify(input)} with status ${String(refusal.status)}, not 400`);
    }
    envelopes.add(JSON.stringify({ code: refusal.code, status: refusal.status }));
  };

  for (const bad of ANALYTICS_DATE_RANGE_REFUSED_SPELLINGS) {
    const got = await attempt(face, bad);
    if ('window' in got) {
      say(
        `ANSWERED ${JSON.stringify(bad)} with [${got.window.start}, ${got.window.end}] instead of `
        + 'refusing — an unresolvable window is a refusal, never a window',
      );
      continue;
    }
    judgeRefusal(bad, got.refusal);
  }

  // ── [#17596] ARITY: an array that is not TWO bounds is not a window ───────
  //
  // ⭐ The rule PR #17593 landed on the service-analytics faces, stated once
  // for every registered face. ⛔ Reported per SHAPE rather than as one
  // verdict: which arities a face answers is the finding — a face that
  // refuses `[]` and answers `['2026-01-01']` has not adopted the rule, it has
  // grown a fourth reading.
  for (const bad of ANALYTICS_DATE_RANGE_NOT_A_WINDOW) {
    const got = await attempt(face, bad);
    if ('window' in got) {
      // ⛔ Name WHICH half of the contract the shape breaks: two bounds is
      // necessary, not sufficient, and a finding that calls `[null, null]` an
      // arity problem sends the next reader to the wrong line.
      const why = bad.length === 2
        ? 'its two bounds are not date strings'
        : `a ${bad.length}-element array is not a window`;
      say(
        `ANSWERED ${JSON.stringify(bad)} with [${got.window.start}, ${got.window.end}] instead `
        + `of refusing — an explicit window is the TWO-element array [start, end] of date `
        + `strings, and ${why}, so this is a window the face INVENTED`,
      );
      continue;
    }
    judgeRefusal(bad, got.refusal);
  }

  if (envelopes.size > 1) {
    say(`raised ${envelopes.size} different envelopes for one condition — ADR-0112 asks for one`);
  }

  // ── The vocabulary is case-sensitive, and snake_case ─────────────────────
  for (const wrongCase of ['TODAY', 'Last_7_Days', 'This_Month']) {
    const got = await attempt(face, wrongCase);
    if ('window' in got) say(`accepted ${JSON.stringify(wrongCase)} — the vocabulary is case-sensitive`);
  }

  // ── ⛔ The CALLER's explicit window is not this vocabulary's business ─────
  const explicit = await attempt(face, ANALYTICS_DATE_RANGE_EXPLICIT_WINDOW);
  if ('refusal' in explicit) {
    say(`refused the explicit [start, end] window — only the STRING arm is a closed vocabulary`);
  } else {
    if (explicit.window.start !== ANALYTICS_DATE_RANGE_EXPLICIT_WINDOW[0]
      || explicit.window.end !== ANALYTICS_DATE_RANGE_EXPLICIT_WINDOW[1]) {
      say(
        `rewrote the caller's explicit window to [${explicit.window.start}, ${explicit.window.end}]`,
      );
    }
    if (explicit.window.endExclusive) {
      // #16179: only a window the face RESOLVED is compared exclusively. A
      // caller's bound is a bound they wrote meaning "include it".
      say("narrowed the caller's explicit window to an exclusive upper bound");
    }
  }

  return findings;
}
