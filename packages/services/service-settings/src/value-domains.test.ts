// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Membership pins for the enforcement half of `Specifier.valueDomain` (#5712).
 *
 * The DEFINITIONS (probe vs. enumeration, and why `Intl.supportedValuesOf
 * ('timeZone')` / `Intl.DisplayNames` are the wrong oracles) are pinned where
 * they are declared — `packages/spec/src/system/settings-manifest.test.ts`
 * measures the traps themselves. What is pinned HERE is that this side
 * implements those definitions: the values the spec's TSDoc names as legal are
 * admitted, the ones it names as the reason each trap matters are refused.
 */

import { describe, it, expect } from 'vitest';
import { SpecifierValueDomainSchema } from '@objectstack/spec/system';
import {
  firstRejectedDomainMember,
  ISO_3166_ALPHA2_CODES,
  knownValueDomain,
  valueDomainPhrasing,
} from './value-domains.js';

describe('value domains — vocabulary parity with the spec', () => {
  it('enforces exactly the members SpecifierValueDomainSchema declares', () => {
    // A spec-side vocabulary change must go red HERE rather than becoming a
    // declared-but-unenforced member (Prime Directive #10). Every declared
    // member resolves to an enforcer, and nothing beyond the vocabulary does.
    for (const member of SpecifierValueDomainSchema.options) {
      expect(knownValueDomain(member), `${member} must be enforceable`).toBe(member);
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
    // Prototype-chain names must not read as members (`'toString' in obj`).
    expect(knownValueDomain('toString')).toBeNull();
    expect(knownValueDomain('constructor')).toBeNull();
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

describe('iso_4217_currency — Intl.supportedValuesOf("currency")', () => {
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

describe('iso_3166_alpha2 — the explicit code list the spec says this side must carry', () => {
  const ok = (v: unknown) => firstRejectedDomainMember('iso_3166_alpha2', v);

  it('is structurally the officially assigned set: 249 unique uppercase pairs', () => {
    expect(ISO_3166_ALPHA2_CODES.size).toBe(249);
    for (const code of ISO_3166_ALPHA2_CODES) {
      expect(code).toMatch(/^[A-Z]{2}$/);
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
