---
'@objectstack/objectql': major
---

feat(objectql)!: a cold boot refuses a package-held position or permission-set name the environment catalog already holds, as a hot install does

Clause-②: no

<!-- adr-0087: not-required (no-migration-prescription) the refusal removes no key, export or field and changes the shape of no stored body; what an operator does about a refused name is rename or remove one of the two items, which no conversion can choose for them -->

**BREAKING** — an accept-set narrowing at boot, shipped as `major` on the v18 pre-release line (`.changeset/pre.json` is in `next` pre mode on `main`). A deployment whose environment catalog holds a position or permission-set name that a configured package also declares booted before this release and is refused at boot after it.

**Why.** Positions, permission sets and capabilities hold one name per deployment, and a package registering a name the environment catalog already holds was already refused on a hot install. A cold boot did not refuse it: every package registers in the kernel's first phase, before the environment catalog loads from `sys_metadata` in the engine plugin's `start()`, so the package door could not see the environment's name. The stored row loaded over the package's definition, the registry printed a `[Registry] Collision` warning, and the by-name read served the environment's definition in place of the package's. The maintainer ruled that the cold boot refuses too, so that a cold boot, a hot install and an artifact boot answer alike (ADR-0048 addendum N.3).

**What is refused, and where.** Right after `sys_metadata` hydration in `ObjectQLPlugin.start()`, before any plugin that depends on the engine starts, the engine checks every package-held position and permission-set name against the environment catalog's items. One such name fails the boot. Every conflict is listed in one refusal. The check reads the two types an environment can author: the runtime metadata API refuses to create a capability (`403`, a code-only type), so the environment catalog holds none. The hydration write itself is still not judged.

**What an operator sees.** The kernel reports `Plugin com.objectstack.engine.objectql failed to start`, and the cause is the package door's envelope: `code: 'NAMESPACE_CONFLICT'` (`NAMESPACE_CONFLICT_CODE` is exported), `status: 422`, and `conflicts[]` with `{ catalogType, name, incomingPackageId, existingHolder: { kind: 'environment' } }`. The message names the package that declares each name and the environment catalog that holds it.

**The upgrade shape.** A deployment fails to boot after this release when an active, environment-wide `sys_metadata` row of type `permission` or `position` has the name of a permission set or position that a configured package declares. That includes a row saved over a package-held name before the packaged locks refused such saves, whether or not the row was bound to the package, and a row over one of the platform security plugin's own permission sets (`member_default`, `admin_full_access` and the rest it declares).

**The one-line fix: rename the item in the package, or rename or delete the environment's item, then restart.** To reach the environment's item through the metadata API, boot once without the package in the configuration, rename or delete the item (`DELETE /api/v1/meta/permission/<name>`, `DELETE /api/v1/meta/position/<name>`), and add the package back. For a name the platform security plugin declares, delete the environment-wide `sys_metadata` row of that type and name in the database. Nothing renames or removes either item automatically.

**What is NOT refused.** A stored definition under a built-in position name (`org_admin`, `everyone` and the other four): the platform declares its built-in positions itself, after this check, and the stored definition keeps answering first. The same package restarting with its own names. A package whose names the environment catalog does not hold, booting beside the environment's own items.
