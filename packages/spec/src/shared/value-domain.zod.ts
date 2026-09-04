// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Standard value domains — ONE closed vocabulary and ONE membership predicate,
 * shared by settings specifiers (`Specifier.valueDomain`) and object fields
 * (`Field.valueDomain`).
 *
 * Maintainer ruling 2026-09-02 (A on the field-level card, verbatim 「同意」):
 * `FieldSchema` gains a `valueDomain` slot whose vocabulary is exactly the
 * settings specifier's three members — one closed vocabulary and one
 * membership predicate shared by settings specifiers and object fields; the
 * vocabulary does not widen. Before that ruling the vocabulary lived in
 * `system/settings-manifest.zod.ts` and the predicate lived in
 * `service-settings` only, so a second declaring surface would have meant a
 * second copy of both. This module is the one home; `SpecifierValueDomainSchema`
 * is an alias of {@link ValueDomainSchema} (same name, same three members, same
 * shape — nothing consuming it moved).
 *
 * ## Why the PREDICATE lives in `packages/spec` at all
 *
 * Prime Directive #2 keeps business logic out of the spec, and the earlier
 * TSDoc of this vocabulary read that as "the list does not live here". The
 * ruling above settles it the other way for this one predicate, on the same
 * footing as the package's existing shared verdicts: `currencyPrecisionContradiction`
 * (a checked-in CLDR table and the rule read over it), `filterVerdict`, the
 * comparand-shape door. Each is a pure, dependency-free function two or more
 * doors must answer IDENTICALLY — and "the same answer on both doors" is
 * exactly what a shared contract is for. The predicate takes no I/O, holds no
 * state, and reads no runtime service; the write path (engine) and the
 * settings door call it, they do not re-derive it.
 *
 * ## The definitions of membership, per domain
 *
 * "The IANA time zone database" and "what this Node happens to enumerate" are
 * measurably different sets, and picking the wrong one rejects legal values.
 * Every definition below was measured on the repo's Node 22 baseline
 * (v22.22.2, full-icu); the shared test re-measures each trap so drift goes
 * red instead of rotting.
 *
 * - `iana_time_zone` — an IANA/tzdb zone identifier (`UTC`, `Asia/Kolkata`,
 *   `Europe/Kyiv`). **Membership is the `Intl.DateTimeFormat` probe**
 *   (construct with `{ timeZone: value }`, catch the `RangeError`) — the
 *   definition `isValidTimeZone` in
 *   `packages/core/src/security/resolve-authz-context.ts` and
 *   `localization.manifest.test.ts` already use.
 *   NOT `Intl.supportedValuesOf('timeZone')`: measured, it returns 418 CLDR
 *   *canonical* names and omits `UTC` (this platform's own declared default),
 *   `Asia/Kolkata` (a curated option in the shipped localization manifest),
 *   `Europe/Kyiv`, `Asia/Ho_Chi_Minh`, `US/Eastern` and `GMT` — ICU keeps the
 *   old spellings (`Asia/Calcutta`, `Europe/Kiev`) as its canonical names, so
 *   testing membership against that list rejects values every runtime accepts.
 *   The probe is case-insensitive (`europe/zurich` constructs fine) — that IS
 *   the pinned definition: the accepted domain equals what every `Intl`-based
 *   consumer downstream accepts. `Europe/Munich` and `Mars/Olympus` are
 *   shape-valid zones that do not exist, and the probe refuses both — the
 *   thing a `pattern` cannot do.
 * - `iso_4217_currency` — an ISO 4217 alphabetic currency code (`USD`, `CHF`),
 *   exact uppercase as the standard spells it. Membership is the key set of the
 *   checked-in CLDR snapshot `CURRENCY_FRACTION_DIGITS`
 *   (`data/currency-fraction-digits.ts`, 162 codes): that table was generated
 *   FROM `Intl.supportedValuesOf('currency')` on the baseline, and the shared
 *   test pins the two equal, so this is the same set the settings door has
 *   enforced since it shipped — read from a snapshot rather than probed at
 *   run time for the reason that table's own header gives (the verdict cannot
 *   vary with the host's ICU build, and the check takes no `Intl` dependency).
 *   Known, deliberate gaps of that definition: the recently assigned `VED` and
 *   the metal/fund codes (`XAU`, `XAG`, …). Widen by regenerating the snapshot,
 *   never by falling back to a regex.
 * - `iso_3166_alpha2` — an ISO 3166-1 alpha-2 country code (`US`, `GB`, `CN`),
 *   exact uppercase. There is no standard-library oracle for this one:
 *   measured, `Intl.DisplayNames(…, { type: 'region' }).of()` returns a
 *   distinct name for `ZZ` ("Unknown Region" — the exact value this domain
 *   exists to reject) and for `UK` (a CLDR alias that is not an ISO 3166-1
 *   code), so "the name differs from the input" is not a membership test.
 *   Membership is the explicit list of the 249 officially assigned codes
 *   ({@link ISO_3166_ALPHA2_CODES}); user-assigned and reserved elements
 *   (`ZZ`, `XX`, `UK`, `AA`, `QM`–`QZ`, …) are deliberately absent. One strict
 *   spelling is the shape AI-authored metadata cannot get subtly wrong.
 *
 * The vocabulary is closed and deliberately small: a member earns its place by
 * a metadata key that actually needs it, not by being a standard that exists.
 * `bcp47_locale` was proposed and dropped (no membership registry to enforce
 * against — `Intl.getCanonicalLocales('xx-YY')` succeeds, so a "domain" would
 * only re-check syntax, the weakness `pattern` already has).
 */

import { z } from 'zod';
import { CURRENCY_FRACTION_DIGITS } from '../data/currency-fraction-digits';

/**
 * The closed standard-domain vocabulary. Declared once here; referenced by
 * `Specifier.valueDomain` (`system/settings-manifest.zod.ts`, under its
 * historical export name `SpecifierValueDomainSchema`) and by
 * `Field.valueDomain` (`data/field.zod.ts`).
 */
export const ValueDomainSchema = z.enum([
  'iana_time_zone',
  'iso_4217_currency',
  'iso_3166_alpha2',
]);
export type ValueDomain = z.input<typeof ValueDomainSchema>;

/**
 * `iana_time_zone` membership — the `Intl.DateTimeFormat` probe (see the
 * module header for why the enumeration is NOT the definition).
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
 * The 249 officially assigned ISO 3166-1 alpha-2 codes — the explicit list the
 * module header argues no standard-library oracle can replace. Exported for
 * the structural pins (count, spelling) and for the settings door's own pins;
 * membership questions go through {@link isValueDomainMember}.
 */
export const ISO_3166_ALPHA2_CODES: ReadonlySet<string> = new Set(
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

/**
 * One membership test per domain — a `Record` over the vocabulary, so a
 * member added to {@link ValueDomainSchema} without a definition here fails
 * to compile rather than becoming a declared-but-unenforceable domain.
 */
const DOMAIN_MEMBERSHIP: Readonly<Record<ValueDomain, (value: string) => boolean>> = {
  iana_time_zone: isIanaTimeZone,
  iso_4217_currency: (value) => Object.prototype.hasOwnProperty.call(CURRENCY_FRACTION_DIGITS, value),
  iso_3166_alpha2: (value) => ISO_3166_ALPHA2_CODES.has(value),
};

/**
 * Is `value` a member of `domain`? THE shared membership predicate — the one
 * answer the settings door and the record write path both give, so a value
 * accepted in Settings is the same value accepted in a field and vice versa.
 *
 * Judges a single string exactly as written (no trimming, no case folding of
 * its own — the time-zone probe's case-insensitivity is the probe's, and the
 * two code domains are exact uppercase). Element-wise iteration over a
 * multi-value carrier, and the prose a refusal message needs, are the
 * caller's: this function answers membership and nothing else.
 */
export function isValueDomainMember(domain: ValueDomain, value: string): boolean {
  return DOMAIN_MEMBERSHIP[domain](value);
}
