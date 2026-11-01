---
'@objectstack/service-i18n': patch
---

Clause-②: no
Metadata-protocol: none

A translation the file adapter could not serve as asked is now reported once through the plugin logger, instead of falling back in silence (#28109). What `t()` returns is unchanged.

- The requested locale lacks a key the fallback locale holds: one `warn` per key and locale, naming both, so whoever owns the bundle can add the translation.
- The requested locale has no bundle at all: one line per locale, not one per key. It is a `warn` when the app offers that locale in `i18n.supportedLocales`, and `debug` when it does not (a client asked for a locale the app never offered, so the fallback is the designed answer).
- No bundle holds the key: one `debug` line per key and locale, because most callers probe optional addresses on purpose and read the echoed key as "not overridden".
- Reports stop after 1000 distinct misses (`FileI18nAdapter.MISSING_TRANSLATION_REPORT_LIMIT`), with one line saying so.

`FileI18nAdapter` takes an optional `logger`; without one it stays silent, as before.
