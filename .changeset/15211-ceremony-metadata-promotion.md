---
'@objectstack/cli': patch
'@objectstack/rest': patch
'@objectstack/metadata-protocol': patch
---

feat(cli): the organization-ownership ceremony promotes organization customizations and carries public-form withdrawals; the anonymous form doors read the environment alone (ADR-0131 D10)

Clause-②: no

`os migrate organization-ownership --apply` gains a step, `metadata-promotion`, after the authored catalog conversion:

- **Form withdrawals are carried first, fail-closed, under every posture.** When an organization withdrew a public form (`sharing.enabled` or `sharing.allowAnonymous` set to `false`, link kept), every view the environment serves under that name that still serves the form open takes the withdrawal. That covers stored views and views served from code, in every package. The ceremony saves the withdrawal through the metadata door, into the view's own package. The judgement is the anonymous doors' own predicate. Any organization's withdrawal wins.
- **Under `single`, organization customizations become environment rows.** These are the `sys_metadata` rows of `view`, `dashboard`, `report`, `translation` and `email_template`. A row whose key (type, name, package, bundle member) no other row holds is promoted in place, by clearing its `organization_id`.
- **Conflicts are listed and block the step until the operator chooses.** A key that two organizations hold, or an organization and the environment, is a conflict. The plan lists it (`metadataConflicts`, with every row id), and the apply blocks on it. Choose the row the environment keeps with `--metadata-choice ROW_ID`, once per conflict. The chosen row is promoted and read back, any public-form withdrawal an unchosen row holds is carried onto it, and only then are the unchosen rows deleted, by id. No row of a conflict is deleted before a choice is made.
- **Under a wall, nothing is promoted unless the operator names the row.** One organization's customization is not every organization's. A row named with `--metadata-choice` is promoted knowingly; the rest are reported and keep the column from being dropped.

Two more steps renumber `sys_metadata_history`, because `event_seq` and every `(type, name, version)` lineage must be unique environment-wide once the organization leaves the key. The metadata door numbers a save from history in its own scope, so each step runs where none of the ceremony's own environment saves can land on a number it gave an organization:

- **`version-renumber`** runs before the promotion. Where two lineages of one item exist, the organizations' lineages are laid out one above another and the environment's goes above them all. Each overlay row's `version` moves with its own lineage, so the version a rollback resolves is unchanged.
- **`sequence-renumber`** runs after the last environment save, just before `column-drops`. Each organization's event range is shifted above the environment's by one offset, and its commit ranges move with it, so order within an organization is unchanged. It runs on every apply, even after a checkpoint, so a save made between two runs is covered too.

Both steps write numbers only, delete nothing, and are safe to re-run after an interruption.

`GET /forms/:slug` and `POST /forms/:slug/submit` no longer read the Default Organization's legacy layer. Every metadata read is now environment → code. The doors judge each candidate against the environment's view list, which holds one item per package of a view name. So a withdrawal in one package still closes that name's form in every package. On a deployment with no organization this closes more than before, which is the fail-closed direction.

The protocol's `getMetaItems` drops its undocumented `legacyFormOrganizationId` request key. It was never in the spec's `GetMetaItemsRequest`, and only those doors passed it. A caller that still passes it now gets the environment's list.

Until the ceremony runs, a database whose withdrawals were saved only at the organization layer serves those forms open again. Run the ceremony as part of the v18 upgrade:

```bash
os migrate organization-ownership --out plan.json   # review plan.json: metadataConflicts lists every conflict
os migrate organization-ownership --apply --backup-taken --metadata-choice ROW_ID   # one per listed conflict
```
