---
'@objectstack/plugin-dev': patch
---

Provenance comments in `@objectstack/plugin-dev` were re-anchored

Comment and docblock lines under `src/` that cited tracker numbers which no
longer resolve on GitHub now cite the commit in this repository's history that
decided the matter, and say in their own words what was decided. Comments
only: no service, boot-log line, warning text, type, export or runtime
behaviour changes.
