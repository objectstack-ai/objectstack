---
'@objectstack/runtime': minor
'@objectstack/spec': minor
---

Under a walled posture the `/packages` verbs that publish, discard, roll back, revert, duplicate or adopt security catalog items are the platform operator's

Clause-②: yes (narrowing)

<!-- adr-0087: registered walled-catalog-package-verbs-retired -->

**BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D3: "Shared-DB multi-tenant (`group` / `isolated`): tenant admins cannot create or edit catalog items; the operator defines the catalog for every tenant").

**Why.** A package's positions and permission sets are environment-wide, and every organization resolves them by name. Measured on a booted `isolated` and `group` stack: the operator published a permission set in a writable package, and another organization's member held it. An organization owner granted `manage_metadata` inside their own organization (never the platform operator) then:
- published the operator's pending draft adding `manage_users`, and that member's next resolution carried it;
- rolled the package back, and the member lost it;
- reverted the operator's commit, and the member lost it;
- copied the set, under the same name, into a package of their own, and `GET /meta` then served their copy;
- discarded the operator's pending draft (through `revert`, and `discard-drafts` is the same discard by a second door);
- adopted the environment's catalog rows into their own package.

**FROM → TO**, on a `group` or `isolated` deployment, for a caller below the platform operator (the `PLATFORM_ADMIN` rung: the deployment's declared `OS_PLATFORM_OWNER_EMAIL` owner). Every door is on the runtime dispatcher, and each **FROM** is: admitted to any `manage_metadata` holder. Each **TO** is `403 PERMISSION_DENIED`, naming the posture, before the verb runs:

- `POST /api/v1/packages/:id/publish-drafts`, when the package has a pending position, permission-set or capability draft.
- `POST /api/v1/packages/:id/revert`, when the package has such a draft.
- `POST /api/v1/packages/:id/discard-drafts`, when the package has such a draft.
- `POST /api/v1/packages/:id/rollback`, when a commit it would undo touched a position, permission set or capability.
- `POST /api/v1/packages/:id/commits/:commitId/revert`, when that commit touched one. The commit's own items are judged: the verb takes the commit id alone, so the URL's package segment changes nothing.
- `POST /api/v1/packages/:id/duplicate`, when the source package's published environment rows (the ones it copies) hold one.
- `POST /api/v1/packages/:id/adopt-orphans`, when the environment's orphaned rows include one.

**Unchanged.** A package whose drafts, commits or rows carry no catalog item is handled as before, for the same callers. The platform operator runs every verb as before. Under `single` (and with no `tenancy` service) nothing changes, and no extra read happens: the verdict is asked before the items are read.

**The remedy.** The platform operator publishes, discards, rolls back, reverts, duplicates and adopts catalog-carrying packages. `@objectstack/spec` registers the change as the ADR-0087 semantic entry `walled-catalog-package-verbs-retired`. Every door asks the one predicate the catalog's other write doors ask, `walledCatalogWriteVerdict` (`@objectstack/metadata-core`), through the same helper as the package delete.
