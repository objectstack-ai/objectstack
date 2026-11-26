---
'@objectstack/spec': patch
'@objectstack/lint': patch
---

feat(lint): warn when a text field named like a currency, country or time zone code declares no valueDomain

Clause-②: yes
Metadata-protocol: none

`os lint` gains `field/missing-value-domain`, a warning. It fires on a `text` field that declares no `valueDomain` and whose whole name, compared case-insensitively, reads as a standard code: `currency` or `currency_code` (fix: `valueDomain: 'iso_4217_currency'`), `country` or `country_code` (`iso_3166_alpha2`), `time_zone`, `timezone` or `tz` (`iana_time_zone`). The fix line names the domain to add. A field that already declares a domain, a `select` field, any other type and any other name are not judged. It is a warning only: `os validate`, `os build` and the metadata save door are unchanged. Like every warning, it makes `os lint --strict` exit 1; there is no per-rule switch, so a strict run fails until the field declares the domain. Declaring it does not re-read rows that already hold free text; only a later write that carries a non-member is refused. `os explain field/missing-value-domain` gives the reasoning.

New exports: `VALUE_DOMAIN_FIELD_NAMES` from `@objectstack/spec/shared`, the one word list (domain → field names) the rule reads, and `FIELD_MISSING_VALUE_DOMAIN` from `@objectstack/lint`. The word list adds no member to `ValueDomainSchema`.
