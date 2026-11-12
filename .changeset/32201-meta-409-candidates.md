---
'@objectstack/runtime': patch
'@objectstack/rest': patch
'@objectstack/client': patch
---

fix(runtime, rest): the `/meta` door's `409 RESOURCE_CONFLICT` carries `details.candidates`, as `/automation` and `/actions` do (ADR-0150 D5)

Clause-②: yes (widening) — an additive `details.candidates` member on an existing refusal; no answer that succeeds changes, and the message is the one it was.
Metadata-protocol: none

When a by-name metadata read names no one item (a bare name two packages hold, `?package=` of a package that holds none of it while another does, `/meta/:type/:ns/:name` under such a namespace or a shareable namespace both owners hold, `/meta/:type/_env/:name` for a name only packages hold), the `409 RESOURCE_CONFLICT` now lists every holder as `details.candidates`: the `PackageScopedHolder` list (`{ kind: 'package', packageId }`, `{ kind: 'environment' }`, `{ kind: 'platform' }`) the `/automation` and `/actions` doors already answer. Both transports answer it: the runtime dispatcher's `/meta` domain in its nested envelope (`error.details.candidates`), and `RestServer` beside its flat body's `error` and `code` (`details.candidates`). Before, the holders were named in the message only.

`client.meta.getItem` rejects with them on `err.details.candidates`, so a console or an integration can retry with the holder it means instead of parsing the sentence. The holders are the ones the message already named; a caller the type-level read admission refuses is still answered `403` before any address is read.
