---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): the last-administrator guard answers a read it could not complete with 503 `SERVICE_UNAVAILABLE`, the code the sibling guards on the same doors answer their read faults with

Clause-②: no
Metadata-protocol: none

The last-administrator guard fails closed: when a read its verdict depends on throws, it refuses the write. That refusal answered 403 `PERMISSION_DENIED`, the same code as a refusal on the merits, so a caller could not tell "you may not" from "try again" by the code. The organization slug guard (`auth-manager.ts`) and the organization delete admission already answer their read faults with 503 `SERVICE_UNAVAILABLE`.

- **Every half of the guard, one shape.** The shared fail-closed envelope and the Default Organization slug-capture rule now throw the same read fault: `code: 'SERVICE_UNAVAILABLE'`, `status: 503`, the read's own failure on `cause`. The write is still refused and nothing is written. A refusal on the merits, and an enumeration that completed but returned more rows than the guard can judge, keep 403 `PERMISSION_DENIED` unchanged.
- **The data API** answers the read fault 503 `SERVICE_UNAVAILABLE` with the server-fault message, as it does every declared 5xx.
- **better-auth's endpoints** (`organization/update`, the admin ban and remove-user endpoints, and every other endpoint that writes through the adapter) answer it 503 `SERVICE_UNAVAILABLE`. The adapter now maps any engine error that declares `status: 503` and `code: 'SERVICE_UNAVAILABLE'` to that answer; before, such an error reached better-auth's router as an unhandled 500 with an empty body. The driver's message is not relayed.
- **`organization/delete`** of the Default Organization answers the guard's read fault 503 `SERVICE_UNAVAILABLE`, the code the admission's own read faults answer with. A refusal on the merits there stays 403 `PERMISSION_DENIED`.
- **For a client:** branch on the code. `SERVICE_UNAVAILABLE` means retry once the data store is reachable; `PERMISSION_DENIED` means the write itself is refused.
