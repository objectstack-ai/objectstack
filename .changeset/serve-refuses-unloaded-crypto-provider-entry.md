---
'@objectstack/cli': patch
---

fix(cli): `os serve` refuses to boot when a `plugins` entry that may provide the crypto provider does not load

Clause-②: no
Metadata-protocol: none

`os serve` now refuses to boot when an entry of the stack's `plugins` does not load and nothing rules out that it provides the crypto provider (`crypto-provider`), which seals every secret field, datasource credential and encrypted setting. The refusal names each such entry and the reason it did not load.

- An entry that never materialized, such as a package specifier that does not resolve or import, says nothing about what it provides, so the boot is refused.
- An entry that materialized and declares `providesServices: ['crypto-provider']` is refused.
- An entry whose `providesServices` does not name the crypto provider is ruled out. The boot prints `✗ Failed to load plugin` for it and goes on without it, as before.

This is the rule the one-shot secret commands keep for the same host config.
