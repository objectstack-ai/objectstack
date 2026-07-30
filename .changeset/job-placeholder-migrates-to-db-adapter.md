---
'@objectstack/service-job': patch
---

Jobs registered before `kernel:ready` now survive the placeholder→DbJobAdapter upgrade.

Business plugins `start()` before the JobServicePlugin's `kernel:ready` hook, so every schedule they register lands on the placeholder IntervalJobAdapter. That placeholder silently ignores `cron` schedules, and the upgrade used `replaceService` without migrating anything — so in the default configuration a plugin's cron jobs never ran at all, while its interval timers kept running on the orphaned placeholder, invisible to `sys_job`. The upgrade now snapshots every early registration, stops the placeholder, and re-schedules them on the DbJobAdapter (whose croner-backed cron routing makes the cron entries actually fire). The IntervalJobAdapter also warns per cron registration, and the no-engine path summarizes stranded cron jobs instead of staying silent.
