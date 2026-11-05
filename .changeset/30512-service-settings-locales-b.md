---
'@objectstack/service-settings': patch
---

i18n(service-settings): the built-in Setup settings pages ship in Russian, German and Korean

Clause-②: no
Metadata-protocol: none

The built-in settings pages (Mail, SMS, Branding, Company, Localization, Authentication, File Storage, AI & Embedder, Knowledge, and the Data Lifecycle page `@objectstack/objectql` registers) now carry `ru`, `de` and `ko` beside the existing eight locales: page titles and descriptions, group headings, field labels and help, option labels, banners, action buttons and the source badges. An administrator reading Setup in one of those languages sees these pages in their own language instead of English. Country pickers name each country in the reader's language through `Intl.DisplayNames`, as the existing locales do. The settings coverage test now holds each new locale to the same full coverage. Second half of package 6 of #30512; with it every built-in settings page carries all eleven platform locales.
