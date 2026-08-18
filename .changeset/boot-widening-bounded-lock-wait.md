---
"@objectstack/driver-sql": patch
---

fix(driver-sql): boot schema-sync's MySQL widening ALTER bounds its metadata-lock wait too — a blocked boot warns and carries on instead of hanging for a year (#9542)

#9354 bounded `lock_wait_timeout` to 120s on the widening `ALTER TABLE … MODIFY
COLUMN` and made a blocked `os migrate apply` refuse loudly — but only while
`flushDeferredSchemaDdl` was running. The same two widenings
(`migrateMysqlDatetimeColumns` / `migrateMysqlTimeColumns`, #3942 / #3994) are
reached from **boot schema-sync** through the same `initObjects` lines, and on
that path the `runWideningAlters` seam returned early: the ALTER ran through the
pool inheriting MySQL's own default `lock_wait_timeout` of **31,536,000 seconds
— one year**.

So a single other session holding a metadata lock on the table parked boot at
schema-sync for that long, printing nothing — indistinguishable from a crash.
The widening's own `logger.warn` could not help, because it lives in a `catch`
and an ALTER that never returns is never caught.

The bound is now armed **unconditionally** in that seam. What stays gated on the
flush is the **refusal**, and only it: boot still swallows. Correctness never
depends on the widening having run and a migration must never take boot down, so
throwing there would trade a silent hang for a failed boot — a different answer,
not the same one.

**What changes for a deployment.** On MySQL, a boot whose widening ALTER is
blocked on a metadata lock now waits at most 120s, then logs
`[sql-driver] could not widen MySQL datetime columns on …` (or its `TIME(3)`
twin) naming the table, with the server's own `Lock wait timeout exceeded` as
the `error` field — and boot carries on. The widening is idempotent, so the
first boot after the blocker is gone completes it. Nothing changes on any other
dialect, on an ALTER that is not blocked, or for `os migrate apply`, which keeps
#9354's `DATABASE_ERROR` / 500 refusal.

120s is #9354's number, kept for boot deliberately rather than lengthened: the
reasoning behind it is about how long a legitimate metadata-lock holder can
plausibly hold the lock, which is a property of the lock and not of who is
waiting on it. Boot's difference from the flush is what happens when the bound
fires, never how long it waits. No retry logic and no configurability — the
2026-08-17 ruling's minimality, unchanged.
