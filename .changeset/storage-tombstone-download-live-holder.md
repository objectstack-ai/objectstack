---
"@objectstack/service-storage": patch
---

**Fix:** a tombstoned `sys_file` that something still holds is downloadable again — no 30-day 404 in between (#10246).

Re-pointing a `sys_attachment` join row onto a file inside its 30-day grace-window tombstone has always been byte-safe: the reap guard re-verifies references at sweep time, finds the new holder, un-tombstones the row and vetoes the reap. But the sweep is the only thing that ever asked, and `sys_file`'s declared lifecycle (`ttl { field: 'deleted_at', expireAfter: '30d' }`) nominates a tombstone only **after** the window expires — measured candidates inside the window: `[]`. So the file simply sat at `status='deleted'` while `GET /api/v1/storage/files/:fileId` and `/files/:fileId/url` refused anything not `committed`. A live attachment could point at a file that 404s for up to 30 days and then silently starts working.

**What changed:** the two download endpoints stop treating the tombstone as the last word. They now ask the reap guard's own `findFileHolder` — the single definition of "is anything still holding this file?", a union over `sys_attachment` join rows and the `ref_*` ownership columns — and serve the file for exactly as long as that answers yes.

**What did not change**, deliberately:

- **No lifecycle verb was added.** There is no un-tombstone, revive or resurrect on the read path; the download writes nothing to the row. Revival remains solely the sweep guard's, which is why the fix is a read-side predicate and not a second revival mechanism (the duplicate-mechanism hazard #10241 avoided). The tombstone stays, and the sweep still reaps when the last holder goes.
- **`pending` is still refused.** Only the `deleted` limb widened; an upload that was never completed has no bytes to promise.
- **Authorization is untouched.** A served tombstone goes through the same `authorizeFileRead` gate as any other file — `AUTH_REQUIRED` (401) and `ATTACHMENT_DOWNLOAD_DENIED` / `FILE_DOWNLOAD_DENIED` (403) are unaffected. Servability is not authorization.
- **Bare kernels are unaffected.** With no data engine there is no holder question to ask, so tombstones stay refused exactly as before.

The read side and the sweep now answer the same question from the same code, so a file the download path serves is by construction a file the next sweep would veto rather than reap — and the instant the last holder goes, both flip together. That pair is what the new tests pin; the 404 text on the refusal changed from "File not found or not committed" to "File not found or not downloadable" to match (the `FILE_NOT_FOUND` code is unchanged).
