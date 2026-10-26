---
'@objectstack/cli': patch
---

docs(cli): the README says the three code subpaths are ESM

Clause-②: no
Metadata-protocol: none

`@objectstack/cli`'s README now states that `.`, `./console` and `./hook-body` are ES modules: load them with `import`, and from CommonJS with `import()`, or with `require()` only on a Node that loads ES modules synchronously (22.12 and later). No export map or code changes.
