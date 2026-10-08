---
'@objectstack/objectql': minor
---

feat(objectql)!: positions, permission sets and capabilities hold one name per deployment — a package registering a name that an installed package, the environment catalog or a built-in already holds is refused, naming both holders

Clause-②: no

<!-- adr-0087: not-required (no-migration-prescription) the refusal removes no key, export or field and changes the shape of no stored body; what an author does about a refused name is pick a different one, which no conversion can choose for them -->

**BREAKING** — an accept-set narrowing at the package registration door, shipped as `minor` under the launch-window convention for accept-set narrowings (Changesets pre mode is not yet in on `main`). A deployment whose packages share a position, permission set or capability name booted before this release and is refused at boot after it.

**Why.** An assignment names a position or a permission set by its bare name, with no package to tell two definitions apart (ADR-0131 D4). Before this release two installed packages could ship one name, and which definition granted depended on registration order. Measured on a booted kernel with two packages sharing one name per type: the by-name catalog read resolved the permission set and the capability to the first-registered package, and the position to the last-registered one. An app declaring the platform's own `admin_full_access` registered beside it, and the by-name read answered the app's set. The maintainer ruled the security catalog out of ADR-0048 §3.4's cross-package coexistence: each of the three types holds one namespace per deployment. Every other metadata type keeps §3.4's coexistence unchanged.

**What is refused, and where.** `SchemaRegistry.installPackage` refuses a package whose declared `positions`, `permissions` (permission sets) or `capabilities` — top level, or on a nested `plugins[]` entry — name something another holder already holds. It refuses ahead of every mutation, so a refused package leaves no record behind. The holders are:

- another installed package;
- the environment catalog: an item authored in this environment, in the registry's bare slot with no package;
- a built-in: the six built-in positions (`platform_admin`, `org_owner`, `org_admin`, `org_member`, `everyone`, `guest`) and the curated platform capabilities (`manage_users`, `setup.access`, `studio.access` and the rest of `PLATFORM_CAPABILITIES`).

The platform's own permission sets (`admin_full_access`, `member_default`, …) are declared by `@objectstack/plugin-security` on its manifest, so they are held by that package like any other package's. `registerItem` with a package id refuses the same second holder for a registration that reaches the registry directly. Every package registration reaches this door first: `AppPlugin.init` at boot (each package of a multi-package artifact included), a hot install through `install-local`, and a post-start `manifest.register`. On an artifact boot the refusal fires in Phase 1, before the artifact door registers anything. `install-local`'s offline (inline-manifest) import answers `422` under that route's own `PLUGIN_REGISTER_FAILED` code, with this refusal's message in `error.message`, and records nothing. `POST /api/v1/packages` carries no catalog collection at all; its strict body refuses them with `400`.

**What an author sees.** The boot, or the install, fails with an ADR-0112 envelope: `code: 'NAMESPACE_CONFLICT'` (the code the namespace gate already carries; `NAMESPACE_CONFLICT_CODE` is exported) and `status: 422`. The message names the incoming package and the existing holder of each conflicting name, all conflicts in one message. The thrown error carries `conflicts[]` with `{ catalogType, name, incomingPackageId, existingHolder }`, where `existingHolder` is `{ kind: 'package', packageId }`, `{ kind: 'environment' }` or `{ kind: 'built-in' }`. **The one-line fix: rename the item in one of the two packages, or uninstall one of them.** A built-in name is never available to a package. An assignment that named the old name must name the new one; nothing rewrites stored assignments.

**What is NOT refused.** The same package registering its own name again (an idempotent reload, a re-install, a hot reload). An item of any other metadata type shared by two packages. An environment save over a package-held name: a registration with no package (every `sys_metadata` hydration and metadata write-through) is never judged here, and a packaged permission set is already locked against an in-place edit (`403`). `OS_METADATA_COLLISION=warn` downgrades the namespace gate only. It does not downgrade this refusal.

**Measured producers.** On objectstack `1604e094f5`, the four examples (`app-crm`, `app-showcase`, `app-todo`, `app-multi-package`) and the platform built-ins carry 50 catalog declarations, and no name has more than one holder. Deployed and marketplace packages NOT MEASURED.
