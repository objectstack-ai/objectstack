---
'@objectstack/runtime': patch
---

fix(runtime): a sandboxed body that throws a value no read can flatten (`throw ''`, a null-prototype object, an object whose `message` getter throws) now ends its run at once with the sentence `the script threw a value that could not be read`, instead of waiting for the wall-clock ceiling (#23723)

**Latency and answer change, for these values only.** The QuickJS runner's reject handler records a body's rejection as a flattened string, and the run ends only once that string is non-empty. For these values the read threw or gave `''`, so nothing was recorded: the run waited for the sandbox's wall-clock ceiling (30 s by default) and ended as a budget error with no business message, which the doors answer as a crash. The handler now records the fixed sentence above for any value it cannot read, and the run ends on the same path as any other rejection. The sentence names nothing the value carried and no stack.

Measured at `POST /api/v1/actions/:object/:action` on a `type: 'script'` action:

- `throw { code: 'EMAIL_TAKEN', get message() { throw new Error('boom') } }`
  - FROM, after the 30 s ceiling: `500 {"success":false,"error":{"code":"INTERNAL_ERROR","message":"Internal server error","httpStatus":500}}`
  - TO, in about 0.1 s: `400 {"success":false,"error":{"code":"VALIDATION_ERROR","message":"the script threw a value that could not be read","httpStatus":400,"declaredCode":"EMAIL_TAKEN"}}`
- `throw ''` and `throw Object.create(null)`
  - FROM, after the 30 s ceiling: the same `500 INTERNAL_ERROR`
  - TO, in about 0.1 s: `400 {"success":false,"error":{"code":"VALIDATION_ERROR","message":"the script threw a value that could not be read","httpStatus":400}}`

The status and envelope are the ones the door already gives a body that threw; no door changed. A `code` the value carries is kept, as for any other thrown value. Two more values that could not be read move the same way: an `Error` whose `name` and `message` are both empty, and an `Error` whose `message` getter throws. To give the caller words, throw a readable `message` (or an `Error`).

Control, unchanged byte for byte: every value the handler could already read (a thrown `Error` or subclass, a plain `{ code, message }` object and the other plain-object shapes, primitives, the engine's relayed duplicate refusal, a nested hook refusal's sentence, the `code` / `fields` / `status` / `userMessage` fields, and a capability denial). A body that never settles still ends at the wall-clock ceiling.

In-process: the `SandboxError` a caller catches for such a throw now reads `KIND 'NAME' threw: Error: the script threw a value that could not be read`, with that sentence as `innerMessage`, instead of the wall-clock budget error.

Clause-②: no
