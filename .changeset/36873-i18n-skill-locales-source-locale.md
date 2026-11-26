---
'@objectstack/skills': patch
---

docs(skills): the i18n skill says what `GET /api/v1/i18n/locales` answers about the default and source locale

Clause-②: no (published prose only; names a member the locales read already returns on main)
Metadata-protocol: none

The Registration section of `skills/objectstack-i18n/SKILL.md` now says the locales answer marks the default locale (`isDefault`) and names `sourceLocale` (the declared one, else the default), so a client that writes translations can tell which language inline `label:` text is in without reading the stack config. The words are paid for in the same file, with no fact removed: the note that the contract's `.ts` source does not ship becomes one line, and the optional-methods sentence drops "Treat them as".
