---
'@objectstack/plugin-audit': patch
'@objectstack/objectql': patch
'@objectstack/verify': patch
'@objectstack/spec': patch
---

feat(plugin-audit): the audit log is sealed by default, and sealed rows expire by whole checkpoints under a signed expiry amendment

Clause-②: yes (widening) (LifecycleService gains a public prefix-expiry seam for sealed objects: `registerSealedExpiry` and the `LifecycleSealedExpiry` types)
Metadata-protocol: none (the `seal` key landed in P1b; this changes a platform object's declaration only)

ADR-0154 D8 and D10 (#31908, slice P4c, the last one).

- **`sys_audit_log` is sealed.** Its lifecycle declares `seal: { valueFields: ['old_value', 'new_value', 'metadata'] }`, so every deployment whose `AuditPlugin` has a crypto provider (`os serve` hands it one) signs each hour's audit rows into a per-organization checkpoint, and `os audit verify` checks them. The three value columns enter each checkpoint as salted commitments; every other column enters in clear.
- **Sealed rows leave only by whole checkpoints.** The LifecycleService no longer deletes a row of an object that declares `lifecycle.seal` by a row cutoff (`retention.maxAge`, `ttl.expireAfter`, or the archive's `keep` prune). It hands each policy to the sealed expiry the audit sealer registers (`LifecycleService.registerSealedExpiry`, `@objectstack/objectql`). Per chain, the sealer takes the consecutive checkpoints from the chain's first remaining one whose windows ended before the cutoff (aligned down to a UTC day, so once its backlog is drained a chain gains at most one expiry amendment a day), each admitted under a trusted signing key, at most 10,000 rows a sweep. It signs and stores the chain's `expiry` amendment first. The sweep then deletes exactly those rows, by id, from the hot store and the archive, and only after them the checkpoints and their seeds. A sweep stopped part way resumes under the stored amendment and signs no second one. A run a reap guard vetoes in part is not completed and is retried. The verifier reads an expired row as `expired` while its checkpoint stands, and after it is gone honours the range as before (D8).
- **No sealer, no deletion.** While no sealed expiry is registered (an `AuditPlugin` with no crypto provider, a one-shot boot), a sealed object's rows past their policy are kept, the archive copy still runs, the sweep reports `seal-expiry-pending`, and the lifecycle service says so once at `warn`. A chain whose first remaining checkpoint does not follow its last expiry (a checkpoint removed outside the platform), or whose next checkpoint does not verify under a trusted key, is not expired past that point, and the sealer says so.
- **A tenant-scoped retention override does not apply to a sealed object.** One signed policy value covers a chain, so the global window stands for every organization, and the lifecycle service says so once.
- **A fully expired chain continues.** Its next checkpoint chains onto the expiry: sequence after the expiry's last, linked to its `last_removed_digest`.
- **`os audit verify` stays loud for a chain a fault left behind** (seat ruling 6885452378, ADR-0154 D3 as amended): a window that starts at or before the newest window a trusted `window` checkpoint names is sealed, so a row there that no checkpoint holds reads `late` and unsealed, and the check fails.
- **The verify harness hands its crypto provider to `AuditPlugin`.** `bootStack` gives an `AuditPlugin` it mounts (an `extraPlugins` entry, a stack `plugins` entry, or the provider `requires: ['audit']` constructs) the same `harnessCryptoProvider()` instance that settings and the engine get, never a bare `LocalCryptoProvider`; an instance composed with its own provider keeps it.
- The `lifecycle.seal` description no longer says the retention sweeper deletes sealed rows.
