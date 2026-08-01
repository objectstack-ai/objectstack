---
'@objectstack/client': patch
---

docs(client): drop the retired `validateOnly` batch option from the README (#4052)

The Batch Options section still documented `validateOnly` as a working dry-run —
"validate records without persisting changes" — but the key was retired in #4052
precisely because nothing ever read it. Every batch surface (`updateManyData` /
`deleteManyData` / `batchData`) persisted regardless, so a caller who sent it to
preview a mutation got that mutation **executed**.

`BatchOptionsSchema` has carried a `retiredKey(...)` tombstone since #4052, so the
schema already refuses the key loudly. The README was the last place still
promising it — declared-but-not-enforced in prose rather than in code, aimed at
exactly the readers who cannot see the tombstone.

Released as a patch rather than declared release-nothing because `README.md` is in
this package's `files`: the corrected text only reaches the people who hit the
problem — readers on npmjs.com — if the package ships.

Replaced with a pointer to `docs/protocol-upgrade-guide.md`
(`batch-options-validate-only-retired`). No behaviour change; there is no batch
dry-run today. Write-path validate-only was evaluated in #4372 and closed as not
planned — no current consumer justifies the surface.
