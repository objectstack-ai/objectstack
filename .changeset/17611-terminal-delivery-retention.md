---
'@objectstack/service-messaging': minor
---

`sys_notification_delivery` reaps its terminal-failure rows after **7 days** instead of 90 (#17611)

**⚠️ Operational consequence, stated plainly: `dead` and `suppressed` delivery rows are now deleted 7 days after they were created.** Any report, SLA reading, dashboard or manual investigation that consulted them — "which notifications failed to send, and why" — must now read inside that window. Before this change those rows survived for 90 days. Nothing else about the table changes: `pending`, `in_flight` and `success` rows keep the same 90-day window they have always had, and no row is reaped sooner than before except the two terminal-failure statuses.

**What was wrong.** Fan-out writes one delivery row per `(event × recipient × channel)`. A tenant with no transport configured for one of those channels dead-letters that channel's row on its **first** attempt, and every `notify` writes another one. Measured on a production tenant: 2,876 `email`/`dead` rows against 2,876 `inbox`/`success` rows, `max(attempts) = 1`, zero pending, growing +316 rows/day. Those rows carry no work — nothing ever claims, retries or acks them again — but they sat in the table the dispatcher's claim query reads on every hop for the full 90-day window, so the cost of every claim rose linearly with time.

**The change** is one declaration on the object, using spec keys that already ship and are already consumed by the platform Reaper:

```ts
lifecycle: {
    class: 'telemetry',
    ttl: { field: 'created_at', expireAfter: '90d' },
    retention: {
        maxAge: '7d',
        onlyWhen: { status: { $in: ['dead', 'suppressed'] } },
    },
},
```

`retention.onlyWhen` scopes the short window to the terminal-failure statuses — the same shape `sys_job_queue`, `sys_automation_run` and `sys_upload_session` already declare. No channel interface member, no new status value, no change to fan-out.

The `ttl` leg is not new behaviour: it restates the 90-day bound the object has always declared. `lifecycle.retention` is a single block, so scoping it to terminal rows would otherwise have left `pending` / `in_flight` / `success` with **no age bound at all** — unbounding the larger half of this table's growth on the very change that exists to bound it. Both legs run: `LifecycleService.reapObject` takes `ttl` and `retention` in independent branches. `success` is deliberately outside the scope; delivery history stays at the table window.

**If you override this object's lifecycle windows through the `lifecycle` settings namespace, re-read your configuration.** `retention_overrides.maxAge` for `sys_notification_delivery` used to move the whole table's window; it now moves the **terminal-failure** window only, and `expireAfter` moves the table window. An override left in place keeps parsing and keeps applying — to a narrower set of rows than it did before.

**⚠️ This is worth nothing where the Reaper does not run.** The whole benefit is delivered by `LifecycleService`, which `OS_LIFECYCLE_DISABLED=1` or the plugin switch turns off. A deployment with lifecycle disabled kept these rows forever before this change and keeps them forever after it; a declaration is not a sweeper. Check that the Reaper is enabled before reading this entry as a bound on your table.
