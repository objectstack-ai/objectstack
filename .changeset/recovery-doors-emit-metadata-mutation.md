---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): the three recovery doors announce their writes on the mutation choke point (#14179)

`emitMetadataMutation` documents itself as "the ONE choke point every authoring
surface funnels through", and since #13331 it is also the `metadata.mutated`
cluster publish point. Three live write paths never reached it:

- **`rollbackMetaItem`** — ran the registry write-through ("a rollback is a live
  write like any other") and announced nothing. A rolled-back `hook` row left the
  OLD hook bound in every boot-cached consumer until restart, while the registry
  and the stored row already served the restored body.
- **`revertCommit`** — same miss on both limbs: the per-item restore
  (write-through) and the per-item soft-remove (`repo.delete` + registry heal).
- **`deleteMetaItem`'s legacy raw-engine exit** — the `else` side of
  `useRepoPath`, which really deletes the row, may drop the physical storage and
  heals the registry view locally. Its repository-path twin has emitted since
  #2588.

Each door now emits after its write, with the same org scope the write received
and the same singular type key the registry was written under: `state: 'active'`
for a restore, `state: 'deleted'` for a removal — mirroring the emitting siblings
rather than inventing an event shape. That single seam repairs both halves at
once: local `onMetadataMutation` consumers (the authored hook/action re-bind)
re-sync after a recovery write, and the #13331 publisher fans the same signal out
so peer replicas converge instead of serving the rolled-back-FROM body until an
unrelated mutation or a restart.

Deliberately unchanged, and pinned: the row-absent exits stay silent (nothing
mutated, so no peer is woken to converge on a no-op), and the cluster RECEIVE
path (`applyRemoteMetadataMutation`) still replays locally only — emitting there
would re-broadcast every received event and ping-pong across replicas.

Reachability of the legacy delete exit, recorded as NOT MEASURED when the door
was found, is now measured: on a normal boot (`environmentId` defined) the
two-tier delete authorization refuses every type that would reach it
(`NOT_OVERRIDABLE` or `NOT_CREATABLE`, both 403), so that door's exposure is
control-plane bootstrap mode — narrower than feared, and exactly the topology
whose registry every organization shares.
