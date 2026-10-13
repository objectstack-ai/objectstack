---
'@objectstack/types': patch
---

fix(types): the data door answers the sandbox's own fault as a fault, not as "this object does not exist" (#22868)

Clause-②: no

**What was wrong.** The QuickJS runner raises some `SandboxError`s itself. These carry no `innerMessage`. Two of them name the object the hook body addressed: a denied capability on `ctx.api.object(...)` (`capability 'api.read' not granted to hook 'guard' (called ctx.api.object('account').find)`) and a `ctx.api` method the host does not implement (`ctx.api.object('account').find not implemented`). When that object was the one the request named, `mapDataError` read the quoted object name plus the word `not` as an unknown object. `POST /api/v1/data/account` then answered `404 OBJECT_NOT_FOUND` with `Object 'account' is not registered`. Every other runner fault already answered `500 INTERNAL_ERROR`, which is what the runner's contract says these errors are.

**What changes.** `mapDataError` checks `isSandboxOwnFault` first, next to the existing check for a sandboxed body that crashed. An error the sandbox raised itself now answers `500 INTERNAL_ERROR` with `Internal server error`, whatever its text names. The runner's text goes to the server log only. The sync `/import` row and the `/import/jobs` stored row read that same sentence.

**Unchanged.** A driver's unknown-object text (`no such table: account`, `relation "account" does not exist`) still answers `404 OBJECT_NOT_FOUND`. So does the same wording thrown by anything other than the sandbox: the check reads the error's producer, not its words. A hook body's refusal keeps its sentence and status, and a crash keeps its `500`.
