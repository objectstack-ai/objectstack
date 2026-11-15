---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
'@objectstack/client': patch
'@object-ui/app-shell': patch
---

feat(metadata-protocol, spec): a package publish whose runtime registry refused an object answers `published_unregistered` and names the object, instead of `published`

Clause-②: yes (widening) — `PublishPackageDraftsResponseSchema.outcome` gains the value `published_unregistered`, and the response gains the optional member `unregistered[]`. Every other answer is byte-identical: a publish the registry takes whole still answers `published` with `success: true` and no `unregistered` key.
Metadata-protocol: semantic

The authorable-surface shard gains `api/PublishPackageDraftsResponse:unregistered`, and the same server event answers `outcome` / `success` differently; ADR-0087 entry `18.publish-drafts-outcome-published-unregistered`.

**What answers differently.** `POST /api/v1/packages/:id/publish-drafts` (and the protocol's `publishPackageDrafts`, and `client.packages.publishDrafts()`) used to answer `outcome: 'published'` and `success: true` when the runtime registry refused one of the objects it had just made live. The object carried the `object-registry-refused` warning on its `published[]` element, but a caller that read `success` or `outcome` saw a clean publish, and a seed load or data read right after it answered `OBJECT_NOT_FOUND`. The same publish now answers:

- `outcome: 'published_unregistered'` and `success: false` (`success` is still exactly `outcome === 'published'`);
- `unregistered: [{ type: 'object', name, rule: 'object-registry-refused' }]`, one entry per refused object, in publish order;
- everything else as before: the drafts landed and stay live, so every object is still in `published[]` (the refused one still carries its warning), `failed[]` is empty, and the commit, seeds, probes and receipts are as they were.

**What to do.** Handle the new value wherever you branch on the batch publish answer. Do not treat it as "nothing landed": the metadata is live. Do not seed or read an object `unregistered[]` names until it is registered: publish it again, which re-runs the registration, or restart, which registers every stored object.

**The console.** Studio's publish, the package sheet, Home's *Publish all* and the AI chat card read `published_unregistered` as they read the `published` answer the server gave for this before: the refused object's warning reaches the author through the client, and none of them reports the publish as failed.

**Unchanged on purpose.** The REST door's app visibility flip (ADR-0045 §3) still runs after this outcome, as it ran after the `published` answer this used to be. The single-item doors (`publishMetaItem`, a publish-mode save) still answer success with the warning on their `advisories`.
