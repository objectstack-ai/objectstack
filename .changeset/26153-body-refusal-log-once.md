---
'@objectstack/runtime': patch
---

fix: a sandboxed hook's or action's business refusal is logged once, at info, without a stack

Clause-②: no
Metadata-protocol: none

When a sandboxed hook or action body refuses on purpose, for example a state-machine hook answered as `422 INVALID_STATE`, the server log used to get two `ERROR [BodyRunner]` lines with full stacks: one at the hook and one again at the action that triggered it. An operator watching for errors could not tell a refused click from a crashed hook.

Now a throw that the HTTP doors answer in the 4xx band writes one `info` line, `[BodyRunner] sandboxed hook refused` (or `action refused`), naming the hook or action, its declared `code` and the status, with no stack. The action does not repeat a refusal its hook already logged. A throw that becomes a 5xx (a crash, a denied capability, a declared 5xx) still logs `error` with its stack, at both the hook and the action as before.

The refusal-or-fault split is read from the same error table the HTTP doors answer with (`mapDataError`), so the log level follows the status the caller saw. The HTTP status, body and message of every refusal are unchanged, and every throw is still rethrown.
