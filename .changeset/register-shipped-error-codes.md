---
"@objectstack/spec": minor
---

feat(spec): register every error code that ships in `dist` — `OBJECT_OWNERSHIP_CONFLICT`, the seven `STACK_*` `defineStack` refusals and `PLUGIN_UI_REQUIRED_KEY_MISSING` enter `ERROR_CODE_LEDGER` (#16449)

Under the #16404 ruling (director seat, decision batch #62, 2026-09-07, option D; maintainer 「同意」) **the published contract face for error codes is `ERROR_CODE_LEDGER` / `StandardErrorCode`**: every `code` that ships in a package's `dist` is registered there, door or no door, because a consumer's `catch (e) { switch (e.code) }` pins the spelling the moment it ships and nothing could flag a later rename. Nine codes were shipping unregistered on this tree and now have rows, each under the package that stamps it:

| code | stamped by | `status` | reaches an HTTP door on this tree? |
|---|---|---|---|
| `OBJECT_OWNERSHIP_CONFLICT` | `@objectstack/objectql` (`SchemaRegistry.registerObject`, ADR-0029 D3) | 422 | no — every path aborts boot or is caught below any door |
| `STACK_SCHEMA_INVALID` · `STACK_CAPABILITY_UNKNOWN` · `STACK_CROSS_REFERENCE_INVALID` · `STACK_NAMESPACE_PREFIX_INVALID` · `STACK_SINGLE_APP_VIOLATION` · `STACK_HIERARCHY_SCOPE_CAPABILITY_REQUIRED` · `STACK_TRIGGER_CAPABILITY_REQUIRED` | `@objectstack/spec` (`defineStack`, #14552 / #15963) | 422 | no — raised by `os validate` / `os build` and the host configs at boot |
| `PLUGIN_UI_REQUIRED_KEY_MISSING` | `@objectstack/spec` (`PluginSchema`'s `superRefine`, on the zod issue's `params.code`, #16334) | rides `PLUGIN_CONTRACT_VIOLATION`'s | no — raised at `kernel.use()` |

The card's ninth, `NAMESPACE_CONFLICT`, was already registered by #14748 and already answers `error.code: NAMESPACE_CONFLICT` at `POST /api/v1/packages`; this release changes nothing there.

**Wire consequence, stated plainly.** For a code that reaches an HTTP door, registration changes what a client reads: `error.code` becomes the specific code instead of the standard member the status derives (`VALIDATION_ERROR` for 422) with the producer's spelling demoted beside it in `declaredCode`. That is the ruling's intended effect — a consumer can branch on the real code — and it is what the Clause-② review judges. Measured on this tree, **none of the nine has such a door** (the table's last column; `OBJECT_OWNERSHIP_CONFLICT`'s reading was re-taken: the only two non-test `registerObject` callers outside `objectql`, both in `metadata-protocol`, catch it and log), so **no HTTP body changes with this release**. What changes is the face: `ErrorCode` — the union `ApiErrorSchema.code` parses against — gains nine members, `REGISTERED_ERROR_CODES` lists them, the generated docs references carry them (`check:generated` found nothing else stale — no authorable schema and no JSON-schema artifact reads this union), and each refusal's `e.code` is now a member of the union a consumer's exhaustive `switch` is written over. Should a door ever answer with one of these codes, the wire carries the specific code from then on. The `declaredCode` demotion (#9106) remains for genuinely unknown / third-party spellings only.

**Why `minor`, and no `BREAKING` banner.** Nothing is removed or renamed; every existing body parses exactly as before. The change is a purely additive widening of a published surface (nine new `ErrorCode` members), which the 2026-09-04 ruling on #15294 requires to be at least `minor`. The one consumer-visible cost is type-level: an exhaustive `switch` over the `ErrorCode` TYPE gains nine cases to cover — additive, and the shape the ruling asks for.

Also in this release, as the mechanism that keeps the class closed: `check:dispatcher-error-vocabulary` now refuses to classify a `packages/spec/src/**` stamp site as anything but `foreign-vocabulary` or `runtime-pinned` (`spec-face-unregistered`) — a code raised under the spec tree is a ledger member or it fails CI — and the ledger's header records the ruling as the "door or no door" rule in its own words. The nine `boot-refusal` classification rows in `dispatcher-error-vocabulary.ts` ratcheted out with the registrations, their reachability reading now carried on the ledger rows.
