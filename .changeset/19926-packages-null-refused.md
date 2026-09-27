---
'@objectstack/core': minor
'@objectstack/runtime': minor
'@objectstack/plugin-dev': minor
'@objectstack/plugin-security': minor
---

fix(core,runtime,plugin-dev,plugin-security): a release artifact whose `packages` is `null` is refused as malformed, never read as absent (#19926)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: no spec key, Zod schema, export, config field or stored metadata shape is added, removed, renamed or re-spelled. ObjectStackDefinitionSchema already refused packages null, and so did composeStacks with two or more inputs, so an authored stack that passed its schema reads exactly as before; what narrows is the runtime readers' behaviour on an artifact that bypassed that parse, and objectstack migrate meta has no document to rewrite for it. -->

**BREAKING** — an accept-set narrowing on a value the schema already refuses, shipped as `minor` under the launch-window convention (`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by this banner and the ADR-0087 disposition above, not by the level).

`ObjectStackDefinitionSchema.packages` is `z.array(ArtifactPackageSchema).optional()`, and `.optional()` admits `undefined`, not `null`. The schema refused `packages: null` (`invalid_type`), and `composeStacks` refused it with two or more inputs (`STACK_SCHEMA_INVALID`, `status: 422`). The runtime readers below read it as absent instead: a single-package artifact whose own top level is the one package body. Those readers now follow the declaration. An absent `packages` is `undefined` and nothing else; `null` is one of the present, non-array values the rule beside `AssembledPackageBodySchema` calls malformed, like `{}`, `0` or `'x'`, and it is refused with the same envelope: `INVALID_ARTIFACT_PACKAGES`, `status: 422`. No error code is added.

- **`@objectstack/core`**: `resolveArtifactPackageOrder` refuses `packages: null` where it returned `[artifact]`. The refusal message names the value `null`, not `object`. The resolver's callers that hand it the whole artifact raise the refusal: the kernel `manifest` service's `register()` (`ObjectQLPlugin`) and `@objectstack/verify`'s collection reader for a collection the stack's top level does not carry.
- **`@objectstack/runtime`**: `resolveArtifactCollections` drops `null` from its absent branch, so `AppPlugin`, `createStandaloneStack`, `loadArtifactBundle`'s runtime-module merge and `resolveProjectDatabaseUrl` answer a `packages: null` artifact exactly as they already answer `packages: {}`. `carriedPackageIds`, and `resolveArtifactGrantBinding` for an artifact whose `grantedPermissions` is a record, read the package list through the core resolver and raise its refusal too.
- **`@objectstack/plugin-dev`**: the i18n detector's private absent guard moves in lockstep with the resolver's absent branch, so `devI18nPluginOptions` reaches the resolver and raises its refusal when the `i18n` config (on the stack or its `manifest`), a non-empty `manifest.translations` and a non-empty top-level `translations` do not answer first. `DevPlugin` keeps its posture: it reports the metadata defect on its `error` line and boots on the in-memory i18n fallback.
- **`@objectstack/plugin-security`**: `appSecurityPluginOptions` has no guard of its own and raises the resolver's refusal for `packages: null`.
- **What does not change**: the schema; an absent `packages` (no key, or an explicit `undefined`), which still returns the caller's own object by identity; a well-formed `packages[]`; and `composeStacks` with a single input, which still returns that input by identity.

No in-repo producer writes `packages: null`, and `os build` and `os validate` refuse it at the schema before any reader runs. For a single-package artifact, leave the `packages` key out.
