---
'@objectstack/cli': patch
---

Provenance comments in `@objectstack/cli`'s `bin/run.js` were re-anchored

Three docblock lines above `bin/run.js`'s `process.stderr` `error` listener
cited a tracker number that no longer resolves on GitHub. They now cite the
commit in this repository's history that made a failed stderr write non-fatal
on the dev shim. The file ships because npm packs a `bin` target regardless of
`files`, which is why this is a release note at all. Comment only: no command,
flag, exit code, error code, export or runtime behaviour changes.
