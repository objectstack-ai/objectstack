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
   */
  lower(range: string | readonly string[]): Promise<LoweredDateRangeWindow>;
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

/** The three presets whose upper bound is NOW rather than a calendar boundary. */
const ROLLING: readonly DateRangePreset[] = ['last_7_days', 'last_30_days', 'last_90_days'];

interface ThrownEnvelope {
  code?: string;
  status?: number;
  message?: string;
}

async function attempt(
  face: AnalyticsDateRangeFace,
  range: string | readonly string[],
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
  for (const bad of ANALYTICS_DATE_RANGE_REFUSED_SPELLINGS) {
    const got = await attempt(face, bad);
    if ('window' in got) {
      say(
        `ANSWERED ${JSON.stringify(bad)} with [${got.window.start}, ${got.window.end}] instead of `
        + 'refusing — an unresolvable window is a refusal, never a window',
      );
      continue;
    }
    if (got.refusal.code !== 'ANALYTICS_DATE_RANGE_UNRECOGNIZED') {
      say(`refused ${JSON.stringify(bad)} with code ${String(got.refusal.code)}, not ANALYTICS_DATE_RANGE_UNRECOGNIZED`);
    }
    if (got.refusal.status !== 400) {
      say(`refused ${JSON.stringify(bad)} with status ${String(got.refusal.status)}, not 400`);
    }
    envelopes.add(JSON.stringify({ code: got.refusal.code, status: got.refusal.status }));
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
