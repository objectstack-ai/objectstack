---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): the marketplace card and package page show which languages an app ships, with coverage

Clause-②: yes (widening)
Metadata-protocol: none

The control plane now measures, when a version is published, which languages it carries text for and how much of the app each one translates, and serves them on the version as `supported_locales` and `locale_coverage`. The marketplace reads them:

- **The catalog card** names the latest version's languages in their own script, the default first, each with its coverage (`简体中文 100% · 日本語 60%`). It shows three, then how many more; the full list is the line's tooltip and what a screen reader hears.
- **The package page** lists every language in its taxonomy strip, the default marked.
- **A version published before the measurement** reads "No language information", never "English only".
- **A catalog that does not serve the keys yet** draws nothing new: the card and page look as they did.

A language is named the way the header's language menu names it: a served code is read through the platform locale table first, so `zh-CN` reads 简体中文, and a code outside the table is named by the browser in its own language (`th` reads ไทย). Percents are formatted in the display locale, as the page's dates are.

`@object-ui/i18n` adds four keys to every marketplace catalogue: `marketplace.facet.languages`, `marketplace.languages.none`, `marketplace.languages.more` and `marketplace.languages.default`.
