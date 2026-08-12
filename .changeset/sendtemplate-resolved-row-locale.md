---
"@objectstack/plugin-email": patch
---

fix(plugin-email): `sendTemplate` renders format filters in the RESOLVED template row's locale (#7801)

A `sendTemplate` call that named no `locale` resolved a concrete template row
(#7731) but left `renderOpts.locale` **unset**, so the locale-sensitive format
filters — `{{ ts | datetime }}`, `{{ amt | number:2 }}`, `currency`, `percent`,
`date` — did not follow the row they were rendering into. The template row is
now the **single locale authority**: mixed-locale output (a row's body text in
one locale, its dates and numbers in another) is a defect, not a feature.

What changes in practice:

- A no-locale send that resolves a **zh-CN** row — an i18n bundle with no en-US
  row at all, the locale ladder's last rung — now formats its dates and numbers
  **zh-CN**. It previously rendered `3/5/26, 2:30 PM` inside zh-CN body text,
  because the filters fell through to `formatValue`'s own `?? 'en-US'` default.
- A no-locale send that resolves the **en-US** row is unchanged; that case only
  ever looked correct because the row's locale and the filter default happened
  to coincide.
- An explicit `input.locale` **still wins** over the resolved row, including
  when it has no row of its own and the ladder falls back to en-US: asking for
  `fr-FR` renders the en-US body with fr-FR dates, exactly as before.
- Also fixed in passing: an `input.locale` with surrounding whitespace
  (`'  de-DE  '`) resolved the `de-DE` row and then threw
  `RangeError: Incorrect locale information provided` out of `Intl`, failing the
  whole send. The render now binds the same trimmed tag the row lookup used.
