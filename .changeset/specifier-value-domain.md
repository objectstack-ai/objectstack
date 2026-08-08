---
"@objectstack/spec": minor
---

feat(spec): SettingsManifest specifiers can declare a standard `valueDomain` (#5933)

`SpecifierSchema`'s value constraints were `options` / `pattern` / `min` / `max` /
`minLength` / `maxLength`, and none of them can express "the legal values here are
whatever the published standard says". `pattern` constrains the *shape* of a string,
so `^[A-Za-z]{2}$` admits `ZZ` and `Mars/Olympus` is a shape-valid time zone that does
not exist; `options` is exhaustive (#5131), so completing it would mean checking a
600-entry tzdb table into a manifest and re-checking it every tzdb release. The
`localization` manifest hits this on three keys at once — `timezone`, `currency`,
`default_country` — and `company.country` carries the same two-letter pattern with the
same hole.

**New optional key: `specifier.valueDomain`**, a closed enum with three members:

- `iana_time_zone`
- `iso_4217_currency`
- `iso_3166_alpha2`

Declaring it moves the enforcement boundary: the standard's membership becomes what a
write is judged against, and `options` degrades to a **UI convenience list** — a curated
dropdown of values worth suggesting, no longer an exhaustive statement of what is legal.
A value outside `options` but inside the domain is accepted.

**Nothing changes when it is absent.** `options` stays exhaustive and the save path keeps
rejecting anything the table does not list, which is the right shape for tables the
platform itself backs (`mail.provider`, `sms.provider`) where "legal" means "this
deployment ships an adapter for it". `pattern` / `minLength` / `maxLength` still apply
alongside a domain and still narrow — shape and membership are independent, and a value
must satisfy both.

The **enforcement** is not in this release. `packages/spec` declares the domain and
nothing more (Prime Directive #2); the write-path check lands in `service-settings`
(#5712, blocked on this). What ships here so both halves agree is the *definition of
membership* for each domain, pinned by tests rather than left to prose, because for two
of the three the obvious oracle is the wrong one:

- `iana_time_zone` is the `Intl.DateTimeFormat` probe, not
  `Intl.supportedValuesOf('timeZone')` — measured on the Node 22 baseline, that list
  holds 418 CLDR canonical names and omits `UTC` (this platform's own declared default)
  and `Asia/Kolkata` (a value the shipped localization manifest curates), carrying the
  latter only under the legacy spelling `Asia/Calcutta`.
- `iso_4217_currency` **is** `Intl.supportedValuesOf('currency')` — 162 entries,
  admitting `CHF` and all nine curated options while rejecting `XYZ`.
- `iso_3166_alpha2` has no standard-library oracle at all:
  `Intl.DisplayNames(…, { type: 'region' }).of()` returns a distinct name for `ZZ`
  ("Unknown Region", the exact value this domain exists to reject) and for `UK` (a CLDR
  alias that is not an ISO 3166-1 code), so the enforcing side must carry an explicit
  code list.

`bcp47_locale`, the fourth member the proposal listed, is deliberately **not** in the
vocabulary. Its only candidate key is `localization.locale`, whose options are exactly
the shipped message catalogs — a registry-backed table, so a domain there would loosen
it and admit locales with no catalog. And BCP-47 has no membership registry to enforce
against (`Intl.getCanonicalLocales('xx-YY')` succeeds), so the "domain" would only
re-check syntax — the weakness `pattern` already has and this key exists to fix.
