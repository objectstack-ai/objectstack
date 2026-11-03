---
'@objectstack/runtime': patch
---

fix(runtime): `list_actions` no longer offers `revoke_api_key` as runnable to a caller signed in with an API key. The action is marked `unavailable` with the API-key management guard's own `PERMISSION_DENIED` and sentence, the refusal `run_action` gives (#28943)

Clause-②: no
Metadata-protocol: none

The forward's credential marker (`apiForwardCredentialRefusal`) only asked whether the target's door reads the caller's credential. The data door reads an API key, so `sys_api_key`'s Revoke was listed as runnable to an `osk_` caller. The row's per-object gate (`@objectstack/core` `apiKeyManagementCredentialRefusal`) then refused the write with `403 PERMISSION_DENIED`. The marker now also asks that guard about the data-door request a forward makes (the object, and the operation its method and path name). The guard is the one source: the listing's `unavailable` entry carries the guard's code and sentence, and the REST action door and MCP `run_action` answer that same refusal before forwarding instead of after. The guard's refusal is unchanged, and so are reads of `sys_api_key`, every other object, and the session caller's listing and run.
