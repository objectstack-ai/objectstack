// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Standard value-domain enforcement for settings specifiers — the settings
 * door's adapter over the ONE shared predicate.
 *
 * A specifier that declares `valueDomain` says: the legal values for this key
 * are the members of this published standard, and that membership — not the
 * curated `options` table — is the enforcement boundary.
 *
 * ## Where the definitions live now (and why not here)
 *
 * Maintainer ruling 2026-09-02 on the field-level card: **one closed vocabulary
 * and one membership predicate shared by settings specifiers and object
 * fields**. Both now live in `@objectstack/spec/shared`
 * (`shared/value-domain.zod.ts`) — {@link ValueDomainSchema} is the vocabulary
 * (`SpecifierValueDomainSchema` is an alias of it, not a copy) and
 * `isValueDomainMember` is the predicate, with every definition's traps argued
 * and re-measured in that module's own header and test.
 *
 * Until that ruling this module carried its own second copy of all three
 * definitions: the `Intl.DateTimeFormat` probe, a run-time
 * `Intl.supportedValuesOf('currency')` set, and the 249 ISO 3166-1 alpha-2
 * codes. The copies are gone. What is left here is what is genuinely the
 * DOOR's: which declarations it agrees to enforce
 * ({@link knownValueDomain}), how a multi-value carrier is walked
 * ({@link firstRejectedDomainMember}), and the prose fragments the env-override
 * log line needs ({@link valueDomainPhrasing}). Nothing in this file decides
 * membership; a membership question that is not `isValueDomainMember` is a
 * third copy re-appearing, and `value-domains.shared-predicate.pin.test.ts` is
 * the ratchet that reddens when one does.
 *
 * ⚠️ One definition MOVED with the re-point, in a direction the shared module
 * argues for: `iso_4217_currency` was a run-time probe of
 * `Intl.supportedValuesOf('currency')` and is now the key set of the
 * checked-in CLDR snapshot `CURRENCY_FRACTION_DIGITS`. Measured on the repo's
 * Node 22 baseline (v22.22.2) the two sets are identical — 162 codes each,
 * symmetric difference 0 in both directions — so no value changes verdict on
 * this runtime; what changes is that the verdict no longer varies with the
 * host's ICU build.
 */

import {
  isValueDomainMember,
  ValueDomainSchema,
  type ValueDomain,
} from '@objectstack/spec/shared';

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
 *
 * The vocabulary's own `safeParse` is the filter. It admits the three declared
 * members and nothing else — in particular no inherited property name
 * (`'toString'`, `'constructor'`), which the previous implementation had to
 * exclude by hand because it looked the domain up in an object literal and
 * `'toString' in DOMAIN_MEMBERSHIP` is true through the prototype chain. A
 * closed `z.enum` matches literal members only, so the guard is now structural
 * rather than remembered; `value-domains.test.ts` keeps pinning both names.
 */
export function knownValueDomain(declared: unknown): ValueDomain | null {
  const parsed = ValueDomainSchema.safeParse(declared);
  return parsed.success ? parsed.data : null;
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
 *
 * The membership question itself is `isValueDomainMember` — the same call the
 * record write path makes, so a value accepted in Settings is the same value
 * accepted in a field and vice versa.
 */
export function firstRejectedDomainMember(
  domain: ValueDomain,
  value: unknown,
): { value: unknown } | null {
  const picked = Array.isArray(value) ? value : [value];
  const at = picked.findIndex((v) => !isValueDomainMember(domain, String(v)));
  return at === -1 ? null : { value: picked[at] };
}

/**
 * The two prose fragments the ENV-OVERRIDE log line needs, per domain.
 *
 * Scope narrowed with the re-point: the save path's `FieldError` no longer
 * builds its sentence here — it renders the published catalog template
 * `value_domain_<domain>` (`@objectstack/spec/system`), the same catalog the
 * record write path renders, so the two doors cannot describe one domain in
 * different words. `reportRejectedEnvOverride` writes a LOG line, not a
 * `FieldError`: it has no error code, no locale and no `{{label}}`, and its
 * one sentence template wants fragments ("is not a valid X for", "any X (e.g.
 * 'Y')") rather than a finished sentence. So the fragments stay here, and
 * `value-domains.test.ts` pins each one against the catalog template for the
 * same domain — drift between the log line and the wire message goes red
 * instead of rotting.
 */
export function valueDomainPhrasing(domain: ValueDomain): {
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
