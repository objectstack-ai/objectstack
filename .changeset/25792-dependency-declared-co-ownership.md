---
'@objectstack/core': patch
'@objectstack/objectql': patch
'@objectstack/service-package': patch
'@objectstack/cloud-connection': patch
'@objectstack/metadata-core': patch
---

feat(install): a package that declares an installed app in `manifest.dependencies` may share that app's namespace, and a boot hydrates installed packages in dependency order (ADR-0141 D5)

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is added, removed, renamed or re-shaped: `manifest.dependencies` keeps its record shape and meaning. The one narrowing is an install-local acceptance detail of the not-yet-released ADR-0141 D2 check (an artifact wrapper's own id no longer counts as a delivered package), plus the matching removal of the unreleased `DeclaredDependencyCheck.deliveredIds` option; there is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->

**Namespace co-ownership by declaration.** The install gate (`SchemaRegistry.installPackage`) used to admit packages into one namespace only when one release artifact delivered them together. A module shipped as its own artifact that uses its app's namespace was refused `422 NAMESPACE_CONFLICT` beside the installed app, whatever it declared. Now an installed package P co-owns namespace N with:

- an installed X that P declares in `manifest.dependencies`, when both use N;
- a sitting owner of N that declares P, which is the same relation read from the other end, so an upgrade or reinstall of the app beside its modules is admitted;
- a sibling S, when S and P each declare one installed package that holds N (two modules of one app, neither declaring the other).

Only direct declarations count. The shared parent must be installed and must hold N itself.

The object-name check reads the same co-owner set. A co-owner by declaration that defines an object name another co-owner already owns is refused `422 DUPLICATE_ARTIFACT_OBJECT_NAME` before any DDL. Examples: a module redefining its app's object, a sibling redefining the other sibling's object, or an app upgrade newly defining a name one of its modules owns. The message is worded per source (same artifact, declared dependency, sibling). `NAMESPACE_CONFLICT` now names the declaration as the fix for a package that extends the app holding the namespace.

**Hydrate order.** The `sys_packages` hydrate and the install-local `kernel:ready` rehydrate used to register in source-listing order. Now they sort their batch by `manifest.dependencies`, with declared ids as optional edges, through `resolvePluginOrder`. Before this, a module that hydrated before the app whose namespace it shares could be refused and stay absent for the process lifetime. In the install-local rehydrate, each ledger entry is one node, so a declared id resolves to the entry that carries that package. A dependency cycle never stops a hydrate: its members keep source order and an error names them.

**BREAKING** (an install-acceptance narrowing of the unreleased ADR-0141 D2 check) at `POST /api/v1/marketplace/install-local`. A multi-package artifact's own wrapper id no longer counts as delivered unless one of its packages carries it. A module declaring the wrapper id is judged like any other entry, because it would be `absent` on its first standalone install. `DeclaredDependencyCheck.deliveredIds` is removed with it. Also, an undecided range union whose installed version is readable is now reported `found: 'unreadable-range'` instead of `'unreadable-version'`; for example, `<5 || latest` against `7.0.0`.

**What changes for you.**

- A module that extends an app and uses its namespace declares the app in `manifest.dependencies`, and then installs beside it as its own artifact. Two modules of one app need not declare each other.
- Every package of the app's own artifact that uses the namespace should declare the app too.
- New exports: `@objectstack/core` exports `orderHydrationBatch` and `declaredDependencyIds`.
