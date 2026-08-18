---
'@objectstack/driver-sql': patch
---

Report an un-run MySQL widening ALTER at `error`, naming the fix

Boot schema-sync widens legacy MySQL `TIMESTAMP` columns to `DATETIME(3)` and
zero-precision `TIME` columns to `TIME(3)`. When that DDL cannot run — most
often another session holding the table's metadata lock — the failure is
swallowed on purpose so a migration never takes boot down. It was reported at
`warn`.

That is the case AGENTS.md's degradation rule names for `error` by name: after
the swallow the platform boots, serves traffic and looks entirely normal, while
the DDL that was supposed to run did not. An un-widened `TIMESTAMP` keeps
truncating milliseconds and an un-widened `TIME` keeps rounding fractional
seconds to whole ones, against a canonical storage form that promises the
milliseconds are kept, and nothing else reports the column as outstanding.

Both lines now report at `error` and say what to do about it — identify the
metadata-lock holder, end it, then re-run `os migrate apply` or restart, the
widening being idempotent. Control flow is unchanged: the swallow stays, and
the deferred-DDL flush keeps its loud refusal.

`scripts/check-durability-degradation-log-level.mjs` gains `runWideningAlters`
in its durability vocabulary, so the class stays fixed rather than these two
sites.
