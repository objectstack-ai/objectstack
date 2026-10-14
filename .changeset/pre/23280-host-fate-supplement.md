---
'@objectstack/cli': minor
'@objectstack/spec': minor
---

feat(cli,spec): `os migrate organization-ownership --fate-supplement FILE`. A host declares the ADR-0131 D10 fates of the objects it provides, and the ceremony plans and applies them as it does the platform's own rows

Clause-②: yes (widening)

The v18 organization-ownership ceremony refuses any platform-prefixed table that carries `organization_id` when its inventory gives that table no fate. That is right for the platform's own objects, but a host's objects have no row in the inventory, so every database a host runs was refused. The host now declares those fates itself, in one JSON file, and passes the file to the command. **Adoption: a host passes its supplement through the flag; with no flag, the ceremony behaves as before.**

- **The file is declared in the spec.** `OrganizationOwnershipSupplementSchema` (`@objectstack/spec/system`) is a JSON array of `OrganizationOwnershipSupplementEntrySchema` rows. Each row gives `object`, `fate` (`column-drop`, `mirror-deletion`, `attribution` or `report`), `citation`, and only the fields its fate reads: `anchors` (required for `attribution`), `mirror`, `departures`, `categories`, `notNullExempt` and `note`. Every shape refuses an unknown key, and a key written on the wrong fate is refused rather than ignored.
- **Both modes read it.** The plan plans each row on the same terms as a platform row, and `--apply` performs it the same way. A row whose table is not on the database being planned is listed `absent`, so one supplement serves both a control-plane database and a tenant database.
- **It is refused, never half-read.** The command refuses a missing file, a file that is not JSON, a row the schema refuses, two rows for one object, or a row naming an object the platform inventory already gives a fate. The refusal comes before the database is opened, inside the `--json` envelope (`plan_refused` / `apply_refused`), and names the file, the row index and the object. A row naming one of the cloud-provided objects that the inventory lists with no fate (`cloudCarried`) replaces that placeholder row.
- **Nothing is read without the flag:** no environment variable and no conventional path. A host table with no declared fate is still refused by name, and the refusal now names `--fate-supplement FILE` as the remedy.
- The supplement's rows are part of the plan's `inventoryDigest`, so the apply's checkpoint is keyed on the supplement as well.

```bash
os migrate organization-ownership --fate-supplement host-fates.json --out plan.json
os migrate organization-ownership --fate-supplement host-fates.json --apply --backup-taken
```
