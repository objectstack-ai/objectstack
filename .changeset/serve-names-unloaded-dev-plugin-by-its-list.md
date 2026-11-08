---
'@objectstack/cli': patch
---

fix(cli): `os serve` names an unloaded `devPlugins` entry by the list it was written in

Clause-②: no
Metadata-protocol: none

When `os serve --dev` refuses to boot because an entry that may provide the crypto provider (`crypto-provider`) did not load, a `devPlugins` entry is now named `devPlugins[i]` instead of by its position after the stack's `plugins`. Which entries are refused is unchanged: the refusal reads an entry's `providesServices` through the same predicate as the rest of the crypto-provider checks.
