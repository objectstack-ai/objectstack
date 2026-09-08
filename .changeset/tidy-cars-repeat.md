---
'@objectstack/cli': patch
---

Stop the published CLI from dying of an uncaught `write EPIPE` when its caller's stderr read end is gone.

`bin/run.js` — the file `bin.objectstack` / `bin.os` point at, and the only thing under `bin/` npm packs — now attaches the same no-op `error` listener to `process.stderr` that the in-repo dev shim has carried since the original finding. `process.stderr` is an `EventEmitter`, so an `error` event with nothing listening is an uncaught exception.

Measured on the published entry with the read end destroyed (`stdio: ['ignore','ignore','pipe']`, then `child.stderr.destroy()`), traced with an observer that installs no listener and wraps no write:

```
uncaughtException  code=EPIPE  msg=write EPIPE
      at afterWriteDispatched (node:internal/stream_base_commons:159:15)
exit  code=1
```

3 of 3 runs, 3049-3433 ms in, on `os serve` over `examples/app-todo`. Read by a draining parent the same child boots and serves and exits 0, having written 7926 bytes over 16.6 s — so the crash was costing the run at its first diagnostic line and 20 of its 21 stderr writes. Failing invocations do not reach it: everything they put on stderr is written after `run()` has settled, by a handler that exits on top of its own report.

Behaviour change worth knowing about: a long-running command (`os serve`, `os dev`, `os start`) whose reader has gone now keeps running and reports its own exit status, instead of dying on its first diagnostic write. A supervisor that destroyed the read end and relied on that crash to end the child needs to end it itself.
