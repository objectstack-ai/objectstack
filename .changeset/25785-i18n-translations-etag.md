---
'@objectstack/runtime': patch
---

fix(runtime): `GET /i18n/translations/:locale` carries an `ETag` and `Cache-Control: private, no-cache`, and a matching `If-None-Match` is answered `304`

Clause-②: no
Metadata-protocol: none

- **Before.** The translation bundle (both spellings, `/i18n/translations/:locale` and `/i18n/translations?locale=`) answered every read with the whole locale bundle and neither header, so a browser re-downloaded it on every console open: 80–88 KB compressed on a hosted tenant.
- **Now.** The `200` carries a weak `ETag`, a SHA-256 of the exact envelope served (`locale`, `requestedLocale` and `translations`), computed on every read, and `Cache-Control: private, no-cache`. A request whose `If-None-Match` names that representation (a strong or weak tag, a comma list, or `*`) is answered `304` with no body and the same two headers. A bundle that changed since the validator was issued is served in full under a new validator.
- **Unchanged.** The `200` body is byte-for-byte the envelope it was. An anonymous caller is still refused `401` before any validator is read, and refusals carry neither header. `/i18n/locales` and `/i18n/labels/*` are untouched.
