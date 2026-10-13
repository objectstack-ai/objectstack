---
"@objectstack/plugin-approvals": patch
"@objectstack/plugin-security": patch
---

fix: the approvals drawer's Approve toast names the approved request, and Explain access names the principal as a person

Clause-②: no

Two server-authored strings that the console renders verbatim now name what and who they are about.

- `@objectstack/plugin-approvals`: the `approval_approve` action's `successMessage` was the bare verb `Approved.`. It is now `Approved "${result.request.record_title}"`, the wording of the inbox row's inline Approve. The decide route already answers the read-back request with its display enrichment, so `record_title` is the title the inbox shows (the target record's display field, else its payload snapshot). The zh-CN, ja-JP and es-ES values of the same key are updated to carry the same token. No key, route or response shape changes.
- `@objectstack/plugin-security`: the explain engine's principal layer said `Principal USER_ID holds position(s) …`. It now names the person first and the id second, for example `Principal Ada Lovelace (ada@example.com; id usr_1) holds position(s) …`, and an on-behalf-of delegator is named the same way. The user row is read with the asker's own context, so row-level and field-level security apply. An asker whose read returns no row gets the bare id, as before, and a field its read masks is left out. As a result, two askers can now be shown different names for the same principal. The decision's `principal` object and every verdict are unchanged.
