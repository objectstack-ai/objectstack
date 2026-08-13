---
"@objectstack/spec": patch
---

fix(spec): `MONGODB_MULTI_TENANT_UNSUPPORTED` leaves the error-code ledger — a boot refusal never reaches a wire envelope (#8035)

`ERROR_CODE_LEDGER` registered `MONGODB_MULTI_TENANT_UNSUPPORTED` under
`@objectstack/driver-mongodb` (#3724), but no response envelope can carry it.
Unlike the `OVERLAY_PERSISTENCE_FAILED` precedent (#5783), the throw site was
not deleted — it never had a wire path to begin with: the CLI boot handler
(`serve.ts`) rethrows the driver's tenancy refusal and aborts the process
before any HTTP server exists, and the one request-reachable trigger
(`assertObjectsNotTenantScoped` via `syncObjectSchema` inside the metadata
protocol's `ensureObjectStorage`) sits in a documented best-effort catch that
logs a warning and continues. A registered code no response can deliver is
ADR-0112's "no silent fourth state" read backwards — the vocabulary promised
clients a code that could never arrive, and the ledger's admission rules check
casing, duplication and shadowing, never emittability, so the row stayed green.

Verified before removing (evidence in the PR body): a repo-wide search finds
the name only in the ledger row itself, two generated reference pages, the
driver's own guard constant and its docs, the CLI's duck-typed boot match, and
historical changesets/CHANGELOGs. Every runtime caller of the schema-sync path
either swallows the error into a log or aborts boot pre-HTTP. No consumer —
including `objectui` and `cloud`, both searched — reads the literal as a wire
code.

**Wire impact: none.** No response ever carried this code, so no client can
lose one. The narrowing is type-level: `ErrorCode` (what `ApiErrorSchema.code`
validates) no longer admits the string, and there is no emit site to reject.

**The boot refusal is untouched.** `MULTI_TENANT_UNSUPPORTED_CODE`, the
`MongoDBMultiTenantUnsupportedError` class, its message, and the CLI's
duck-typed `e?.code` match all stay — host boot matching is not wire
vocabulary. A new driver-mongodb test pins the code literal so the CLI's
loud-fail path cannot be silently un-armed by a rename, and the ledger test
now asserts the wire vocabulary refuses the retired string.
