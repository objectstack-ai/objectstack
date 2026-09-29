---
'@objectstack/lint': patch
---

Provenance comments in `@objectstack/lint`'s authoring-rule registry were re-anchored

Five comment and docblock lines in `src/authoring-rules.ts` that cited tracker
numbers which no longer resolve on GitHub now cite the commit in this
repository's history that decided the matter, and keep saying what was
decided. Comments only: no rule id, finding message, hint, severity, type or
runtime behaviour changes.
