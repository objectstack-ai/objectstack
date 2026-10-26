---
'@objectstack/spec': patch
---

docs(spec): three comments describe the shared-chunk bundle layout, not the per-entry one

Clause-②: no
Metadata-protocol: none

The module doc block in `@objectstack/spec`'s root entry, the `@__PURE__` note on the conversions table, and the Package API assembled-entry doc block (the generated reference page of the same name) still said each entry is a self-contained, single-file bundle. The build is one module graph: a module two entries reach ships once, in a shared chunk, and an entry links every chunk its graph touches. The sentences now say that. The doc text rides in the shipped declaration files, which is why this is a patch entry; no export, key, value or behaviour changes.

What to do: nothing.
