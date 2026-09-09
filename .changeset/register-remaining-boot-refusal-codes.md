---
"@objectstack/spec": minor
---

feat(spec): register the fourteen remaining `door: 'none'` error codes that ship in `dist` — the rest of the #16404 class after #16449 enters `ERROR_CODE_LEDGER` (#16649)

Under the #16404 ruling (director seat, decision batch #62, 2026-09-07, option D; maintainer 「同意」) **the published contract face for error codes is `ERROR_CODE_LEDGER` / `StandardErrorCode`**: every `code` that ships in a package's `dist` is registered there, door or no door, because a consumer's `catch (e) { switch (e.code) }` pins the spelling the moment it ships. #16449 registered the nine codes measured on its tree; fourteen more were still shipping unregistered — every `boot-refusal` row `dispatcher-error-vocabulary.ts` carried — and now have rows, each under the package that stamps it:

| code | stamped by | `status` on the thrown value | reaches an HTTP door on this tree? |
|---|---|---|---|
| `INVALID_ARTIFACT_PACKAGES` · `INVALID_ARTIFACT_PACKAGE_ENTRY` · `DUPLICATE_ARTIFACT_PACKAGE` | `@objectstack/core` (`resolveArtifactPackageOrder`, ADR-0130 D4/D5) | 422 | no — boot-time `manifest.register()` aborts boot; the install route answers with its own `PLUGIN_REGISTER_FAILED` |
| `NO_SUCH_RUN` · `PLAN_CHANGED` · `PREFLIGHT_FAILED` · `NOT_COMPENSABLE` | `@objectstack/core` (`MigrationJournalRefusal`, the migration-journal runner) | none | no — caught by the CLI's `migrate` commands with `instanceof` and printed |
| `SERVICE_NOT_REGISTERED` | `@objectstack/core` (`PluginLoader.getService`'s "never registered" rejection) | none, by design | no — read in-process by the seam that catches the rejection |
| `PLUGIN_CONTRACT_VIOLATION` | `@objectstack/core` (`assertPluginContract`, raised at `kernel.use()`) | none | no — raised while the kernel is still registering plugins |
| `MIXED_ARTIFACT_COLLECTION_SHAPE` | `@objectstack/runtime` (`resolveArtifactCollections`, ADR-0130 D4) | 422 | no — every call site resolves before a transport exists |
| `DUPLICATE_ARTIFACT_OBJECT_NAME` | `@objectstack/objectql` (`SchemaRegistry.installPackage`, ADR-0130 D3) | 422 | no — the HTTP install sites pass no artifact scope, so they cannot raise it |
| `MEMORY_MULTI_TENANT_UNSUPPORTED` | `@objectstack/driver-memory` (the tenancy guard) | none | no — a boot refusal the CLI rethrows pre-HTTP |
| `MONGODB_MULTI_TENANT_UNSUPPORTED` | `@objectstack/driver-mongodb` (the tenancy guard) | none | no — a boot refusal the CLI rethrows pre-HTTP (registered by #3724, unregistered by #8035, re-registered here under the ruling) |
| `WALLED_MEMBERSHIP_POLICY_UNDECLARED` | `@objectstack/organizations` (the walled-posture membership-policy gate, `kernel:bootstrapped`) | none | no — fires before `kernel:listening` opens the socket |

**Wire consequence, stated plainly.** Registration changes what a client reads only where a code reaches an HTTP door: `error.code` would carry the specific code instead of the standard member the status derives, with the producer's spelling no longer demoted into `declaredCode`. Re-measured on this tree at the sites each `boot-refusal` row named (the table's last column is that reading, one line per group), **none of the fourteen has such a door**, so **no HTTP body changes with this release**. What changes is the face: `ErrorCode` — the union `ApiErrorSchema.code` parses against — gains fourteen members, `REGISTERED_ERROR_CODES` lists them, the ledger gains two owner keys (`@objectstack/driver-mongodb` returns after #8035 removed it; `@objectstack/organizations` is new), and each refusal's `e.code` is now a member of the union a consumer's exhaustive `switch` is written over. Should a door ever answer with one of them, the wire carries the specific code from then on.

**`MONGODB_MULTI_TENANT_UNSUPPORTED` is a deliberate reversal, not drift.** #8035 unregistered it on the ground that "host boot matching is not wire vocabulary"; the #16404 ruling supersedes exactly that ground (the ledger header's "Retiring a code" section records both halves), and the test that pinned its absence now pins its presence. What still retires a row is a code with no producer left in `packages/**` — `OVERLAY_PERSISTENCE_FAILED` (#5783) remains the pinned witness of that class.

**Why `minor`, and no `BREAKING` banner.** Nothing is removed or renamed; every existing body parses exactly as before. The change is a purely additive widening of a published surface (fourteen new `ErrorCode` members, two new owner keys), which the 2026-09-04 ruling on #15294 requires to be at least `minor`. The one consumer-visible cost is type-level: an exhaustive `switch` over the `ErrorCode` TYPE gains fourteen cases to cover.

The fourteen `boot-refusal` classification rows in `dispatcher-error-vocabulary.ts` ratchet out with the registrations (the gate reports a registered code's row as `stale-row`), their reachability reading now carried on the ledger rows; that module is not part of `@objectstack/runtime`'s published entry, so nothing in that package's `dist` moves. The `boot-refusal` verdict itself stays declared for a future pre-HTTP producer; retiring it and widening the gate's spec-face refusal to every published package is the card's second half and is not in this release.
