---
'@objectstack/runtime': patch
---

fix(runtime): a sandboxed body that throws a plain `{ code, message }` object is answered with its own `message` as the client sentence, never `undefined: MESSAGE` or `[object Object]`; its code is kept (#23718)

**Client sentence change, status and code unchanged.** It applies to `POST /api/v1/actions/:object/:action` on a `type: 'script'` action whose sandboxed body throws a value that is not an `Error`, and to a sandboxed hook body that does the same (its refusal at the action door behind a write, and in the `/data` error classification). The QuickJS runner flattened every thrown value as `NAME: MESSAGE`, else `String(value)`. A plain object has no class name and no `toString` of its own, so the doors served `undefined: MESSAGE`, or `[object Object]` when it had no `message`.

- `throw { code: 'EMAIL_TAKEN', message: 'That address is already on file' }`
  - FROM `{"success":false,"error":{"code":"VALIDATION_ERROR","message":"undefined: That address is already on file","httpStatus":400,"declaredCode":"EMAIL_TAKEN"}}`
  - TO `{"success":false,"error":{"code":"VALIDATION_ERROR","message":"That address is already on file","httpStatus":400,"declaredCode":"EMAIL_TAKEN"}}`
- `throw { code: 'DUPLICATE_RECORD' }`
  - FROM `{"success":false,"error":{"code":"DUPLICATE_RECORD","message":"[object Object]","httpStatus":400}}`
  - TO `{"success":false,"error":{"code":"DUPLICATE_RECORD","message":"Internal server error","httpStatus":400}}`

A value with no usable `message` and no `toString` of its own is answered with `Internal server error`, the sentence every door already answers for a fault with no business message. To give the caller words, throw a `message` (or an `Error`).

Two outcomes move with it, both for a thrown plain object only:

- A `name` on a plain object is a field, not a class: `throw { name: 'TypeError', message: 'forged' }` was read as a crash (`500 INTERNAL_ERROR`); it is now a refusal, `400` with `forged`.
- A plain object whose `String()` is empty (`throw []`) recorded no rejection, so the request waited for the sandbox's wall-clock ceiling and answered `500`; it now answers at once with the no-message sentence.

Control, unchanged: a thrown `Error` (or subclass) keeps `NAME: MESSAGE` in the server log and the client sentence it got before. A thrown string is its own sentence, and an object with a `toString` of its own keeps it.

In-process: the `SandboxError` a caller catches for such a throw carries the value's `message` as `innerMessage`, and its log-only `message` reads `KIND 'NAME' threw: Error: MESSAGE`.

Clause-②: no
