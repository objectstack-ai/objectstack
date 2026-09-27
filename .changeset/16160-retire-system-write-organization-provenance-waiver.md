---
'@objectstack/spec': patch
'@objectstack/plugin-sharing': patch
---

`plugin-sharing` recognises the engine's organization refusal through objectql's own published recognizer instead of a locally re-spelled literal, and the `PROVENANCE_WAIVERS` row that excused that local spelling is retired with it (#16160).

Clause-②: no

The waiver carried its own expiry in its `reason`: *removed together with the stamp site when objectql publishes a recognizer*. It does, so both halves land here — `check:error-code-provenance` reconciles a waiver in three directions at once (the `registeredUnder` key still lists the code, the waived package still does not, and the scan still finds a site for the pair), so removing either half alone reddens the gate on the other.

- **`ENGINE_ORGANIZATION_REFUSAL_CODE` is gone.** It was a `constdef` stamp site in `plugin-sharing/src/sharing-rule-service.ts` for a code this package only ever RECOGNISES — `@objectstack/objectql` is the emitter and already carries the row. The per-grant catch now asks `isSystemWriteOrganizationRequiredError(err)`, and the `warn` that reports an absorbed refusal names `SYSTEM_WRITE_ORGANIZATION_REQUIRED_CODE`. Both are imported from `@objectstack/objectql`, which exports them for exactly this: a consumer performs the `code` compare without authoring the string, so it acquires no stamp site of its own and cannot drift from what the engine throws.
- **Nothing about the absorbed set moves.** The catch stays as narrow as it was — one engine refusal absorbed, everything else rethrown unchanged — and `plugin-sharing` still emits this code nowhere: the surviving mention is a structured log field on the refusal it just absorbed, not a refusal envelope of its own.
- **No error-code membership moves.** `ERROR_CODE_LEDGER` and `StandardErrorCode` are untouched; `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` stays registered under `@objectstack/objectql` exactly as before. The only ledger change is one `PROVENANCE_WAIVERS` element, 10 waivers → 9, and the gate's site census 339 → 338 with `listed` unchanged at 322.
