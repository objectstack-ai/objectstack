---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals)!: an approval decision whose output does not match its declaration is refused before anything is recorded — a single value where `multiple: true` declares a list, a list where it does not (a bare-key or `text` output included), a list naming one entry twice, or a picker value that resolves to no user, department, team or held position

Clause-②: no (narrowing) — the approve and reject doors refuse a decision output whose shape does not match its declaration's `multiple` (every output, `text` and bare keys included), or whose `user`, `department`, `team` or `position` value does not resolve, which they admitted before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the already-declared `type` and `multiple` of a decision output are now enforced at the decision. The refusal is a VALIDATION_FAILED naming the output, answered to the approver at the decision, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the approvals decision (`@objectstack/plugin-approvals`), served by `POST /api/v1/approvals/requests/:id/approve` and `/reject` and every door that forwards to them.

- **Before.** A typed decision output was checked for presence only (`required`). A `type: 'user'` output naming an id no account carries was recorded as an approval; a stage-2 `expression` approver reading it then resolved nobody, and with `onEmptyApprovers: 'fail'` the run stranded behind a `500 RESUME_FAILED` while the request read `approved`. A bare string was stored for a `multiple: true` output, and a list could name one person twice. Until #29371 the spec documented that the runtime accepts any value shape for a list output, a CSV string (`'u2,u3'`) included; an API caller that sends that CSV string for a `multiple: true` output is now refused and sends a list (`['u2', 'u3']`) instead.
- **Now.** Each admitted output is judged against its declaration before any write, on an approve and on a reject alike. `400 VALIDATION_FAILED` names every `outputs.KEY` that does not match; no action row and no output snapshot are written, and the request stays pending for the approver to decide again.
  - Every output, `text` and every bare-key declaration included: `multiple: true` takes a list and only a list, with no entry twice; `multiple` absent or false takes one value. A bare key (`decisionOutputs: ['note']`) therefore takes one value, as its declaration always said; a list is what an output declared `multiple: true` collects.
  - `text` is judged on that shape only; its values are free. A picker's values are text and must resolve:
  - `user`: a record id an account carries (a slot address such as `position:NAME`, or an email, is not one).
  - `department`: an active department of the request's organization.
  - `team`: a team that exists and is not another organization's.
  - `position`: a position machine name someone in the request's organization holds. A `sys_position` record id is refused: the `expression` approver matches holders by name, so an id would route to nobody.
- **Unchanged.** A `text` value in the declared shape is accepted whatever it says. A blank value is judged only by `required`. A directory read that fails proves nothing and does not refuse the decision.
- **A request already pending.** The judge reads the declaration snapshotted on the request when it opened. A request pending under a bare-key snapshot (`decisionOutputs: ['note']`) takes one value for that key, so its approver sends one value; nothing about the pending request needs changing. That one value may be a comma-separated string (`'u2,u3'`): a bare key is `text`, judged by shape only, and a downstream `expression` approver still splits a string value into a list, so a pending request meant to route to several people is not stranded.
- **The Console.** Both decision surfaces send each output in its declared shape: a `text` or untyped output declared `multiple: true` is collected as a list of trimmed, distinct entries and sent as a string array, and a single-value one is sent as one string whose comma is literal (`@object-ui/app-shell`, same release).
- **Who sees it.** A caller or decision UI that sent an output its declaration does not describe: a wrong picker id, a scalar for a list (the CSV string included), a list for a scalar (a list sent for a bare key included), or a repeated entry. Also an author who pairs a `department`, `team` or `position` picker output with a stage-2 `expression` approver retargeted by `organization` (ADR-0105 D9): the decision resolves the picked value in the request's organization, not in the approver's directory organization, so a value that exists only in that other organization is refused at the decision.

**The remedy.** Send each output in the shape its step declares, with picker values that name a real record (or, for `position`, a held machine name). A bare key takes one value, as its declaration always said; a step that collects several values declares `multiple: true`, and the Console now sends a list for it.
