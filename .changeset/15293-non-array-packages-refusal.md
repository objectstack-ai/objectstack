---
"@objectstack/runtime": patch
---

A release artifact whose `packages` is present but is not an array (`{}`, `0`, `'x'`) is now refused by the runtime's collection reader too, as `INVALID_ARTIFACT_PACKAGES` (ADR-0112, `status: 422`) (#15293).

Clause-②: no

`packages` is declared as an array of package entries (`ObjectStackDefinitionSchema.packages: z.array(ArtifactPackageSchema).optional()`), and the rule is now written down once, beside `AssembledPackageBodySchema` in `@objectstack/spec`: an absent `packages` means a single-package artifact, and any other non-array value is malformed and refused. `resolveArtifactPackageOrder` in `@objectstack/core` already refused it, and so did the i18n detector in `@objectstack/plugin-dev` and the default-permission-set reader in `@objectstack/plugin-security`. The runtime's collection reader was the one that answered differently: it handed such an artifact back unchanged and read its collections off the top level.

- **What changes**: `AppPlugin` reads its collections in `start()`, and `start()` now raises the same refusal `init()` already raised through the kernel's `manifest` service. Under `os dev`, `DevPlugin`'s child-`start()` loop logs it on its `error` line, where before the app started on its top-level collections alone. `createStandaloneStack` now refuses such an artifact while it builds the stack. Before, the refusal came later, when the app registered with the `manifest` service. `loadArtifactBundle`'s runtime-module merge reports it through its existing `warn` line and skips the merge, as it already does for a malformed `packages[]` entry.
- **What does not change**: an absent `packages`, and `packages: null`, still return the caller's own object by identity. A well-formed `packages[]` resolves exactly as before.
- **Fix**: remove the `packages` key for a single-package artifact, or make it an array of `{ manifest: … }` entries.
