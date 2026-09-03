---
'@objectstack/metadata-protocol': patch
---

Fix: a peer replica's `meta-overlay-cache` no longer re-serves a datasource (or
any overlay row) a cluster peer just deleted

`applyRemoteMetadataMutation` — the receipt side of the `metadata.mutated`
cluster channel (#13331) — converged a peer replica's in-memory registry
correctly, but performed no local engine write of its own, so the peer's
`meta-overlay-cache` write-epoch never moved and its pre-mutation row set
stayed "fresh" for the rest of its TTL (default 30s,
`OS_METADATA_OVERLAY_CACHE_TTL_MS`). A single `GET /api/v1/meta/:type` read of
that replica's own door, landing inside that residue window, then ran
`hydrateOverlayIntoRegistry` over the stale rows and wrote the just-deleted
entry straight back into the registry the bridge had just healed — and the
registry itself carries no TTL, so that one read converted a bounded ~30s
residue into an unbounded one for the rest of the process's life.

`applyRemoteMetadataMutation` now retires this replica's overlay-cache entries
at the moment of convergence — after the registry-convergence branch and
before `notifyMutationListenersLocal` (the #5109 invalidate-before-notify
rule) — via a new structural helper, `bumpWriteEpoch`, declared beside the
existing `readWriteEpoch` in `meta-overlay-cache.ts`. This package must not
import `@objectstack/objectql`, so the bump is spelled the same
feature-detected way `readWriteEpoch` already is, never as a direct import of
the epoch type. The metadata cluster channel now gets the same write-epoch
bump the authorization cluster channel already had
(`authz-invalidation-bridge.ts`'s `epoch.bump('remote')`, on the identical
substrate) — closing an asymmetry between the two, not adding a new mechanism.

No public API changes: `bumpWriteEpoch` is package-internal (not re-exported
from `src/index.ts`, matching `meta-overlay-cache.ts`'s existing
`metaOverlayCacheEntryCount`), and its one caller is the existing
`applyRemoteMetadataMutation` receipt path.
