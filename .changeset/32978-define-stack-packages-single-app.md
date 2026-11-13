---
'@objectstack/spec': minor
---

feat(spec)!: strict `defineStack` judges a stack that carries `packages[]` per package body, and counts against its manifest id only the top-level apps no body declares, the reading `composeStacks` and the load path use (ADR-0019 D3 as amended)

Clause-②: yes (narrowing) — one face narrows and one widens. Narrowed: a stack carrying `packages[]` whose top level holds an app that no package body declares, beside an app of the package body with the manifest's id (or two such apps), is refused, where it was accepted. Widened: a stack carrying `packages[]` whose top level repeats apps that different package bodies declare (an additive artifact, such as `resolveArtifactCollections` output) is accepted, where it was refused.
Metadata-protocol: narrowed

<!-- adr-0087: registered define-stack-packages-residual-second-app-refused -->

**BREAKING** accept-set narrowing in strict `defineStack` (`@objectstack/spec`, the root export), for a stack that carries `packages[]` and a manifest of type `app` or `module`.

- **Before.** Strict `defineStack` counted every top-level app of such a stack against the stack's own manifest. The load path registers each package body under its own id, and only the top-level apps that no body declares under the manifest id (the residual rule, `unclaimedTopLevel` in `@objectstack/metadata`). So `defineStack` accepted a hand-built stack whose undeclared top-level app the boot then registered beside the manifest-id body's own app (two apps under one package), and refused an additive artifact whose top level only repeats the apps its bodies declare.
- **Now.** `defineStack` reads such a stack through the judge `composeStacks` uses for its result: each body by its own type, id and apps, and the manifest id with the apps of its own body plus every top-level app no body declares. Two or more there are refused with `STACK_SINGLE_APP_VIOLATION` (422), header `defineStack single-app validation failed`, one finding naming the package, each app with where it sits, and the remedy. A top-level app a body declares counts against that body only, so the additive artifact is accepted (`resolveArtifactCollections(composeStacks(stacks, { manifest: 'preserve' }))` handed back to `defineStack` passes the single-app rule).
- **Unchanged.** A stack without `packages[]` (every authored package): every app it carries still counts against its own manifest. Package types other than `app` and `module`, and `defineStack(…, { strict: false })`, are not judged.
- **Fix.** Declare each top-level app inside the package body it belongs to, or give it a `type: 'module'` package of its own and compose with `composeStacks(stacks, { manifest: 'preserve' })`.
