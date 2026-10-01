---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: stored metadata bodies read through the generic data door are served as their type's read projection, so stored credentials are withheld there too; grouping those tables by the body column is refused (#21086)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of a grouping TARGET on the generic data door: a groupBy entry naming the stored body column of sys_metadata or sys_metadata_history. No authorable key, spelling, export or stored shape moves (the helpers are internal to the package; `@objectstack/metadata-protocol` exports nothing new and nothing less), and no stored row is read differently by any metadata consumer or rewritten. A whole stored body has no meaning as a group key that a ledger entry could rewrite to. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a grouping target (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what the generic data door's query accepts as a grouping target on two system tables. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

**What changes.** A row of `sys_metadata` or `sys_metadata_history` read through `GET /api/v1/data/:object`, `POST /api/v1/data/:object/query`, `GET /api/v1/data/:object/:id` (and anything that reads through the same `findData` / `getData`, such as the export route) now carries its `metadata` column as the body's type's read projection: the same object every `/meta` read exit serves, chosen through the same `@objectstack/spec/kernel` redactor registry. For a `datasource` body that means the stored credential material the datasource doors already withhold is withheld here too, decided by the same redactor. A body with nothing to withhold, and every body of a type that registers no redactor, is served as the stored bytes.

- A projection that names `metadata` without `type` (`?select=metadata`) still works: the door reads `type` to choose the redactor and does not serve it.
- A body the door cannot judge is omitted rather than served: one whose row carries no `type`, and one that does not parse while its type registers a redactor.

**What an author sees now on a grouping.** `400 INVALID_FIELD` for a `groupBy` entry naming `metadata` on either table, located at the entry (`groupBy[0]`, or `groupBy[0].field` for the object form), saying the query was not run and naming the route: group by `type`, `name` or another scalar column, and read the bodies with a plain list. A group key stands for every row that shares it, and the redactor is chosen per row, so the key cannot be projected without changing which rows it counts.

**Unchanged.** Every other object, including one with a column of its own named `metadata`; every other grouping on these tables; and every internal reader of `sys_metadata`, which reads through the engine rather than through this door and keeps reading the stored body.
