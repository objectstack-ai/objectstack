---
'@objectstack/metadata-protocol': patch
'@objectstack/cli': patch
---

fix(metadata-protocol): `os migrate packageless-overlays` also moves a view, dashboard, report, translation or email template row bound to the read-only package itself into its `.custom` pair

Clause-②: no

Metadata-protocol: none

Before the write naming a read-only code package itself (`?package=<base>`) was closed, such a save stored the customization as a row bound to that package, declaring nothing, served at the package's address in place of its own document. The ceremony's census read rows bound to no package only, so it never listed such a row, and its one exit was a delete, which drops the customization. The census now lists, beside the package-less rows, every row of the five overlay types bound to a read-only package that ships the name (`boundToBase` in `--json`, "bound to PACKAGE" in the listing), classified the same way with that package as its base. `--apply` moves it into the pair exactly as it moves a package-less row: the declared override with `basedOn` (or, for an email template locale the package does not ship, the pair's own member), read back, and only then the bound row deleted. The outcomes are the same `moved` ones.

A row bound to a writable package (the pair included), or to a read-only package that does not ship the name, is not listed. When one item has both a package-less row and a row bound to the package, the package-less row moves and the bound one is kept and reported failed, never merged over it; the next preview lists it `shadowed`, with that disposition's ways out.
