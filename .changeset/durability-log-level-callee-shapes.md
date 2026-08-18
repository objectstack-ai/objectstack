---
"@objectstack/plugin-audit": patch
"@objectstack/plugin-email": patch
"@objectstack/plugin-security": patch
---

A durability failure reported to a logger without `error` is no longer lost

Six degradation reports — a lost `sys_audit_log` row (CRUD, auth-event and
read-audit writers), a stranded `sys_email` row, and the two permission-set
metadata backfill failures — were spelled `logger?.error?.(…)`. `error` is
declared OPTIONAL on those sinks, and an optional call emits nothing at all when
the method is absent: a host injecting a `{ info, warn }` logger received no
report whatsoever, on exactly the paths whose whole point is that nothing else
looks broken afterwards.

Each now reaches for `error` and falls back to `warn`, never to silence. The
message, its consequence and its fix are identical on both channels; only the
level degrades, and only when the sink cannot do better.

`AuthEventAuditLogger` additionally declares the `warn?` method it needs for
that fallback, matching `ReadAuditLogger`, which always had it. The addition is
optional, so no existing sink stops satisfying the interface.
