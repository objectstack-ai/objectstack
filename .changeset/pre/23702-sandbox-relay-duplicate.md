---
'@objectstack/runtime': patch
---

fix(runtime): a sandboxed body that lets the engine's `DuplicateRecordError` leave unchanged is answered `409 UNIQUE_VIOLATION`, not `409 DUPLICATE_RECORD`; a body that throws `DUPLICATE_RECORD` itself keeps it (#23702)

**Wire change at the action door: `409 DUPLICATE_RECORD` becomes `409 UNIQUE_VIOLATION`.** It applies to `POST /api/v1/actions/:object/:action` on a `type: 'script'` action whose sandboxed body writes through `ctx.api` with a value a unique key already holds and does not catch the refusal, or catches it and re-throws it unchanged. The same holds when the refusal comes from a sandboxed hook body's own write, fired by the action's write. A client that matched `code === 'DUPLICATE_RECORD'` on that refusal must match `code === 'UNIQUE_VIOLATION'` instead, which is what the dispatcher already answers when a host-code handler's write is refused.

Why: the maintainer ruled one wire spelling for a unique-constraint refusal on every route, `UNIQUE_VIOLATION` (recorded in commit 65846bc46). Every door translates the engine's class, recognised by its registered code and its class name together. The QuickJS runner rebuilt the escaping refusal as a `SandboxError` carrying the code without the class, so no door recognised it.

- FROM `{"success":false,"error":{"code":"DUPLICATE_RECORD","message":"DuplicateRecordError: Duplicate record refused on 'udoc': …","httpStatus":409}}`
- TO `{"success":false,"error":{"code":"UNIQUE_VIOLATION","message":"Duplicate record refused on 'udoc': …","httpStatus":409,"details":{"developerMessage":"Duplicate record refused on 'udoc': …","object":"udoc"}}}`

The fix is in the runner, so no door changed: when the error leaving the body is the very object the engine's refusal became inside the VM, with nothing that crosses the VM rewritten on it, the runner throws the engine's own `DuplicateRecordError`. `message` loses the `DuplicateRecordError: ` class-name prefix, and `details.object` names the object the engine refused.

Control, unchanged: a body that throws its own error carrying `DUPLICATE_RECORD` keeps `409 DUPLICATE_RECORD` and its own sentence, whatever `name` it gives that error. A body that rewrote the engine's error (its `name`, `message`, `code`, `status`, `fields` or `userMessage`) before throwing it is speaking for itself and is answered exactly as before. Every other host error leaves the runner as a `SandboxError`, exactly as before.

In-process: a caller of a write whose sandboxed hook body lets the refusal leave, or of a script action whose body does, now catches the engine's `DuplicateRecordError` (`code` `DUPLICATE_RECORD`, `status` `409`, `object` the refused object) rather than a `SandboxError`. `code` and `status` are unchanged, and the error no longer carries `innerMessage` or the `hook 'NAME' threw:` wrapper in `message`.

Clause-②: no
