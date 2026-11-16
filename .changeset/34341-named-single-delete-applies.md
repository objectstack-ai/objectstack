---
'@objectstack/scenarios': patch
---

docs(qa/scenarios): a delete the user names, with exactly one match, is applied; the cards ask first only when the request is ambiguous

Clause-②: no
Metadata-protocol: none

The maintainer ruled on 2026-11-16 that naming one record is the confirmation. Four scenario cards change their delete expectations to match:

- `crm_account_with_contacts/remove_ben`, `invoice_with_line_items/remove_line`, `project_with_tasks/drop_packing` and `leave_balances/delete_withdrawn_request` now expect `applied`. Each states that the named row is gone and that rows in the acting persona's scope are still present. Each ask was checked against the seed: it matches exactly one row.
- Each of those cards gains one ambiguous delete as its last operation. The ask matches two or more rows, so the card expects `pending_confirmation`: `remove_tech_contact`, `remove_inv001_line`, `drop_relaunch_task` and `delete_zoes_withdrawn_request`.
- Each card's `confirm_irreversible` guardrail now names the ambiguous delete and states the ruling.

No runner, grader or schema code changes. The package's test pins that counted operations, turns or costs, or that read the named deletes as pending, move with the cards. Operation scores from the next eval round start a new baseline.
