---
"@objectstack/rest": patch
---

fix(rest): dataset queries stop rejecting their own read-time annotation

Every widget on every dataset-bound dashboard failed with

```
Dataset query failed: 400 Bad Request — Invalid dataset definition.
```

The dataset itself was fine. `POST /analytics/dataset/query` resolves a saved
`datasetName` through `getMetaItems`, and the metadata READ path stamps the
spec-validation verdict `_diagnostics` onto every document it serves. Since
#4001 closed the metadata schemas, `DatasetSchema.parse()` rejects unrecognized
keys instead of dropping them — so the route handed a served document back to
the very schema that produced it and got `unrecognized_keys: ["_diagnostics"]`
for its trouble. The 400 blamed the author for a key the server had just added.

This is the failure mode `stripReadDecorations` exists to prevent, and the one
`spec/kernel/metadata-read-decorations.ts` already documents from the cold-boot
flow bind (cloud#971): *a served body is not a valid input to the schema that
produced it.* The route now strips read decorations before validating.

Stripped on **both** branches, not only the `datasetName` read: the Studio
dataset preview posts its draft inline, and that draft is the document the
designer GET-loaded — decorations and all. A hand-authored draft never carries
these keys, so the strip is a no-op there. The ADR-0010 provenance envelope
(`_packageId`, `_provenance`, `_lock`, …) is deliberately *not* a read
decoration and still survives the round-trip.

Regression coverage for the saved-dataset path was the gap that let this ship —
every existing case passed the dataset inline, so nothing exercised the read.
The route's tests now cover resolve-by-name, the inline decorated draft, the
404, and a genuinely malformed saved dataset (still a 400).
