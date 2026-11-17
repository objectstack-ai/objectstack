---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): a host checkpoint signer, sink or cluster service that is registered but fails to resolve stops the sealer instead of falling back

Clause-②: no
Metadata-protocol: none

The audit sealer (ADR-0154) resolves three host seams on each pass: `audit.checkpointSigner`, `audit.checkpointSink` and `cluster`. It turned every resolution error into "not registered". A host signer whose factory threw (a KMS client that cannot start, a missing credential) was therefore replaced by the local signing key, a failing sink dropped the off-host export, and a failing cluster service let the pass run on the in-process lock. Nothing was logged. A seam registered as a factory was never built at all, because the sealer used the synchronous accessor, so a factory-registered host signer was silently ignored.

Now only an absent seam falls back: no host signer signs with the local key, no sink exports nothing, no cluster service takes the in-process lock, all as before. A seam that is registered and resolves is used, including one registered as a factory. A seam that is registered and fails to resolve stops the pass: no checkpoint is signed, and the sealer reports it at `error`, naming the slot, once while it lasts. Each pass retries.

A host whose signer, sink or cluster registration was failing used to seal silently with the local key or without its lock; it now seals nothing until the registration is fixed. A working host sees no change.
