// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The settings door's half of `Specifier.valueDomain` (#5712), after the
 * re-point onto the ONE shared predicate (maintainer ruling 2026-09-02).
 *
 * The DEFINITIONS (probe vs. enumeration, the CLDR currency snapshot, and why
 * `Intl.supportedValuesOf('timeZone')` / `Intl.DisplayNames` are the wrong
 * oracles) are pinned where they are declared —
 * `packages/spec/src/shared/value-domain.test.ts` measures the traps
 * themselves. What is pinned HERE is what the DOOR does with them: the values
 * the shared module names as legal are admitted through
 * `firstRejectedDomainMember`, the ones it names as the reason each trap
 * matters are refused, and the door's own prose does not drift from the
 * published catalog.
 *
 * ⚠️ ONE PIN WENT VACUOUS WITH THE RE-POINT, deliberately and on the record.
 * Before the re-point this file's first case compared two independently
 * written things: the spec's vocabulary against this package's own
 * `DOMAIN_MEMBERSHIP` table. `knownValueDomain` now answers from
 * `ValueDomainSchema` itself, so "every member of the vocabulary is
 * enforceable" can no longer detect divergence — there is nothing left here to
 * diverge FROM, which is the point of the ruling. The equality that still
 * matters is pinned where both sides live: `value-domain.test.ts` holds
 * `SpecifierValueDomainSchema` to BE `ValueDomainSchema` (identity, not equal
 * members). What replaces the vacuous half below is the question the door can
 * still answer alone: does every declared member actually REFUSE something
 * here — i.e. is any member enforced by an accept-everything stub — and does
 * every member have door prose that agrees with the catalog.
 */

import { describe, it, expect } from 'vitest';
import { ISO_3166_ALPHA2_CODES, isValueDomainMember, ValueDomainSchema } from '@objectstack/spec/shared';
import { BUILTIN_VALIDATION_MESSAGES, VALIDATION_MESSAGE_FALLBACK_LOCALE } from '@objectstack/spec/system';
import {
  firstRejectedDomainMember,
  knownValueDomain,
  valueDomainPhrasing,
} from './value-domains.js';

describe('value domains — what the door still owns after the re-point', () => {
  it('accepts every declared member, and every member actually refuses something', () => {
    // The enforceability half is now structural (see the file header). What is
    // NOT structural: that each member's shared enforcer is a membership test
    // at all. A member wired to `() => true` would type-check, would satisfy
    // "the vocabulary is fully covered", and would silently open the door to
    // everything — so each one is required to reject its own garbage probe.
    const garbage: Record<string, string> = {
      iana_time_zone: 'Mars/Olympus',
      iso_4217_currency: 'XYZ',
      iso_3166_alpha2: 'ZZ',
    };
    for (const member of ValueDomainSchema.options) {
      expect(knownValueDomain(member), `${member} must be enforceable`).toBe(member);
      const probe = garbage[member];
      expect(probe, `${member} needs a garbage probe in this table`).toBeTruthy();
      expect(
        firstRejectedDomainMember(member, probe),
        `${member} must actually refuse ${probe} — an accept-everything enforcer is the failure this pin exists for`,
      ).toEqual({ value: probe });
      // …and each has phrasing, so neither door can hit an undefined sentence.
      const p = valueDomainPhrasing(member);
      expect(p.member.length).toBeGreaterThan(0);
      expect(p.example.length).toBeGreaterThan(0);
    }
  });

  it('records nothing for a domain it cannot enforce', () => {
    // A hand-built manifest with a misspelt domain must fall back to
    // unchanged behaviour, not to accept-everything.
    expect(knownValueDomain('iana_timezone')).toBeNull(); // the plausible typo
    expect(knownValueDomain('bcp47_locale')).toBeNull(); // deliberately not in the vocabulary (#5933)
    expect(knownValueDomain('')).toBeNull();
    expect(knownValueDomain(undefined)).toBeNull();
    expect(knownValueDomain(42)).toBeNull();
    // Prototype-chain names must not read as members. The old implementation
    // looked the domain up in an object literal, where `'toString' in obj` is
    // true, and excluded these by a hand-written `hasOwnProperty` guard; the
    // re-point replaced that guard with the closed enum's own `safeParse`.
    // Same two names, pinned across the swap: a `z.enum` matches literal
    // members only, and this case is what says so out loud.
    expect(knownValueDomain('toString')).toBeNull();
    expect(knownValueDomain('constructor')).toBeNull();
    expect(knownValueDomain('__proto__')).toBeNull();
    expect(knownValueDomain('hasOwnProperty')).toBeNull();
  });

  it('the door prose and the published catalog describe one domain in one set of words', () => {
    // `valueDomainPhrasing` survived the re-point because the env-override
    // door writes a LOG line, which has no error code, no locale and no
    // `{{label}}` — the catalog's finished sentences do not fit it. The save
    // door renders the catalog. This pin is what keeps the two from drifting:
    // each domain's fragments must appear in that domain's catalog template.
    const en = BUILTIN_VALIDATION_MESSAGES[VALIDATION_MESSAGE_FALLBACK_LOCALE];
    for (const member of ValueDomainSchema.options) {
      const template = en[`value_domain_${member}`];
      expect(template, `catalog must carry value_domain_${member}`).toBeTruthy();
      const { member: noun, example } = valueDomainPhrasing(member);
      expect(template, `${member}: the log line's noun must be the catalog's`).toContain(noun);
      expect(template, `${member}: the log line's example must be the catalog's`).toContain(`e.g. ${example}`);
    }
    // And the code-named default exists, since that is the wire code itself.
    expect(en['value_domain']).toBeTruthy();
  });
});

describe('iana_time_zone — the Intl.DateTimeFormat probe', () => {
  const ok = (v: unknown) => firstRejectedDomainMember('iana_time_zone', v);

  it('admits every zone the supportedValuesOf trap would have rejected', () => {
    // The six measured omissions from `Intl.supportedValuesOf('timeZone')`
    // (#5933's TSDoc): each is accepted by every Intl-based consumer
    // downstream, so each MUST be accepted here — `UTC` is the manifest's own
    // default and `Asia/Kolkata` a curated option shipped today.
    for (const tz of ['UTC', 'Asia/Kolkata', 'Europe/Kyiv', 'Asia/Ho_Chi_Minh', 'US/Eastern', 'GMT']) {
      expect(ok(tz), `${tz} is a legal IANA zone`).toBeNull();
    }
    // And the card's own repro value.
    expect(ok('Europe/Zurich')).toBeNull();
  });

  it('refuses shape-valid garbage loudly', () => {
    expect(ok('Mars/Olympus')).toEqual({ value: 'Mars/Olympus' });
    expect(ok('ZZ')).toEqual({ value: 'ZZ' });
    expect(ok('Not A Zone')).toEqual({ value: 'Not A Zone' });
  });
});

describe('iso_4217_currency — the checked-in CLDR snapshot', () => {
  const ok = (v: unknown) => firstRejectedDomainMember('iso_4217_currency', v);

  it('admits CHF and every curated localization option', () => {
    for (const code of ['CHF', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'INR', 'AUD', 'CAD', 'BRL']) {
      expect(ok(code), `${code} is a legal ISO 4217 code`).toBeNull();
    }
  });

  it('refuses XYZ (and lowercase spellings — the standard is uppercase)', () => {
    expect(ok('XYZ')).toEqual({ value: 'XYZ' });
    expect(ok('usd')).toEqual({ value: 'usd' });
  });

});

describe('the door is a walker over the shared predicate, not a second judge', () => {
  /**
   * The invariant this package actually owns, and the one that survives the
   * re-point: `firstRejectedDomainMember` adds no membership opinion of its
   * own — it walks a carrier and asks `isValueDomainMember`. Asserted as
   * AGREEMENT over a corpus carrying each domain's traps, so a local filter
   * creeping back in (an extra case fold, a length or shape check, a curated
   * allow-list) reddens here even though every representative case above would
   * still pass.
   *
   * ⚠️ Deliberately NOT a probe of `Intl.supportedValuesOf('currency')`. An
   * earlier draft asserted that everything the RUN-TIME probe enumerates is
   * admitted by the door. That was a time bomb and a duplicate at once: the
   * door now answers from the checked-in CLDR snapshot, CI pins only the Node
   * MAJOR, and the ICU build moves underneath it — so a host enumerating one
   * currency the snapshot lacks would redden a CORRECT implementation, in a
   * package with nothing to fix. Probe-versus-snapshot belongs beside the
   * snapshot and is already pinned there, in both directions and with a size,
   * by `packages/spec/src/shared/value-domain.test.ts`.
   */
  const CORPUS = [
    // members, one or more per domain
    'UTC', 'Asia/Kolkata', 'Europe/Kyiv', 'GMT', 'US/Eastern', 'Europe/Zurich',
    'CHF', 'USD', 'EUR', 'JPY',
    'US', 'GB', 'CH', 'UA',
    // non-members, including every trap the shared module names
    'Mars/Olympus', 'Europe/Munich', 'Not A Zone',
    'XYZ', 'VED', 'XAU', 'usd', 'chf',
    'ZZ', 'UK', 'XX', 'us', 'AAA', '', ' CH', 'CH ',
  ];

  it('agrees with isValueDomainMember on every domain, value by value', () => {
    for (const domain of ValueDomainSchema.options) {
      for (const value of CORPUS) {
        expect(
          firstRejectedDomainMember(domain, value) === null,
          `${domain} / ${JSON.stringify(value)}: the door and the shared predicate must agree`,
        ).toBe(isValueDomainMember(domain, value));
      }
    }
  });

  it('agrees element-wise across a multi-value carrier too', () => {
    // The walk is the door's own contract, so it is pinned against the
    // predicate rather than against a hard-coded expectation.
    const carrier = ['USD', 'CHF', 'XYZ', 'EUR'];
    const firstBad = carrier.find((c) => !isValueDomainMember('iso_4217_currency', c));
    expect(firstRejectedDomainMember('iso_4217_currency', carrier))
      .toEqual(firstBad === undefined ? null : { value: firstBad });
  });
});

describe('iso_3166_alpha2 — the explicit code list, now carried by the spec', () => {
  const ok = (v: unknown) => firstRejectedDomainMember('iso_3166_alpha2', v);

  it('admits the whole officially assigned set the shared module publishes', () => {
    // Was a structural pin on this package's own table (`size === 249`). The
    // table moved to `@objectstack/spec/shared`, where its structure and its
    // spelling are pinned. What is left here is a PLUMBING pin, and is worth
    // saying as exactly that rather than as something stronger: it loops the
    // published set through a door that answers from the published set, so it
    // cannot detect a wrong table — it detects the door failing to reach the
    // right one, over the whole population rather than a sample.
    expect(ISO_3166_ALPHA2_CODES.size).toBe(249);
    for (const code of ISO_3166_ALPHA2_CODES) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(ok(code), `${code} is officially assigned and must be admitted`).toBeNull();
    }
  });

  it('admits assigned codes, including the manifest default', () => {
    for (const code of ['US', 'GB', 'CN', 'CH', 'DE', 'JP', 'BR', 'IN', 'UA']) {
      expect(ok(code), `${code} is officially assigned`).toBeNull();
    }
  });

  it('refuses exactly the values the DisplayNames non-oracle admits', () => {
    // `ZZ` maps to "Unknown Region" and is the value #5933 cites as slipping
    // past `^[A-Za-z]{2}$`; `UK` is a CLDR alias, not an ISO 3166-1 code
    // (GB is). `XX` is user-assigned. All three are shape-valid.
    expect(ok('ZZ')).toEqual({ value: 'ZZ' });
    expect(ok('UK')).toEqual({ value: 'UK' });
    expect(ok('XX')).toEqual({ value: 'XX' });
    // Membership is exact uppercase, as the standard spells its codes.
    expect(ok('us')).toEqual({ value: 'us' });
  });
});

describe('firstRejectedDomainMember — the firstRejectedOption mirror contract', () => {
  it('judges arrays element-wise and names the first offender', () => {
    expect(firstRejectedDomainMember('iso_4217_currency', ['USD', 'CHF'])).toBeNull();
    expect(firstRejectedDomainMember('iso_4217_currency', ['USD', 'XYZ', 'ABC']))
      .toEqual({ value: 'XYZ' });
  });

  it('wraps the offender so a rejected `undefined` stays distinguishable', () => {
    const rejected = firstRejectedDomainMember('iana_time_zone', undefined);
    expect(rejected).not.toBeNull();
    expect(rejected).toEqual({ value: undefined });
  });

  it('compares in string form — the value has been through JSON and a form post', () => {
    // A number is stringified before membership is asked, same as
    // `declaredOptionValues` compares options; `String(5)` is no zone.
    expect(firstRejectedDomainMember('iana_time_zone', 5)).toEqual({ value: 5 });
  });
});
