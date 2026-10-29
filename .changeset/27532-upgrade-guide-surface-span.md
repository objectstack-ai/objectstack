---
'@objectstack/spec': patch
---

fix(spec): the generated protocol upgrade guide keeps an entry's `surface` in one code span when the surface carries backticks of its own

Clause-②: no (a generator fix: no schema, accepted value, served body or error code moves; only the rendering of the guide the package ships changes)
Metadata-protocol: none

`protocol-upgrade-guide.md`, generated at publish from the ADR-0087 registries, shipped in `@objectstack/spec` and attached to the GitHub Release, wrapped every conversion's and semantic entry's `surface` in a single-backtick code span. Most semantic entries mark their own inline code inside the surface, and CommonMark closes a single-backtick span at the first backtick inside it, so those lines rendered as alternating code and prose fragments. The generator now fences each surface by CommonMark's rule, one backtick longer than the longest run inside it, so a surface renders as one span with the author's backticks shown literally; a backtick-free surface is byte-identical to before. A conversion-table cell also escapes `|`, the one character a table row reads as structure.
