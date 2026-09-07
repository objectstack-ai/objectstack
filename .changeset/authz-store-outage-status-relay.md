---
"@objectstack/service-storage": patch
"@objectstack/service-settings": patch
---

An authorization-store OUTAGE now reaches the caller as the `503 SERVICE_UNAVAILABLE` it declares, on the storage download doors and on all four settings routes.

`AuthzStoreUnavailableError` exists so an outage is distinguishable from a capability denial on the wire: it declares `status: 503` and `code: SERVICE_UNAVAILABLE`, and every producer in this family already re-raises it rather than laundering it into a verdict. Two consumers then flattened it back, each in its own way, so the declared envelope never arrived.

**What changes on the wire.** Only on the path where the authorization store could not be READ — never when it legitimately returned no rows, and never for any other fault.

| door | before | after |
| --- | --- | --- |
| `GET /api/v1/storage/files/:fileId/url` | `403 FILE_DOWNLOAD_DENIED` / `403 ATTACHMENT_DOWNLOAD_DENIED` | `503 SERVICE_UNAVAILABLE` |
| `GET /api/v1/storage/files/:fileId` | same 403, and no redirect | `503 SERVICE_UNAVAILABLE`, still no `Location` |
| `GET /api/settings` | `500 INTERNAL_ERROR` | `503 SERVICE_UNAVAILABLE` |
| `GET /api/settings/:namespace` | `500 INTERNAL_ERROR` | `503 SERVICE_UNAVAILABLE` |
| `PUT /api/settings/:namespace` | `500 INTERNAL_ERROR` | `503 SERVICE_UNAVAILABLE` |
| `POST /api/settings/:namespace/:actionId` | `500 INTERNAL_ERROR` | `503 SERVICE_UNAVAILABLE` |

The storage row is the one worth reading twice: an outage was answered as a **permission denial**, byte-indistinguishable from a genuine refusal, which is the precise confusion the loud-outage discipline exists to prevent. The message now names the object whose read failed and says in words that this is not a permission denial.

**What does NOT change.** The security posture is identical — these doors were already fail-CLOSED and still are, and the storage gate still mints no capability on an outage. Every other refusal keeps its status and code: `deny` is still `403`, `unauthenticated` still `401`, an unknown namespace still `404`, a forbidden settings context still `403`, and any fault that is not this branded outage still lands on the same untyped `500 INTERNAL_ERROR` tail it did before. The repair is scoped to the brand, not to "anything carrying a status".

**Why `patch` and not `minor`.** No API is added, removed or renamed; no exported signature moves; no authorable key changes. This is a released package delivering an envelope it already declared — a bug fix, which this repo bumps `patch`. The change *is* observable, which is why the FROM → TO table above is in the changeset body rather than encoded in the bump: a version number carries no mapping, and this text is what an upgrading consumer greps in `CHANGELOG.md`.

**If you branch on these statuses.** A client that treated the storage `403` as "this user may not have this file" was, during an outage, retrying or re-authenticating against a fault that no credential could fix; it should now treat `503` as retryable and leave the caller's permissions alone. A client that treated the settings `500` as an unrecoverable server error can now distinguish a transient store outage from a genuine internal fault.
