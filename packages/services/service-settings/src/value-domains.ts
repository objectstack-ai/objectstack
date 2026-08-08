// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Standard value-domain membership — the enforcement half of
 * `Specifier.valueDomain` (#5712; the declaration half is #5933,
 * `SpecifierValueDomainSchema` in `@objectstack/spec/system`).
 *
 * A specifier that declares `valueDomain` says: the legal values for this key
 * are the members of this published standard, and that membership — not the
 * curated `options` table — is the enforcement boundary. The spec deliberately
 * only DECLARES the domains (Prime Directive #2 — no business logic, no data
 * tables in `packages/spec`); each domain's definition of membership is pinned
 * in `SpecifierValueDomainSchema`'s TSDoc and implemented here, on the
 * enforcing side. Keep the two in sync — the spec-side TSDoc names the traps
 * each definition was measured against, and `value-domains.test.ts` re-measures
 * them so drift goes red rather than rotting.
 */

import type { SpecifierValueDomain } from '@objectstack/spec/system';

/**
 * `iana_time_zone` membership — the `Intl.DateTimeFormat` probe.
 *
 * NOT `Intl.supportedValuesOf('timeZone')`: measured on the repo's Node 22
 * baseline it returns 418 CLDR *canonical* names and omits `UTC` (the
 * localization manifest's own declared default), `Asia/Kolkata` (a curated
 * option shipped today), `Europe/Kyiv`, `US/Eastern` and `GMT` — ICU keeps the
 * old spellings (`Asia/Calcutta`, `Europe/Kiev`) as its canonical names, so
 * testing membership against that list rejects values every runtime accepts
 * (#5712's own env repro, re-measured in #5933). The probe is the definition
 * the platform's consumers already use: `isValidTimeZone` in
 * `packages/core/src/security/resolve-authz-context.ts` (module-private there,
 * hence re-stated rather than imported) and the IANA assertion in
 * `localization.manifest.test.ts`. Note the probe is case-insensitive
 * (`europe/zurich` constructs fine) — that IS the pinned definition: the
 * accepted domain equals what every `Intl`-based consumer downstream accepts.
 */
function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * `iso_4217_currency` membership — `Intl.supportedValuesOf('currency')`.
 *
 * Here the enumeration IS usable (measured 162 entries on the Node 22
 * baseline: admits `CHF` and all nine curated localization options, rejects
 * `XYZ`). Known gaps are the recently assigned `VED` and the metal/fund codes
 * (`XAU`, `XDR`, …) — widen deliberately if a deployment needs one, never by
 * falling back to a regex. Membership is exact (uppercase, as ISO 4217 spells
 * codes); computed once and cached, since the set is a property of the runtime
 * and `validatePatch` runs per write.
 */
let iso4217Cache: ReadonlySet<string> | undefined;
function iso4217Codes(): ReadonlySet<string> {
  // The cast exists because the repo's root tsconfig `lib` is ES2020 while
  // `Intl.supportedValuesOf` is typed in lib.es2022.intl — the RUNTIME is
  // guaranteed (engines >= 22; the spec's own vocabulary test calls it bare).
  // Delete the cast when the root `lib` moves to ES2022+; do not widen it.
  const intl = Intl as typeof Intl & { supportedValuesOf(key: 'currency'): string[] };
  iso4217Cache ??= new Set(intl.supportedValuesOf('currency'));
  return iso4217Cache;
}

/**
 * `iso_3166_alpha2` — the officially assigned ISO 3166-1 alpha-2 codes,
 * carried explicitly because there is NO standard-library oracle for this
 * domain (measured in #5933): `Intl.DisplayNames(…, { type: 'region' })`
 * returns a distinct display name for `ZZ` ("Unknown Region" — the exact value
 * this domain exists to reject) and for `UK` (a CLDR alias that is not an
 * ISO 3166-1 code), so "the name differs from the input" is not a membership
 * test. The spec's TSDoc says the enforcing side must carry the list; this is
 * that list — the 249 officially assigned codes. User-assigned and reserved
 * elements (`ZZ`, `XX`, `UK`, `AA`, `QM`–`QZ`, …) are deliberately absent.
 * Membership is exact uppercase, as the standard spells the codes; nothing in
 * this repo writes lowercase country values, and one strict spelling is the
 * shape AI-authored metadata cannot get subtly wrong.
 */
const ISO_3166_ALPHA2 = new Set(
  (
    'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ ' +
    'BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
    'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ ' +
    'DE DJ DK DM DO DZ ' +
    'EC EE EG EH ER ES ET ' +
    'FI FJ FK FM FO FR ' +
    'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY ' +
    'HK HM HN HR HT HU ' +
    'ID IE IL IM IN IO IQ IR IS IT ' +
    'JE JM JO JP ' +
    'KE KG KH KI KM KN KP KR KW KY KZ ' +
    'LA LB LC LI LK LR LS LT LU LV LY ' +
    'MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ ' +
    'NA NC NE NF NG NI NL NO NP NR NU NZ ' +
    'OM ' +
    'PA PE PF PG PH PK PL PM PN PR PS PT PW PY ' +
    'QA ' +
    'RE RO RS RU RW ' +
    'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ ' +
    'TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
    'UA UG UM US UY UZ ' +
    'VA VC VE VG VI VN VU ' +
    'WF WS ' +
    'YE YT ' +
    'ZA ZM ZW'
  ).split(' '),
);

/** Exported for the structural pins in `value-domains.test.ts` only. */
export const ISO_3166_ALPHA2_CODES: ReadonlySet<string> = ISO_3166_ALPHA2;

/**
 * The closed set of domains this side knows how to enforce — kept equal to
 * `SpecifierValueDomainSchema`'s members (`value-domains.test.ts` pins the
 * equality, so a spec-side vocabulary change goes red here instead of becoming
 * a declared-but-unenforced member, the Prime Directive #10 shape).
 */
const DOMAIN_MEMBERSHIP: Record<SpecifierValueDomain, (value: string) => boolean> = {
  iana_time_zone: isIanaTimeZone,
  iso_4217_currency: (value) => iso4217Codes().has(value),
  iso_3166_alpha2: (value) => ISO_3166_ALPHA2.has(value),
};

/**
 * The declared `valueDomain`, when it is one this side can enforce; else null.
 *
 * `registerManifest` and `validatePatch` take manifests as given (no Zod pass —
 * a Zod-parsed manifest can never carry an unknown member, the enum is closed),
 * so a hand-built manifest with a misspelt domain records NOTHING here rather
 * than an unenforceable claim: the specifier behaves exactly as if the key were
 * absent — for an option-bearing type that means the #5131 exhaustive-options
 * check stays in force — which is the same "record nothing rather than an empty
 * table" leniency the option-table registration takes, and strictly safer than
 * accepting everything on the strength of a typo.
 */
export function knownValueDomain(declared: unknown): SpecifierValueDomain | null {
  // Own-property, not `in`: the record is an object literal, so `'toString' in
  // DOMAIN_MEMBERSHIP` is true via the prototype chain and would hand a
  // hand-built manifest a "domain" whose enforcer is not a membership test.
  // (`hasOwnProperty.call` rather than `Object.hasOwn` only because the root
  // tsconfig `lib` is ES2020 — same story as the `supportedValuesOf` cast.)
  return typeof declared === 'string' &&
    Object.prototype.hasOwnProperty.call(DOMAIN_MEMBERSHIP, declared)
    ? (declared as SpecifierValueDomain)
    : null;
}

/**
 * The first member of `value` the domain does not admit, or `null` when every
 * member is admissible.
 *
 * Mirrors `firstRejectedOption` deliberately, member for member: element-wise
 * over arrays (a `multiselect` stores one), scalar wrapped rather than
 * rejected (shape is `invalid_type`'s business, not membership's), compared in
 * string form (a stored value has been through JSON and a form post), and
 * returning a wrapper so "nothing rejected" and "the rejected member WAS
 * `undefined`" stay distinguishable.
 */
export function firstRejectedDomainMember(
  domain: SpecifierValueDomain,
  value: unknown,
): { value: unknown } | null {
  const member = DOMAIN_MEMBERSHIP[domain];
  const picked = Array.isArray(value) ? value : [value];
  const at = picked.findIndex((v) => !member(String(v)));
  return at === -1 ? null : { value: picked[at] };
}

/**
 * The three prose fragments a rejection message needs, per domain — one
 * definition feeding BOTH doors (`validatePatch`'s `FieldError.message` and
 * `reportRejectedEnvOverride`'s log line), so the two never describe the same
 * domain in different words.
 */
export function valueDomainPhrasing(domain: SpecifierValueDomain): {
  /** What a legal member is called, e.g. "IANA time zone identifier". */
  member: string;
  /** A representative legal value that is NOT in the curated options today. */
  example: string;
} {
  switch (domain) {
    case 'iana_time_zone':
      return { member: 'IANA time zone identifier', example: 'Europe/Zurich' };
    case 'iso_4217_currency':
      return { member: 'ISO 4217 currency code', example: 'CHF' };
    case 'iso_3166_alpha2':
      return { member: 'ISO 3166-1 alpha-2 country code', example: 'CH' };
  }
}
