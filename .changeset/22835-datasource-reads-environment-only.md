---
'@objectstack/service-datasource': minor
'@objectstack/metadata-core': minor
'@objectstack/objectql': patch
---

feat(service-datasource,metadata-core)!: the datasource-admin plugin reads the environment's stored `datasource` rows only; a legacy organization-scoped row is neither loaded at boot nor served (ADR-0131 D6)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered metadata-read-organization-scope-retired) That entry retires every metadata read of a row stored organization-scoped, the boot hydration included, and states that such a row is served by no read and loaded by no boot. This changeset carries the same rule to the datasource-admin plugin's own reads of sys_metadata: no key, export or stored shape is removed, renamed or re-shaped, and nothing is rewritten. -->

**BREAKING (narrowing).** Graded `minor` on the v18 prerelease line, as the read narrowing it completes.

**What changes.** `DatasourceAdminServicePlugin` reads stored `datasource` rows in five places — the boot restore (`restoreRuntimeDatasources`), the by-name read behind cluster convergence and the `/meta` door's datasource projection, and the existence probes behind its own create, update and remove. Each now reads the environment's rows only, judged by the same row-value test the metadata reads apply. A row stored organization-scoped by an earlier release:

- is no longer registered at boot, so the datasource-admin door and the metadata read door no longer serve it, and no live pool is opened from it;
- is never updated or deleted by an admin create, update or remove under its name — those write and remove an environment row of their own;
- stays at rest, and the boot report `[metadata_org_scoped_unserved]` keeps naming it. Nothing is deleted or rewritten; the v18 migration ceremony (`os migrate`, ADR-0131 D10) carries it.

**What moves for consumers.**

| From | To |
|:--|:--|
| a legacy organization-scoped runtime datasource a deployment relied on | re-create it through the datasource-admin door or save it through the `/meta` door to make it environment-wide now, or wait for the v18 migration ceremony |

`@objectstack/metadata-core` exports `isLegacyOrganizationRow`, the one row-value test for such a row; `@objectstack/objectql`'s authored hook and action binders now read it from there, with no change in what they bind.
