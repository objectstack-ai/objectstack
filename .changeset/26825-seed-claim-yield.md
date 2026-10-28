---
'@objectstack/plugin-security': patch
'@objectstack/organizations': patch
---

fix(plugin-security): the seed ownership hand-over no longer holds the event loop for seconds, so a sign-in during it is answered

Clause-②: no
Metadata-protocol: none

The seed ownership hand-over that runs when a seed settles (`app:seeded`, plugin-security's `claimSeedOwnership`) and its multi-organization twin (`claimOrgSeedOwnership` in `@objectstack/organizations`) no longer re-own a large seed in one unbroken run. On a synchronous driver (better-sqlite3, the wasm fallback) every step of a claim write resolves as a microtask, so one write over a 1,500-row seed ran its per-row hooks and audit rows for 2.6 s and a sign-in issued meanwhile waited for all of it. The claim now writes the seeded rows 50 at a time and yields the event loop after every write (the by-row path after every 50 rows); a sign-in during it answers in hundreds of milliseconds. The same rows go to the same owner with the same audit rows. If only some batches of a chunk are refused, the other batches stay claimed and one warning names the rows left unowned, which the next run claims; a chunk every batch of which is refused is reported and left unowned as before.
