---
'@objectstack/spec': patch
---

feat(spec): the flow clone answer declares an optional `noticeCode` beside its English `notice`

Clause-②: yes (widening)
Metadata-protocol: none

`CloneFlowResponseSchema` (the answer of `POST /api/v1/automation/:name/clone`, "New similar") declared `data: { flow, packageId, notice }`, and `notice` is the server's English sentence with nothing that names it, so a console could only print it verbatim. `data` now also declares `noticeCode?: string`: a stable code naming the `notice` sentence. A client maps a code it knows to its own translated sentence and falls back to `notice` verbatim for a code it does not know, or when the key is absent.

- **Optional.** An answer without `noticeCode` (every server before the one that sends it) still parses; `notice` is still required and keeps its meaning as the English fallback.
- **The values are the server's.** The schema does not enumerate them; the server that serves the clone door owns the vocabulary.
- **Not metadata.** This is a REST answer shape, not something a metadata author writes, so the metadata protocol does not move. `@objectstack/client`'s `automation.clone()` returns `CloneFlowResponse['data']`, so its return type gains the optional key with no change to the client package.
