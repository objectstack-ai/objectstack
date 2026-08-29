---
"@objectstack/cli": patch
---

fix(cli): `os start --port` now wins over `$OS_PORT`, and `start` stops printing an address it is not serving (#12992)

`os start --port N` printed `N` and then bound something else, whenever
`$OS_PORT` was set. Measured on a real boot before the repair:

```
OS_PORT=41077 os start --port 41078
  banner:           Console: http://localhost:41078/_console/
  curl answers on:  41077
```

Two independent halves, both repaired.

**The forwarding channel.** `start` wrote the flag into the child's `PORT` and
never cleared the inherited `OS_PORT` beside it. The `serve` child resolves
`readEnvWithDeprecation('OS_PORT', 'PORT')` — `OS_PORT` first — so an explicit
`--port` travelled on the channel its own child ranks **last** and lost to an
environment variable the flag's help text says it overrides. The child's
precedence was correct and is unchanged; the parent now writes the canonical
`OS_PORT` together with its `PORT` alias, so the flag arrives first in the order
the child already reads and every other reader of the child's environment
(app code and libraries that read `process.env.PORT` directly) sees the same
port. No deprecation notice is reachable from either spelling: `OS_PORT` is the
*preferred* name of that pair, and every read site passes `{ silent: true }`.

Same edit fixes `os start --port 0`, which a falsy guard used to drop entirely —
`0` is a legal port that asks the kernel for a free one (`MIN_PORT = 0`).
Measured before: `os start --port 0` printed `http://localhost:0/_console/` and
bound the inherited `41077`.

**The lying banner.** `start`'s `Console:` row was a *second* resolution of a
question the child answers for itself, computed with the opposite precedence and
reconciled with nothing. It also asserted a mount it could not know: on the same
boot, `/_console/` answered **404**, because whether a Console is served depends
on the `ConsoleUI` plugin loading in the child. Both facts belong to `serve`,
which already states them together after its `listen()` — the `API:` row always,
the `Console:` row when the plugin actually loaded, both addressed through the
external-base resolver. So `start` no longer prints an address at all, and the
one address it used to print is gone rather than recomputed.

**User-visible:** `os start` prints one fewer row before the server boots. The
Console URL now comes from the `serve` ready banner, after the bind, and appears
only when a Console is really mounted. Because it is derived from the actual
bind rather than predicted, it is also correct under causes this change does not
touch, including the development auto-shift off a busy port.
