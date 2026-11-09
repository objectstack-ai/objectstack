---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): an installed package's sample rows are owned by the person who seeded them

Clause-②: no
Metadata-protocol: none

A package installed through `POST /api/v1/marketplace/install-local` used to seed its sample rows with no `owner_id` and no `created_by`: the seed loader writes as the system, and the boot seed's first-admin hand-over never reaches an install's seed. Rows nobody owns are invisible to every `readScope: 'own'` grant and editable by nobody below Modify All, so even the administrator who installed the app saw them only through Modify All, and "My" views stayed empty.

Each seeding door now writes the person it has into `owner_id` and `created_by` of the rows its load created, right after the load:

- an install, and a reseed: the person who called it;
- the boot heal of emptied tables: the installer the install ledger records (`installedBy`), when that is still a user; otherwise the rows keep no owner and the log says why;
- the per-organization replay: the organization's founder, when the replay is handed one; otherwise the rows keep no owner and the log says so.

From then on a sample row is an ordinary record under the ordinary permission rules. Nothing is added for sample data: under `private` sharing a colleague who holds the package's default permission set does not see the installer's sample rows, as they would not see any other record the installer owns; share them, or reassign them, the way you would any record.

Only rows the load created are written (the loader's `insertedIds`), never a pre-existing row a seed record's key matched, and only where the field is still empty, so an owner a seed record authors (for example `owner_id: cel\`os.user.id\``) is kept. The write runs as the system with automations off, like the boot seed's own ownership hand-over: no app hook, flow, approval or notification fires for it. Platform (`sys_*`), managed and federated objects are left alone. A row the engine refuses to update keeps what the seed wrote, and the door logs a warning naming the object.

Rows seeded before this release keep no owner: a reseed leaves rows that are already there alone, so purge the sample data and reseed it to have it written again, owned by the person who reseeds. The purge's sample-row identification is unchanged.
