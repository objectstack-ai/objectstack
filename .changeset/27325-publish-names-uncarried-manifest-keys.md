---
'@objectstack/cli': patch
---

fix(cli): `os package publish` names the `objectstack.manifest.json` keys it does not send (`tags`, `publisher`, `isStarter`, `preview`, `visibility`) instead of dropping them silently

Clause-②: no
Metadata-protocol: none

The listing file's schema accepts these keys, but publish never carried them to the control plane, so an author's tags, starter flag or preview simply never reached the catalog and nothing said why. Publish now prints a warning naming each declared catalog key: it is declared but not yet carried by the hosted catalog, with a link to the issue tracking that (#27348). A declared `visibility` gets its own warning pointing at `--visibility`, which does carry it. The publish still succeeds: the bundled blank template ships `isStarter: true`. A test classifies every key of the listing-file schema as sent, warned about, or scaffold-only, so a key the schema gains later fails until publish handles it.
