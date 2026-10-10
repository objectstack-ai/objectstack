---
'@objectstack/plugin-security': patch
---

`security/explain` answers a transfer of a row the caller cannot read the way the transfer door does: as a record that does not exist.

- **What was wrong.** On the write doors, a row the caller cannot read answers what a nonexistent id answers: the by-id update or delete the caller addresses gets `404 RECORD_NOT_FOUND`. A transfer's door is the `PATCH` that writes `owner_id`, an update, so a transfer of an unreadable row gets that 404 too. explain's matching rewrite (the missing-record shape, `record: { visible: false }` with no `decidedBy`) keyed on the verb as asked, `update` or `delete`, so it never ran for `transfer`. Where the caller's update policy admitted the hidden row, explain answered `visible: true`, decided by `rls`. Where the caller declared no write policy, it answered `visible: false` decided by `rls`, which is the shape of a 403 refusal, not of the door's 404.
- **What it does now.** The rewrite asks which operation the verb's door is through the same mapping the by-id write path reads (`transfer` and `restore` as update, `purge` as delete). So every write verb whose door is a by-id update or delete is asked the read question, and a transfer of a row the caller cannot read is `{ visible: false }` with no decider, beside the door's 404.
- **What is unchanged.** `update` and `delete` are answered exactly as before. `restore` and `purge` are still refused at the object gate for every principal, which answers first. A readable row keeps its verdict for every verb. The object-level `allowed` answers the object question and is not touched. No door changes, and no export is added to the package.
