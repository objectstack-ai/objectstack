---
'@objectstack/cli': minor
---

feat(cli): the organization-ownership ceremony carries the `sys_metadata` organization layer into the environment (ADR-0131 D10)

Clause-②: yes (widening)

The plan of `os migrate organization-ownership` gains a key, `metadataConflicts` on the `sys_metadata` table. It lists every overlay key that more than one row would hold once the organization leaves the key, with each row's id. `--apply` gains a flag, `--metadata-choice ROW_ID`. Nothing is removed from the plan or the apply.

`--apply` gains a step, `metadata-promotion`, after the authored catalog conversion:

- **Form withdrawals are carried first, under every posture, and fail-closed.** When an organization withdrew a public form (`sharing.enabled` or `sharing.allowAnonymous` set to `false`, link kept), every view the environment serves under that name that still serves the form open takes the withdrawal. That covers stored views and views served from code, in every package. The ceremony saves it through the metadata door, into the view's own package, and any organization's withdrawal wins.
- **Under `single`, an organization customization whose key no other row holds becomes the environment's, in place.** This covers the `sys_metadata` rows of `view`, `dashboard`, `report`, `translation` and `email_template`; the key is type, name, package and bundle member. The row takes its history with it.
- **A key held by more than one row is a conflict, listed in the plan.** Under `single` it blocks the step until the operator chooses one row with `--metadata-choice ROW_ID`, once per conflict.
  - The key ends with exactly one environment row. Where the key has an environment row, that row takes the chosen body through the metadata door, in place. Where it has none, the chosen organization row is promoted in place.
  - Any public-form withdrawal another row of the key holds is kept on that body.
  - The environment row is read back. Only then are the key's organization rows deleted, in one statement, by id.
  - A rerun after an interruption accepts the same `--metadata-choice` and finishes.
- **Under a wall (`isolated`, `group`), nothing is promoted unless the operator names the row, and nothing is ever deleted.** A named row becomes the environment's as above. The other organization rows stay where they are, reported, and they keep the column from being dropped.

`event_seq` and every `(type, name, version)` of `sys_metadata_history` become unique environment-wide. The metadata door numbers a save from history in its own scope, so each lineage is placed where no environment save can land on it:

- **A promoted row takes its history with it.** Before the row leaves its organization, that organization's lineage of the item is moved above the environment's numbers and becomes environment history. Every later environment save of the item numbers above it, and the row's version still names its own snapshot.
- **A new step, `history-renumber`, runs just before `column-drops`, on every apply, even after a checkpoint.** It lays out every lineage still tagged to an organization above the environment's: each organization's event range by one offset, its commit ranges with it, and each item's version lineage, the organization's rows with it.
  - Under `single`, that history then becomes the environment's too.
  - Under a wall it stays its organization's.

Order within an organization, and the version a rollback resolves, are unchanged. Nothing in history is deleted.

On a 17.x database `sys_metadata` has no `bundle_member` column. The ceremony boots with schema changes held, so it reads that column as absent, the overlay key's NULL member, and plans the table rather than refusing it.

```bash
os migrate organization-ownership --out plan.json   # review plan.json: metadataConflicts lists every conflict
os migrate organization-ownership --apply --backup-taken --plan-file plan.json --metadata-choice ROW_ID   # one per listed conflict
```
