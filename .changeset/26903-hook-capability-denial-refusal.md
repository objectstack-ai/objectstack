---
'@objectstack/runtime': patch
---

fix(runtime): a hook refused for a missing capability answers a coded 403 naming the hook and the capability, not a bare 500 (#26903)

Clause-②: no
Metadata-protocol: none

**What was wrong.** A hook whose sandboxed body calls something its `body.capabilities` does not grant (for example `ctx.api.object('note').find(...)` without `api.read`) is refused by the capability check. The QuickJS runner marked that denial as its own fault, so a save on the hook's object under `onError: 'abort'` answered `500 INTERNAL_ERROR` with `Internal server error`. Neither the caller nor the author was told which hook, or which capability, or what to change.

**What changes.** In a hook body, a capability denial is now a refusal. `POST /api/v1/data/OBJECT` (and every other door that answers through `mapDataError`) answers `403 INSUFFICIENT_PRIVILEGES`, an existing standard catalog code, with a sentence such as `capability 'api.read' not granted to hook 'note_guard' (called ctx.api.object('note').find). Grant it by adding 'api.read' to the hook's body.capabilities.` Nothing is written. The BodyRunner logs it once at `info` as a refusal, not at `error` with a stack. This applies to every gate: `api.read`, `api.write`, `api.transaction`, `crypto.uuid` and `log`, and `ctx.title(field)`.

**Unchanged.** The capability check is exactly as strict as before, and a hook that has the capability runs as before. Under `onError: 'log'` the denial is still recorded on the `[hook] handler failed (onError=log; suppressing)` line, now with the remedy, and the save proceeds. An action or job body's capability denial still answers `500 INTERNAL_ERROR`. No code is added.
