// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: the authz context's time-zone acceptance IS the shared value-domain
 * predicate, and that predicate IS the `Intl.DateTimeFormat` probe.
 *
 * ## Why this file exists
 *
 * `coerceTimeZone` in `resolve-authz-context.ts` used to carry its own
 * module-private `isValidTimeZone` — a third re-statement of one definition
 * (`packages/spec/src/shared/value-domain.zod.ts` and
 * `packages/services/service-settings/src/value-domains.ts` were the other
 * two). Three copies of one definition is the shape that drifts, and the copy
 * carrying no pins is the one a future editor "modernises". The re-point onto
 * `isValueDomainMember('iana_time_zone', …)` removed the copy; this file is
 * what makes the removal safe to have made, and what keeps it safe.
 *
 * ## The specific drift this file exists to redden
 *
 * `Intl.supportedValuesOf('timeZone')` is measurably NOT the definition. On the
 * repo's Node 22 baseline it returns 418 CLDR *canonical* names and omits
 * `UTC` (this platform's own declared default), `Asia/Kolkata` (a curated
 * option in the shipped localization manifest), `Europe/Kyiv`,
 * `Asia/Ho_Chi_Minh`, `US/Eastern` and `GMT`. A well-meaning switch to that
 * enumeration would silently NARROW what the authz context accepts as a time
 * zone — no type error, no other red test. `enumerationIsNotTheDefinition`
 * below asserts the divergence is still real, so the pins beneath it cannot
 * pass vacuously on some future runtime where the two sets happen to coincide.
 *
 * ## Two layers, deliberately
 *
 *  1. **Definition** — the shared predicate against a freshly constructed
 *     `Intl.DateTimeFormat` probe, over a corpus that includes the traps, the
 *     refusals, and the case/whitespace variants where two "identical" probes
 *     most plausibly diverge once one of them sits behind a wrapper.
 *  2. **Call site** — `resolveLocalizationContext` end-to-end, which is the
 *     only thing that pins what CORE accepts rather than what the spec package
 *     exports. Discriminating accept from reject needs a value that is not the
 *     `UTC` fallback, so the accepted-case assertions use spellings that are
 *     accepted but NOT equal to `UTC` (`utc` lowercased, for one — the probe is
 *     case-insensitive, and that case-insensitivity is itself part of the
 *     pinned definition).
 */

import { describe, it, expect } from 'vitest';
import { isValueDomainMember } from '@objectstack/spec/shared';

import { resolveLocalizationContext } from './resolve-authz-context.js';

/** A fresh probe, constructed here rather than imported — the definition. */
function intlProbe(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const sharedPredicate = (value: string): boolean => isValueDomainMember('iana_time_zone', value);

/** Zones the enumeration omits — the trap the spec's own TSDoc names. */
const ENUMERATION_OMITS = ['UTC', 'Asia/Kolkata', 'Europe/Kyiv', 'Asia/Ho_Chi_Minh', 'US/Eastern', 'GMT'] as const;

/** Accepted, and NOT spelled `UTC`, so the call-site layer can tell accept from fallback. */
const ACCEPTED_NOT_UTC = [
  'Asia/Kolkata',
  'Europe/Kyiv',
  'America/New_York',
  'Europe/Paris',
  'Asia/Ho_Chi_Minh',
  'US/Eastern',
  'utc', // case-insensitivity is part of the definition; not the `UTC` fallback spelling
  'europe/zurich',
] as const;

/** Refused: shape-valid zones that do not exist, plus blanks. */
const REFUSED = ['Mars/Olympus', 'Not/AZone', 'Europe/Munich', 'America/Atlantis', 'Foo/Bar'] as const;

/**
 * The differential corpus. Grouped so a failure names the class it came from.
 * ⚠️ Case and whitespace variants are here on purpose: they are where a
 * predicate that gained a normalising wrapper would separate from the bare
 * probe, and nothing else in the corpus would notice.
 */
const CORPUS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['zones the enumeration omits', ENUMERATION_OMITS],
  ['ICU canonical spellings', ['Asia/Calcutta', 'Europe/Kiev', 'Asia/Saigon']],
  [
    'ordinary zones',
    [
      'America/New_York',
      'Europe/Paris',
      'Europe/Zurich',
      'Asia/Tokyo',
      'Asia/Shanghai',
      'Australia/Sydney',
      'Africa/Cairo',
      'America/Argentina/Buenos_Aires',
    ],
  ],
  ['refusals', REFUSED],
  ['blanks', ['', ' ', '   ', '\t', '\n']],
  [
    'CASE variants',
    ['utc', 'Utc', 'uTc', 'europe/zurich', 'EUROPE/ZURICH', 'asia/kolkata', 'AMERICA/NEW_YORK', 'gmt', 'us/eastern'],
  ],
  [
    'WHITESPACE variants',
    ['UTC ', ' UTC', ' UTC ', 'Asia/Kolkata ', ' Asia/Kolkata', 'Europe/ Paris', 'Europe /Paris', '\tEurope/Paris'],
  ],
  ['Etc/ and offset spellings', ['Etc/UTC', 'Etc/GMT', 'Etc/GMT+5', 'Etc/GMT-14', 'Etc/Unknown', '+05:30', 'Z']],
  ['legacy aliases', ['Factory', 'PST8PDT', 'CET', 'Universal', 'Zulu', 'Japan', 'Singapore', 'W-SU', 'NZ-CHAT']],
  [
    'Object.prototype key names as VALUES',
    ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'prototype'],
  ],
  ['structure abuse', ['/', '//', 'Europe//Paris', '/Europe/Paris', 'Europe/Paris/', 'Europe.Paris', 'Europe_Paris']],
  ['non-ASCII', ['Europe/Parïs', 'Ëurope/Paris', 'Europe/Παρίσι', 'A'.repeat(300)]],
  ['falsy-looking strings', ['0', '1', 'null', 'undefined', 'NaN', 'false', 'true']],
];

describe('resolve-authz-context time-zone domain — the shared predicate IS the Intl probe', () => {
  it('the enumeration is NOT the definition (anti-vacuity control for everything below)', () => {
    // If this ever goes green-by-coincidence the pins below stop meaning
    // anything, so the divergence itself is asserted rather than assumed.
    expect(typeof Intl.supportedValuesOf).toBe('function');
    const enumerated = new Set(Intl.supportedValuesOf('timeZone'));
    for (const tz of ENUMERATION_OMITS) {
      expect(enumerated.has(tz), `${tz} unexpectedly present in Intl.supportedValuesOf('timeZone')`).toBe(false);
      expect(intlProbe(tz), `${tz} must still be accepted by the probe`).toBe(true);
    }
  });

  for (const [group, values] of CORPUS) {
    it(`agrees with the probe on: ${group}`, () => {
      for (const value of values) {
        expect(sharedPredicate(value), `disagreement on ${JSON.stringify(value)}`).toBe(intlProbe(value));
      }
    });
  }

  it('agrees with the probe on every member of the enumeration, and on its case/space variants', () => {
    const enumerated = Intl.supportedValuesOf('timeZone');
    expect(enumerated.length).toBeGreaterThan(300);
    for (const tz of enumerated) {
      for (const variant of [tz, tz.toLowerCase(), tz.toUpperCase(), ` ${tz} `]) {
        expect(sharedPredicate(variant), `disagreement on ${JSON.stringify(variant)}`).toBe(intlProbe(variant));
      }
    }
  });

  it('adds no normalisation of its own — an untrimmed value is refused exactly as the bare probe refuses it', () => {
    // The wrapper (`isValueDomainMember`) dispatches and nothing else. If it
    // ever gained a `.trim()` this assertion is what says so; the call site's
    // OWN trim (below) would otherwise hide it completely.
    expect(sharedPredicate(' UTC')).toBe(false);
    expect(sharedPredicate('UTC ')).toBe(false);
    expect(intlProbe(' UTC')).toBe(false);
    expect(sharedPredicate('UTC')).toBe(true);
  });
});

/** Minimal settings occupant: `getMany` is the preferred arm the resolver takes. */
function settingsReturning(timezone: unknown) {
  return {
    get: async () => undefined,
    getMany: async () => ({ timezone: { value: timezone }, locale: { value: 'en-GB' } }),
  };
}

describe('resolveLocalizationContext — what CORE accepts as a time zone', () => {
  it.each(ACCEPTED_NOT_UTC)('accepts %s and reports it verbatim', async (tz) => {
    const result = await resolveLocalizationContext({ ql: undefined, settings: settingsReturning(tz) });
    expect(result.timezone).toBe(tz);
  });

  it.each(REFUSED)('refuses %s and falls back to UTC', async (tz) => {
    const result = await resolveLocalizationContext({ ql: undefined, settings: settingsReturning(tz) });
    expect(result.timezone).toBe('UTC');
  });

  it('keeps its own pre-processing: trims, stringifies non-strings, refuses blank', async () => {
    // ⛔ This surrounding logic is NOT the predicate and did not change with
    // the re-point. It is pinned here because the re-point is only invisible
    // if it stays: the predicate itself refuses ' Asia/Kolkata ', and it is
    // this trim that makes the padded spelling work at the call site.
    for (const [input, expected] of [
      [' Asia/Kolkata ', 'Asia/Kolkata'],
      ['\tEurope/Paris\n', 'Europe/Paris'],
      ['', 'UTC'],
      ['   ', 'UTC'],
      [undefined, 'UTC'],
      [null, 'UTC'],
    ] as ReadonlyArray<readonly [unknown, string]>) {
      const result = await resolveLocalizationContext({ ql: undefined, settings: settingsReturning(input) });
      expect(result.timezone, `input ${JSON.stringify(input)}`).toBe(expected);
    }
    // Non-string carriers go through String(...) before the trim.
    const stringified = await resolveLocalizationContext({
      ql: undefined,
      settings: settingsReturning({ toString: () => ' Asia/Kolkata ' }),
    });
    expect(stringified.timezone).toBe('Asia/Kolkata');
  });
});
