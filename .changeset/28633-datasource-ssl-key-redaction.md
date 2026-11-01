---
'@objectstack/spec': patch
---

fix(spec): the datasource read redactor covers the declared `ssl` secret members

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, and no authored value is refused, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a read answer: the metadata read exits serve a datasource without `ssl.key` and name it in `redactedKeys`, the posture they already apply to `config` credentials. The stored row keeps the key for the connect path, and the generic write-path carry-forward keeps it on a save that omits it. No exported declaration is removed or narrowed (not runtime-interface-only or type-surface-only); the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered). -->

**BREAKING** (a read-answer narrowing), shipped as `patch`: a non-protocol narrowing takes `patch` and keeps this banner and its ADR-0087 disposition.

`DatasourceSchema.ssl.key` (the client private key) is now marked a credential value (`.meta({ credential: 'value' })`), and the built-in `datasource` read redactor applies the schema's credential markers beside its `config` rule. Every metadata read exit that resolves the `datasource` redactor (`/meta` item, list and layered reads, and the stored-row seam behind the `sys_metadata` data door) drops `ssl.key` from the served item and lists `ssl.key` in `redactedKeys`.

**Unchanged.** `ssl.enabled`, `ssl.rejectUnauthorized`, `ssl.ca` and `ssl.cert` are public material and stay served. A datasource with no `ssl` block, or with an empty `key`, is served exactly as stored. The stored row is never rewritten, and a save that sends back the served body keeps the stored key.
