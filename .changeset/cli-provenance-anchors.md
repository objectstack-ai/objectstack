---
'@objectstack/cli': patch
---

Provenance comments in `@objectstack/cli` were re-anchored

Comment and docblock lines under `src/` that cited tracker numbers which no
longer resolve on GitHub now cite the commit in this repository's history that
decided the matter, and say in their own words what was decided. Two strings
move with them: the `os i18n extract --source-hashes` help text now says what
the provenance companion records instead of citing a number, and the header
that flag writes into each `<locale>.source-hashes.generated.ts` cites the
commit that introduced the companion. No command, flag, exit code, error code,
type, export or runtime behaviour changes.
