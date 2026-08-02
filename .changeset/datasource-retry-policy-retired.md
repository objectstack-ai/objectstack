---
"@objectstack/spec": major
---

feat(spec)!: retire `datasource.retryPolicy` — nothing ever retried on it (#4583 batch B)

Four keys — `maxRetries`, `baseDelayMs`, `maxDelayMs`, `backoffMultiplier` — declared,
strict-guarded, and read by no connect or query path. Connection failure is handled by
the boot policy in the datasource connection service (degraded boot, or `bootCritical`
fail-fast); nothing retries on a schedule, so setting `maxRetries: 5` changed nothing.

**Do not "fix" this by renaming keys.** `hook.retryPolicy` and `job.retryPolicy` ARE
enforced — but they are a different key on a different type, and they spell the delay
`backoffMs`, not `baseDelayMs`. That very inconsistency is the evidence nothing read the
datasource one: no code in the repo reads both spellings. Moving these values onto a hook
or a job only makes sense if you actually want that hook or job retried.

FROM → TO: delete the block. `os migrate meta --from 16` removes it automatically
(conversion `datasource-inert-blocks-removed`). `DatasourceSchema` is `.strict()`, so a
leftover `retryPolicy` is a loud rejection carrying this prescription — never a silent
strip.
