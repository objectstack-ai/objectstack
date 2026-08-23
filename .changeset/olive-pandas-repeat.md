---
"@objectstack/service-package": patch
---

`get()` and `list()` no longer report "not installed" / "nothing installed" over a storage seam they never queried.

A driver that cannot run raw SQL returns no result set rather than throwing (`InMemoryDriver.execute()` logs `Raw execution not supported in InMemory driver` and returns `null`), and the service's row flattener mapped that to `[]` — the same value a working driver returns when a package genuinely is not installed. Both read paths then handed that back as a product answer, and the boot-time `sys_packages` rehydration skipped silently because of it.

Reads now establish that the seam ANSWERED before reading emptiness as a fact. A seam that returns no result set is refused with `SERVICE_UNAVAILABLE` / 503 and a message saying the answer is unknown; boot logs the skipped rehydration at `warn` instead of passing over it. A seam that answers with genuinely zero rows is unchanged: `get()` still returns `null` and `list()` still returns `[]`.
