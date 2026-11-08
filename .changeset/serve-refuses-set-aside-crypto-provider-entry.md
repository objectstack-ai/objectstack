---
'@objectstack/cli': patch
---

fix(cli): `os serve` refuses to boot a standalone stack whose `plugins` lists an entry that may provide the crypto provider

Clause-②: no
Metadata-protocol: none

When a stack's `plugins` lists no plugin instance (no entry with `init`), `os serve` boots the standalone stack and does not load the authored `plugins` entries. It now refuses that boot when one of those entries may provide the crypto provider (`crypto-provider`), which seals every secret field, datasource credential and encrypted setting, and names the entry:

- an entry that declares `providesServices: ['crypto-provider']`;
- a package specifier that does not import, which declares nothing.

An entry whose `providesServices` does not name the crypto provider (or that declares none) keeps today's handling. To boot a provider plugin, list its plugin instance in the stack's `plugins`.
