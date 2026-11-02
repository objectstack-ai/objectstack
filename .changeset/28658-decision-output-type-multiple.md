---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals)!: an approval decision whose typed output does not match its declaration is refused before anything is recorded — a picker value that resolves to no user, department, team or held position, a single value where `multiple: true` declares a list, a list where it does not, or a list naming one entry twice

Clause-②: no (narrowing) — the approve and reject doors refuse a decision output of `type` `user`, `department`, `team` or `position` that does not match its declaration's `type` and `multiple`, which they admitted before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the already-declared `type` and `multiple` of a decision output are now enforced at the decision. The refusal is a VALIDATION_FAILED naming the output, answered to the approver at the decision, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the approvals decision (`@objectstack/plugin-approvals`), served by `POST /api/v1/approvals/requests/:id/approve` and `/reject` and every door that forwards to them.

- **Before.** A typed decision output was checked for presence only (`required`). A `type: 'user'` output naming an id no account carries was recorded as an approval; a stage-2 `expression` approver reading it then resolved nobody, and with `onEmptyApprovers: 'fail'` the run stranded behind a `500 RESUME_FAILED` while the request read `approved`. A bare string was stored for a `multiple: true` output, and a list could name one person twice.
- **Now.** Each admitted output is judged against its declaration before any write, on an approve and on a reject alike. `400 VALIDATION_FAILED` names every `outputs.KEY` that does not match; no action row and no output snapshot are written, and the request stays pending for the approver to decide again.
  - `multiple: true` takes a list and only a list, with no entry twice; `multiple` absent or false takes one value. Each value is text.
  - `user`: a record id an account carries (a slot address such as `position:NAME`, or an email, is not one).
  - `department`: an active department of the request's organization.
  - `team`: a team that exists and is not another organization's.
  - `position`: a position machine name someone in the request's organization holds. A `sys_position` record id is refused: the `expression` approver matches holders by name, so an id would route to nobody.
- **Unchanged.** `text` outputs (the default, and every bare-key declaration) accept any value, as before. A blank value is judged only by `required`. A directory read that fails proves nothing and does not refuse the decision.
- **Who sees it.** A caller or decision UI that sent a picker output its declaration does not describe: a wrong id, a scalar for a list or a list for a scalar.

**The remedy.** Send each typed output in the shape its step declares, with values that name a real record (or, for `position`, a held machine name).
