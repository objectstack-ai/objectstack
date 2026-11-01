---
'@object-ui/i18n': patch
---

refactor(i18n)!: delete four `publicForm` keys that no screen reads

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) the four deleted keys are message strings in the built-in locale packs that no t() call site in the workspace or in hotcrm reads; they are not metadata, no packages/spec schema or stored shape names them, and a host that kept its own text under these keys keeps it in its own resources -->

**BREAKING** only for TypeScript code that names one of the deleted keys through the pack-derived key type (`TranslationKeys`): `publicForm.consentRequired`, `publicForm.rateLimited`, `publicForm.redirectBlocked` and `publicForm.requiredHint` leave all ten packs (ar, de, en, es, fr, ja, ko, pt, ru, zh). No screen in the Console or in any `@object-ui/*` package showed them. The form page's other `publicForm` keys (`submit`, `submitting`, `poweredBy`, `thankYouTitle`, `thankYouMessage`, `redirecting`, `redirectPending`, `loading`, `requiredFields`) are unchanged.
