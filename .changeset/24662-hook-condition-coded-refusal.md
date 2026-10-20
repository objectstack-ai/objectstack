---
'@objectstack/types': patch
---

fix(types): a write an authored hook condition refused because it could not be evaluated answers a coded `400 VALIDATION_ERROR`, not the unclassified `500 INTERNAL_ERROR`

Clause-②: no (the write is refused before and after, with nothing stored; only the refusal's status and code move, onto the published `StandardErrorCode` member `VALIDATION_ERROR`; no accept set moves and no code is added)

- **What changed on the wire.** A `HookConditionError` whose condition compiled and then faulted on the record it judged (`reason: 'unevaluable'`) is now a refusal at every data door: `400`, code `VALIDATION_ERROR`, and the hook's own message, which names the hook and the CEL fault and never the condition source or a record value. Before, it matched nothing and was answered `500 INTERNAL_ERROR` — on `@objectstack/rest`'s doors with a `[REST] Unhandled error` line, and on the runtime dispatcher's `/data` door (through `@objectstack/hono`'s catch-all) with the hook's message at status 500. A `/batch` row for the same throw now reads `VALIDATION_ERROR` with `httpStatus: 400` and the hook's message, where it read `INTERNAL_ERROR` with a withheld message.
- **Why `400` and `VALIDATION_ERROR`.** The status is the one a validation rule that cannot be evaluated answers, and the two share one message builder. The code is the catalog member `400` names, because a hook's gate addresses no field and the per-field `VALIDATION_FAILED` envelope does not fit it.
- **The log.** The refusal is handed to the caller, so `@objectstack/rest` no longer prints `[REST] Unhandled error` for it. Its log verdict reads the declaration from `resolveThrownHttpError`, as it does for any declared client refusal.
- **Unchanged.** A condition that never compiled (`reason: 'uncompilable'`) keeps its sanitised `500` and its log line. That fault does not depend on the request, and its message quotes the condition source. A hook that refuses on purpose answers exactly as before.
