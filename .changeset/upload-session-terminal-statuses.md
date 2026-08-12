---
'@objectstack/service-storage': patch
'@objectstack/spec': patch
---

storage: `sys_upload_session.status` `failed` / `expired` now have producers

Both statuses were declared on the object, reaped on by the retention backstop
(`onlyWhen: { status: { $in: ['completed', 'failed', 'expired'] } }`), and
published to clients by `UploadProgressSchema` — while nothing in the service
ever wrote either one. A scan of every session row could only return
`in_progress` / `completed`, so retention named two states the system could not
enter. Under ADR-0049 (enforce-or-remove) this takes the enforce branch:
removing them would have forked the object from the spec's progress contract,
and the two failure states they name are real.

- **`failed`** — a chunked completion whose backend `completeChunkedUpload`
  threw left the row at `completing`: a non-terminal status the 7d retention
  backstop never reaped, and one a progress poll reported as "still assembling"
  forever. The completion route now stamps `failed` on that path. It records an
  attempt rather than locking the session — a retry of the same `uploadId` runs
  the happy path and overwrites it with `completed`.
- **`expired`** — a session past its own `expires_at` kept answering
  `in_progress` and kept accepting chunks until the TTL sweep deleted the row
  out from under the caller, so the deadline the init response already announced
  (`expiresAt`) bound nothing. A chunk `PUT` or a `complete` against an
  overdue session is now refused with **410 `UPLOAD_SESSION_EXPIRED`** (new code,
  registered under `@objectstack/service-storage` in `ERROR_CODE_LEDGER`) and the
  row is durably stamped `expired`. `GET .../progress` reports the status instead
  of refusing — `expired` is a declared member of `UploadProgressSchema.status`,
  and the SDK's `resumeUpload` reads progress first.

A session with no `expires_at` carries no declared deadline and is left alone,
and a `completed` row does not become `expired` by waiting for the reaper.
