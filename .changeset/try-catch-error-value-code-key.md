---
"@objectstack/spec": minor
---

feat(spec): `TryCatchErrorValueSchema` declares the `code` key the `try_catch` engine binds (#14954)

`TryCatchErrorValue` — the ONE shape the catch region's author, the engine and the run log share for the value a `try_catch` binds to `errorVariable` (default `$error`) — gains an optional `code: string`: the platform-classified error code (ADR-0112) the failing node's own result carried, e.g. `create_record`'s `DUPLICATE_RECORD`. The engine has bound it since `@objectstack/service-automation`'s #14419 change; the schema was a plain `z.object` that did not declare it, so a round-trip through the declared shape silently STRIPPED the key the engine had put there, and the generated reference page documented four keys where the runtime binds five. The `errorVariable` description on `TryCatchConfig` names `code` too, so the authorable surface documents branching on `$error.code`.

Typed as an open `string`, deliberately not `StandardErrorCode` and not the ledger union: ADR-0112 D3/D4 with the #9106 amendment make the code vocabulary `StandardErrorCode` ∪ registered ledger codes ∪ tenant-authored codes, and `NodeExecutor` is third-party-registrable, so a closed type would be false the moment anyone registers an executor that throws its own code. The closed-at-every-door rule governs `ApiErrorSchema.code` at an HTTP door; this value is bound in-process and never crosses one.

Additive and optional: every value that parsed before parses byte-identically, and a binding without a classified code still carries no `code` key — absent means "no classified code", never "nothing failed". Semver: a new optional key on a published schema widens the accept set and the exported `TryCatchErrorValue` type without retiring or renaming anything ⇒ `minor`; no ADR-0087 entry is owed because there is nothing an upgrader must migrate.
