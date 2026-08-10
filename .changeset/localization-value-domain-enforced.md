---
"@objectstack/service-settings": patch
---

fix(service-settings): localization's declared standards are the enforcement boundary — `valueDomain` enforced on both doors (#5712)

`localization.timezone` promised "IANA zone" and `localization.currency` promised
"ISO 4217 code", but since #5131 the write path treated their curated 17/9-entry
`options` tables as exhaustive, and since #5204 the env path agreed — so
`PUT /api/settings/localization` with `timezone: 'Europe/Zurich'` (or
`currency: 'CHF'`) was refused with `invalid_option`, and
`OS_LOCALIZATION_TIMEZONE=Europe/Zurich` was ignored, despite both being values
every `Intl`-based consumer downstream handles. Maintainer ruling (2026-08-06,
reading 1): the curated tables are UI convenience lists; the boundary is the
standard's membership.

The manifest now declares the merged spec vocabulary (#5933 / `SpecifierValueDomainSchema`)
on the three keys that promised a standard all along — `timezone: 'iana_time_zone'`,
`currency: 'iso_4217_currency'`, and `default_country: 'iso_3166_alpha2'` (third
case of the same hole: `^[A-Za-z]{2}$` admits `ZZ`) — and `SettingsService`
enforces a declared domain at the one decision point per door:

- **Write door** (`validatePatch`): a domain-bearing specifier skips the
  exhaustive-options check and judges the standard's membership instead, after
  `pattern` (shape and membership narrow independently; the shape breach is the
  coarser fact and speaks first). A breach is `invalid_value` with
  `constraint: { valueDomain }` — no `FieldErrorCode` member names a
  standard-domain breach, and `invalid_option` would misname the set that was
  consulted.
- **Env door** (`effectiveEnvOverride`): the same membership judgment, so a
  garbage override is loudly reported and ignored (falls back down the cascade,
  pins nothing — #5204's contract, unchanged) while a legal one wins the cascade
  and locks the key.

Membership definitions follow the spec's pinned TSDoc: `iana_time_zone` is the
`Intl.DateTimeFormat` probe (NOT `Intl.supportedValuesOf('timeZone')`, whose
CLDR subset omits `UTC`, `Asia/Kolkata` and `Europe/Kyiv`); `iso_4217_currency`
is `Intl.supportedValuesOf('currency')`; `iso_3166_alpha2` is an explicit list
of the 249 officially assigned codes (no standard-library oracle exists —
`Intl.DisplayNames` names `ZZ` and `UK`).

A specifier that declares no `valueDomain` is byte-for-byte unchanged: #5131's
exhaustive-options semantics stay in force for registry-backed tables such as
`mail.provider` / `sms.provider`, pinned by regression tests on both doors.
