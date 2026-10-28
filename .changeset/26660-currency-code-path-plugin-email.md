---
'@objectstack/plugin-email': minor
---

feat(plugin-email): a mail template formats an amount in the record's own currency with `currency:@path`

Clause-②: yes
Metadata-protocol: added

`{{ planned_amount | currency:@currency_code }}` formats the amount in the currency whose ISO 4217 code the send's `data` holds at `currency_code`, so one template, in every locale row of its bundle, serves records in many currencies. With `currency_code: 'EUR'` it renders `€1,234.50` in `en-US`; with `'CNY'` it renders `CN¥1,234.50` in `en-US` and `¥1,234.50` in `zh-CN`. The path is resolved like a hole's own path, in all three faces, double- or triple-braced.

The value at the path must be the code in three capital letters, as stored. A missing or `null` value, a lowercase code (`eur`) or any other value makes `renderTemplate` and `sendTemplate` throw `TEMPLATE_INVALID: email template NAME (locale=L): …`, naming the hole, the path and the value, and send nothing. The amount is never formatted in a default currency in its place.

Unchanged: a literal code (`currency:EUR`) formats in that code, no argument formats in US dollars, and a bare path (`currency:currency_code`) is still refused with `TEMPLATE_INVALID`.
