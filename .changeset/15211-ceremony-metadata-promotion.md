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
- **Conflicts are listed and block the step.** A key that two organizations hold, or an organization and the environment, is a conflict. The plan lists it (`metadataConflicts`, with every row id), and the apply blocks on it. The ceremony deletes none of those rows. Keep one row, remove the others, then re-run.
- **Under a wall, the rows are reported, not promoted.** One organization's customization is not every organization's, so those rows keep the column from being dropped.

`GET /forms/:slug` and `POST /forms/:slug/submit` no longer read the Default Organization's legacy layer. Every metadata read is now environment → code. The doors judge each candidate against the environment's view list, which holds one item per package of a view name. So a withdrawal in one package still closes that name's form in every package. On a deployment with no organization this closes more than before, which is the fail-closed direction.

The protocol's `getMetaItems` drops its undocumented `legacyFormOrganizationId` request key. It was never in the spec's `GetMetaItemsRequest`, and only those doors passed it. A caller that still passes it now gets the environment's list.

Until the ceremony runs, a database whose withdrawals were saved only at the organization layer serves those forms open again. Run the ceremony as part of the v18 upgrade:

```bash
os migrate organization-ownership --out plan.json   # review plan.json: metadataConflicts lists every conflict
os migrate organization-ownership --apply --backup-taken
```
