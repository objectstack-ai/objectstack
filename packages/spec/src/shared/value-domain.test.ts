// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `shared/value-domain.zod.ts` — the ONE standard-domain vocabulary and the ONE
 * membership predicate shared by settings specifiers and object fields
 * (maintainer ruling 2026-09-02 on #14168, option A).
 *
 * Two families of pins. The STRUCTURAL ones hold the vocabulary closed at
 * exactly its three members and hold `SpecifierValueDomainSchema` to be the
 * same schema (an alias, not a copy). The DEFINITION ones re-measure every
 * trap the module header records — the obvious oracle is the wrong one for two
 * of the three domains, and a doc nobody re-measures rots; these go red when
 * ICU changes under the definition instead of letting the spelling drift.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  ValueDomainSchema,
  ISO_3166_ALPHA2_CODES,
  isValueDomainMember,
} from './value-domain.zod';
import { SpecifierValueDomainSchema } from '../system/settings-manifest.zod';
import { CURRENCY_FRACTION_DIGITS } from '../data/currency-fraction-digits';

describe('ValueDomainSchema — the closed vocabulary', () => {
  it('has exactly the three ruled members, in declaration order', () => {
    expect(ValueDomainSchema.options).toEqual([
      'iana_time_zone',
      'iso_4217_currency',
      'iso_3166_alpha2',
    ]);
  });

  it('is the SAME schema the settings specifier declares under its historical name', () => {
    // An alias, not a second declaration: the ruling is one vocabulary, and the
    // pin is identity, which a copy with equal members would not satisfy.
    expect(SpecifierValueDomainSchema).toBe(ValueDomainSchema);
    expect(SpecifierValueDomainSchema.options).toEqual(ValueDomainSchema.options);
  });

  it('refuses a stranger by name — the vocabulary does not widen', () => {
    for (const stranger of ['iso_8601_date', 'bcp47_locale', 'iana_timezone', '']) {
      const result = ValueDomainSchema.safeParse(stranger);
      expect(result.success, stranger).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.code).toBe('invalid_value');
    }
  });

  it('derives a JSON-schema enum carrying the three members (the Studio / OpenAPI path)', () => {
    const json = z.toJSONSchema(ValueDomainSchema, { io: 'input', unrepresentable: 'any' });
    expect(json.enum).toEqual(['iana_time_zone', 'iso_4217_currency', 'iso_3166_alpha2']);
  });
});

describe('isValueDomainMember — iana_time_zone is the Intl.DateTimeFormat probe', () => {
  const member = (v: string) => isValueDomainMember('iana_time_zone', v);

  it('admits the zones the enumeration omits — UTC, Asia/Kolkata, Europe/Kyiv', () => {
    // The #14168 card's own measurement, re-run: `Intl.supportedValuesOf` is
    // NOT the definition, because it rejects the platform's own default.
    for (const tz of ['UTC', 'Asia/Kolkata', 'Europe/Kyiv']) {
      expect(member(tz), tz).toBe(true);
    }
    const enumerated = Intl.supportedValuesOf('timeZone');
    for (const tz of ['UTC', 'Asia/Kolkata', 'Europe/Kyiv']) {
      expect(enumerated, `${tz} must stay outside the enumeration or the header's claim is stale`).not.toContain(tz);
    }
    // Not merely a subset — a rename: the legacy spellings are its canonical names.
    expect(enumerated).toContain('Asia/Calcutta');
  });

  it('admits the other curated and legacy spellings every runtime accepts', () => {
    for (const tz of ['Asia/Ho_Chi_Minh', 'US/Eastern', 'GMT', 'Asia/Shanghai', 'Europe/Zurich']) {
      expect(member(tz), tz).toBe(true);
    }
  });

  it('refuses Europe/Munich — a shape-valid zone that does not exist', () => {
    expect(member('Europe/Munich')).toBe(false);
    expect(member('Mars/Olympus')).toBe(false);
    expect(member('')).toBe(false);
    expect(member('not a zone')).toBe(false);
  });

  it('is case-insensitive, because the probe is — that IS the pinned definition', () => {
    expect(member('europe/zurich')).toBe(true);
  });
});

describe('isValueDomainMember — iso_4217_currency is the checked-in CLDR snapshot', () => {
  const member = (v: string) => isValueDomainMember('iso_4217_currency', v);

  it('admits the nine curated localization options plus CHF, and refuses XYZ', () => {
    for (const c of ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'INR', 'AUD', 'CAD', 'BRL', 'CHF']) {
      expect(member(c), c).toBe(true);
    }
    expect(member('XYZ')).toBe(false);
  });

  it('is exact uppercase — the settings door has always enforced it so', () => {
    expect(member('usd')).toBe(false);
    expect(member('Usd')).toBe(false);
    expect(member('')).toBe(false);
  });

  it('carries the definition\'s KNOWN gaps rather than papering over them', () => {
    // `VED` (recently assigned) and the metal/fund codes are outside CLDR's
    // `currencyData`; the module header records them as deliberate. Widening
    // is a snapshot regeneration, never a regex fallback.
    expect(member('VED')).toBe(false);
    expect(member('XAU')).toBe(false);
  });

  it('does not read Object.prototype as a code', () => {
    for (const notACode of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
      expect(member(notACode), notACode).toBe(false);
    }
  });

  it('equals Intl.supportedValuesOf(\'currency\') on the repo\'s Node baseline — the drift detector', () => {
    // The snapshot was generated FROM this enumeration; if ICU moves the set,
    // this goes red and the snapshot is regenerated (its header carries the
    // snippet). Both directions, so a code the host gained or lost is named.
    const live = new Set(Intl.supportedValuesOf('currency'));
    const snapshot = new Set(Object.keys(CURRENCY_FRACTION_DIGITS));
    expect([...snapshot].filter((c) => !live.has(c))).toEqual([]);
    expect([...live].filter((c) => !snapshot.has(c))).toEqual([]);
    expect(snapshot.size).toBe(162);
  });
});

describe('isValueDomainMember — iso_3166_alpha2 is the explicit 249-code list', () => {
  const member = (v: string) => isValueDomainMember('iso_3166_alpha2', v);

  it('carries exactly the 249 officially assigned codes, each two uppercase letters, none twice', () => {
    expect(ISO_3166_ALPHA2_CODES.size).toBe(249);
    for (const code of ISO_3166_ALPHA2_CODES) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('admits real codes and refuses the reserved / user-assigned / alias elements', () => {
    for (const c of ['US', 'GB', 'CN', 'CH', 'DE', 'JP', 'IN', 'BR']) {
      expect(member(c), c).toBe(true);
    }
    // `ZZ` is the value the domain exists to reject (it passes ^[A-Z]{2}$);
    // `UK` is a CLDR alias, not an ISO 3166-1 code; `XX`/`AA`/`QM` are
    // user-assigned or reserved.
    for (const c of ['ZZ', 'UK', 'XX', 'AA', 'QM', 'QZ', 'EU']) {
      expect(member(c), c).toBe(false);
    }
  });

  it('is exact uppercase', () => {
    expect(member('us')).toBe(false);
    expect(member('Us')).toBe(false);
    expect(member('')).toBe(false);
  });

  it('Intl.DisplayNames is NOT a membership oracle (why the list is explicit)', () => {
    const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    // "the display name differs from the input" admits both of these.
    expect(regionNames.of('ZZ')).not.toBe('ZZ');
    expect(regionNames.of('UK')).not.toBe('UK');
  });
});

describe('isValueDomainMember — every vocabulary member has a definition', () => {
  it('answers a boolean for each member, never throws, never returns undefined', () => {
    for (const domain of ValueDomainSchema.options) {
      expect(typeof isValueDomainMember(domain, 'definitely-not-a-member')).toBe('boolean');
      expect(isValueDomainMember(domain, 'definitely-not-a-member')).toBe(false);
    }
  });
});
