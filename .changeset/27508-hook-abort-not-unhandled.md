---
'@objectstack/rest': patch
---

fix(rest): a sandboxed hook's code-less `onError: 'abort'` refusal is no longer logged as `[REST] Unhandled error`

Clause-②: no
Metadata-protocol: none

A hook that aborts its write with a business `throw` (`onError: 'abort'`, the default) is a refusal the route already answered: the data door replies with the hook's own sentence at 400. The server still printed `[REST] Unhandled error: SandboxError` and a stack for every such abort, beside the BodyRunner's own `sandboxed hook refused` line, so operators reading the error log could not tell an intended abort from a crash.

The route log now recognises that refusal by the sandbox marker every door already reads (the body's unwrapped sentence, which a crash never has) on a code-less 4xx answer, and stays quiet for it. Nothing changes on the wire: status, body and envelope are byte-identical. A sandbox crash, a plain un-coded 4xx from any other producer, and a sandboxed body that threw a code (judged as a coded refusal, as before) are still logged.
