---
'@objectstack/spec': minor
---

feat(spec)!: strict `defineStack` judges a `packages[]` stack's namespace prefixes per package body, and its top level by the residual rule, the way the load path registers its objects (ADR-0028, ADR-0130 D4)

Clause-②: yes (narrowing) — one face widens and one narrows. Widened: a stack carrying `packages[]` whose top level repeats objects that package bodies of different namespaces declare (an additive artifact, such as `resolveArtifactCollections` output) is accepted, where it was refused. Narrowed: a `packages[]` body whose object its own body's namespace does not prefix is refused, where it was accepted when the stack's top level held no copy of it or a copy the manifest's namespace prefixes.
Metadata-protocol: narrowed

<!-- adr-0087: registered define-stack-packages-body-namespace-prefix-refused -->

**BREAKING** accept-set narrowing in strict `defineStack` (`@objectstack/spec`, the root export), for a stack that carries `packages[]`.

- **Before.** Strict `defineStack` judged every top-level object of such a stack against the stack manifest's one `namespace`, and no package body's objects at all. The load path registers each body's objects under that body's own package and namespace, and only the top-level objects no body declares under the manifest id (the residual rule, `unclaimedTopLevel` in `@objectstack/metadata`). So the reader round trip of a suite whose packages declare different namespaces, `defineStack(resolveArtifactCollections(composeStacks(stacks, { manifest: 'preserve' })))`, was refused with `STACK_NAMESPACE_PREFIX_INVALID`, and a body object its own namespace does not prefix passed.
- **Now.** Each body's objects are judged against that body's own `namespace`, the finding located as `Package 'ID' (packages[J].manifest.objects[I]): ` before the rule's sentence. A top-level object that no body declares is judged against `manifest.namespace` (`Top-level objects[I], which no package body declares, is registered under package 'ID': `). A top-level object a body declares is that body's object and is judged with the body only, so the two-namespace round trip is accepted.
- **Unchanged.** A stack without `packages[]` (every authored package): every object is judged against its own `manifest.namespace`, with the same sentence. A package with no `namespace` is not judged, and `defineStack(…, { strict: false })` judges nothing. Every body that came out of its own strict `defineStack` call was already judged this way.
- **Fix.** Rename the object to its own package's prefix (`NAMESPACE_shortName`; the finding names the body and the exact rename), or move it into the package body whose namespace it carries.
