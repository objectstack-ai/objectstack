---
'@objectstack/metadata-protocol': patch
'@objectstack/cli': patch
---

fix(metadata-protocol): `os migrate packageless-overlays` moves a package-less email template row of a locale the base package does not ship into the base's `.custom` pair as the pair's own member

Clause-②: no

Metadata-protocol: none

A Setup translation stored bound to no package before ADR-0146 D11, of a template the installed package ships in other locales only (a `zh-CN` row of a template shipped `en-US` only), was saved into the pair declaring `overrides`, which the override write gate refuses for a locale the base does not ship. The move failed and the row was kept. The ceremony now saves such a row into the pair with no `overrides` declaration, as the pair's own member at that locale (the base's address serves it as the pair's addition), reads it back and only then deletes the unbound row. Its subject, bodies and envelope columns move unchanged, and it keeps sending in that locale. A row of a locale the base ships moves as the declared override, as before; a declared override of a locale the base does not ship is still refused.

The preview names such a row's locale (`addedMember` in `--json`, "its own member" in the listing), and `--apply` reports it `moved` with that `addedMember` in place of a `basedOn`, since the pair's own member records none.
