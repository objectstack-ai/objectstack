---
"@objectstack/plugin-approvals": patch
"@objectstack/plugin-security": patch
---

fix: the approval request actions' success toasts name the request, and Explain access names the principal as a person

Clause-②: no

Server-authored strings that the console renders verbatim now name what and who they are about.

- `@objectstack/plugin-approvals`: every action on `sys_approval_request` had a bare-verb `successMessage` (`Approved.`, `Rejected.`, `Reassigned.` and so on). Each now names the request through `${result.request.record_title}`. Each action's route answers `{ request, … }` with the read-back request and its display enrichment, so `record_title` is the title the inbox shows: the target record's display field, else its payload snapshot. The new copies:
  - Approve and Reject use the inbox row's inline wording: `Approved "TITLE"` and `Rejected "TITLE"`.
  - The others read `Reassigned "TITLE"`, `Sent "TITLE" back for revision`, `Information requested on "TITLE"`, `Reminder sent for "TITLE"`, `Recalled "TITLE"`, `Resubmitted "TITLE"` and `Reply posted on "TITLE"`.

  The zh-CN, ja-JP and es-ES values of the same keys carry the same token. No key, route or response shape changes.
- `@objectstack/plugin-security`: the explain engine's principal layer said `Principal USER_ID holds position(s) …`. It now names the person first and the id second, for example `Principal Ada Lovelace (ada@example.com; id usr_1) holds position(s) …`. Three other users in the same layer are named the same way:
  - an on-behalf-of delegator;
  - the user an ADR-0091 D3 delegated position came from, in the clause;
  - that same user in the position's contributor attribution (`delegation from …`).

  Each user row is read with the asker's own context, so row-level and field-level security apply. An asker whose read returns no row gets the bare id, as before, and a field its read masks is left out. As a result, two askers can now be shown different names for the same user. The decision's `principal` object and every verdict are unchanged.
