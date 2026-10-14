---
'@objectstack/spec': minor
---

fix(spec): the error-code ledger records `@objectstack/mcp` as an emitter of `OBJECT_API_DISABLED` and `OBJECT_API_METHOD_NOT_ALLOWED` (#22664)

Clause-②: yes

- **`ERROR_CODE_LEDGER` gains the `@objectstack/mcp` owner key.** The MCP stdio data bridge stamps both exposure codes onto the error it throws when an object's `enable` block refuses a data verb: `OBJECT_API_DISABLED` (404) for `apiEnabled: false`, and `OBJECT_API_METHOD_NOT_ALLOWED` (405) for an `apiMethods` whitelist that does not grant the verb. The published type of `ERROR_CODE_LEDGER` gains the key. `ErrorCode` and `REGISTERED_ERROR_CODES` are unchanged, because both codes were already registered under `@objectstack/rest`.
- **`PROVENANCE_WAIVERS` gains one entry:** `@objectstack/types` → `UNIQUE_SCOPE_CONFIRMATION_REQUIRED`, registered under `@objectstack/cloud-connection`. `@objectstack/types` defines the shared constant `GLOBAL_UNIQUE_CONFIRMATION_REQUIRED`. The one stamp is the marketplace install seam's 409 in `@objectstack/cloud-connection`, whose owner key already lists the code.

No code is added, renamed or removed, and no schema moves.
