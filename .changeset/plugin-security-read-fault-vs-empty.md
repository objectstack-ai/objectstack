---
'@objectstack/plugin-security': patch
---

Tell a read that DID NOT ANSWER apart from a read that answered NOTHING at two boot-reconciler seams, so a transient storage fault can no longer withdraw a standing org-admin grant or report an unreadable catalog as an already-canonical one (#15840).

`reconcileOrgAdminGrant`'s `sys_member` read swallowed a fault into `[]`, and `[]` is what that function reads as "this user is not an admin of this organization" — the input to a DELETE. One transient read fault therefore revoked a sitting admin's standing grant, and the store kept it withdrawn after the fault cleared; only a `debug` line separated that run from a healthy one. That read now reports at `error` and returns `{ action: 'skipped', reason: 'membership_unreadable' }`, performing no write at all for the pair: nothing is granted, so nothing widens, and nothing standing is destroyed. The next `sys_member` write and the `kernel:ready` backfill ask again.

`normalizeManagedByVocab` swallowed a catalog read fault into `[]` too, so an unreadable catalog and an already-canonical one were byte-identical on both channels — the same `{ positions: 0, permissionSets: 0 }` and zero log lines at any level — while the row that needed healing stayed legacy. A read that does not answer now reports at `error` and refuses the pass instead of attesting counts it could not read. The refusal aborts at the first un-answered read, so it is one line per refused boot rather than the four the report-and-continue shape measured. Its only production consumer already declared the handling: the `kernel:ready` bootstrap catches it, reports it at `warn` as non-fatal, and boot proceeds.

⭐ Per-site, not a sweep. A genuine EMPTY read keeps today's behaviour EXACTLY at both seams — a demotion with no membership row still revokes, a membership still grants, an already-canonical catalog still answers `{ positions: 0, permissionSets: 0 }` in silence. `claim-seed-ownership.ts` is untouched: its fault already propagates to a per-predicate handler that reports at `warn` and names the consequence, which is the right disposition already. The plugin's other reads keep their existing best-effort contract, where an unanswered read costs a grant that is not created rather than one that is destroyed.

No exported symbol, published payload key or spec path changes: `action: 'skipped'` is already in the returned union, `reason` is already free text, and the two logger option types gain an optional `error` method a caller may omit. Healthy-path behaviour is byte-identical; only the fault path moves.
