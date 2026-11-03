---
'@objectstack/core': patch
---

fix(core): `os test --url http://host:PORT/` addresses the same endpoints as the URL without the slash, and a failed `api_call` names the URL it addressed (#28946)

Clause-②: no
Metadata-protocol: none

`HttpTestAdapter` now strips trailing slashes from its base URL once, in its constructor, so every URL it builds (the discovery probe, the record collection URLs, an `api_call` relative target and the provenance clauses that name them) reads the same base. Before, each builder appended a path starting with `/` to the base as given, so a `--url` copied with its trailing slash addressed `//api/v1/...` and a stock server answered every HTTP scenario `404 ENDPOINT_NOT_FOUND`. A base with a path prefix (`http://host/prefix/`) and repeated slashes are normalised the same way. Nothing else about `--url` is validated, so a malformed value behaves as it did.

An `api_call` step that fails 404 or 405 now appends ` — api_call addressed METHOD URL` to its `HTTP Error STATUS: BODY` sentence, as record actions already append the mount they addressed. Other statuses stay undecorated, so the server's own message stands alone.
