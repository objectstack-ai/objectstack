---
'@objectstack/cli': patch
---

fix(cli): `os package publish` names the `objectstack.manifest.json` keys it does not send (`tags`, `publisher`, `isStarter`, `visibility`) instead of dropping them silently

Clause-②: no
Metadata-protocol: none

The listing file's schema accepts these keys (inherited from the package create request), but publish never carried them to the control plane, so an author's tags or starter flag simply never reached the catalog and nothing said why. Publish now prints one warning naming each declared key it does not send; `visibility` is pointed at `--visibility`, which does carry it. The publish still succeeds: the bundled blank template ships `isStarter: true`. A test classifies every key of the listing-file schema as sent, warned about, or scaffold-only, so a key the schema gains later fails until publish handles it.
