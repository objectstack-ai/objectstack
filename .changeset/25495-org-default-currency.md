---
'@objectstack/plugin-auth': patch
---

A new organization now gets its default currency from its creator's language or region. When an organization is created through `POST /api/v1/auth/organization/create`, the server reads the creator's stored language (`sys_user.locale`), or else the creating request's `Accept-Language`. It writes that region's ISO 4217 currency as the organization's `localization.currency`: `zh-CN` gives `CNY`, `ja` gives `JPY`, `en-GB` gives `GBP`. The value is an ordinary tenant setting, so Setup → Localization shows it and can change it. Amounts in `currencyMode: 'dynamic'` fields then show that currency instead of a plain number.

Clause-②: no
Metadata-protocol: none

When there is nothing to derive from (no stored language, no `Accept-Language`, or a tag with no country such as `es-419`), nothing is written and the setting stays unset, as before. There is no fallback to the `default_country` or `locale` platform defaults. A value already set on any rung (the organization's own, a global row, or an `OS_LOCALIZATION_CURRENCY` override) is never overwritten. A host's own `onOrganizationCreated` callback still runs, before this step.

The `os dev` seed does the same for its admin's workspace from the host's POSIX locale (`LC_ALL`, then `LC_MONETARY`, then `LANG`), beside its time-zone seeding. `C`, `POSIX`, and a host with no locale set write nothing.

The region-to-currency table is a checked-in snapshot of CLDR 48 `currencyData`.
