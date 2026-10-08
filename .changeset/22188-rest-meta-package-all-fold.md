---
"@objectstack/rest": minor
---

`metaItemPackageBinding` is exported, and every `/meta` door that reads `?package=` reads it through that function, so `?package=all` names no package on the layered read, the list, the book tree and the diagnostics sweep

Clause-②: yes (widening)

- `metaItemPackageBinding(raw)` answers the package a request's `?package=` names, or `undefined` for `all` (the metadata list's "show everything" scope), the empty value or a non-string. The item read, the save and the publish already read `?package=` through it. The runtime dispatcher's `/meta` domain now reads it through the same function.
- `GET /meta/:type/:name/layers?package=all` answered `404` for an item stored in a package, and now serves the layers that the read without `?package=` serves. The Studio editor sends this read when it is opened from the list's "show everything" scope.
- `GET /meta/:type?package=all` answered `[]`, and now lists what `GET /meta/:type` lists: the items of every package and the env-local ones.
- `GET /meta/book/:name/tree?package=all` served the empty implicit book of a package called `all`, and now resolves the declared book as the read without `?package=` does.
- `GET /meta/diagnostics?package=all` swept nothing, and now sweeps what the plain sweep sweeps.
- Unchanged: a real package id still scopes each of these reads. The item read's cache bypass still reads the raw parameter, so `?package=all` keeps the uncached read and its served `version`.
