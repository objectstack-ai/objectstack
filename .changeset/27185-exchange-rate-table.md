---
'@objectstack/platform-objects': patch
---

feat(platform-objects): `sys_exchange_rate` — an organization's dated exchange rates, with a Setup list under Localization

Clause-②: no
Metadata-protocol: none

A new system object holds the rates multi-currency amounts are converted with, one row per currency and effective date:

- **Columns.** `currency` (an ISO 4217 code, checked on write), `rate` (exact decimal, 12 decimal places, strictly positive), `effective_date` (date) and `source` (`manual` / `import` / `app`, default `manual`).
- **Direction.** One row means 1 unit of the organization's home currency (Localization → Default currency) = `rate` units of the row's currency. The sentence is exported as `EXCHANGE_RATE_DIRECTION` and shown on the Setup list page; the scale is exported as `EXCHANGE_RATE_SCALE`.
- **One rate per currency per day.** `(currency, effective_date)` is unique within an organization; two organizations may each hold their own EUR rate for the same day.
- **Who.** Per organization (its `organization_id` is injected and the tenant wall scopes it). Organization administrators read and write it; rank-and-file members do not see it. Every change is captured in the audit log and shown on the record's History tab.
- **Where.** Setup → Configuration → Exchange Rates, directly under Localization. `PlatformObjectsPlugin` registers the object with the other platform-infrastructure objects.

Nothing reads the table yet: the write-time home-currency conversion that uses it ships in the same release.
