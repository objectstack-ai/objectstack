---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals)!: a request with no submitter is recalled, reminded or resubmitted only by the system or the override actor

Clause-②: no (narrowing) — `recall`, `remind` and `resubmit` on a request whose `submitter_id` is empty (a run whose trigger resolved no user) refuse every caller except a system context and the override actor, where each door admits them; they admitted every caller who could read the request before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the three submitter doors apply their existing submitter rule to a request that has no submitter. The refusal is each door's existing non-submitter refusal, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at three approval doors (`@objectstack/plugin-approvals`), served by `POST /approvals/requests/:id/recall`, `/remind` and `/resubmit` and the request page's actions that forward to them.

- **Before (FROM).** On a request with no submitter, `recall`, `remind` and `resubmit` admitted any caller who could read the request: a pending approver, a past actor, or a reader at the opt-in record-reader level.
- **Now (TO).** On such a request, `recall` admits a system context and the override actor on a `pending` request; `remind` and `resubmit` admit a system context. Every other caller gets the door's existing non-submitter refusal: `403 FORBIDDEN`, with the same sentence as before.
- **Unchanged.** A request that has a submitter is judged exactly as before. Who may read a request, decide it, send it back, reassign it, ask for information or comment on it is unchanged.

**The remedy.** None for a person. A job that has to recall, remind or resubmit a request nobody submitted does it through a system context. An administrator recalls a stuck pending one through the override.
