---
"@objectstack/cli": patch
---

`bin/run.js` no longer states Node's `console.error` protection as an unconditional fact — it is conditional, and the condition is a property of the process's listener census rather than of `console.error`.

The docblock over that file's `process.stderr` `error` listener explained the last row of its measurement table with "`ignoreErrors` … parks a temporary `error` listener across the write — so oclif's warning blocks cannot crash this process at any size". Both halves needed correcting, and only the second one was visible:

- The listener parked *across* the write is not what saves anything. `kWriteToConsole`'s `finally` removes it before the completion arrives. What keeps the process alive is Console's write CALLBACK re-attaching a `noop`, and it does that only `if (stream.listenerCount('error') === 0)`.
- That count is 0 on this entry point and is not universal. `bin/run-dev.js` runs under `tsx`, which registers an off-thread module-customization hook; node pipes that worker's stderr into `process.stderr` and `Stream.prototype.pipe` prepends its own `onerror` there. With the count at 1 the keep-alive is never installed, `onerror` takes the first EPIPE and re-emits it with nothing listening, and **one short `console.error` crashes the process 3/3** — no payload size involved.

Measured on node 22.22.2 against a destroyed read end, one variable changed between the legs: `console.error` alone 0/3, `module.register()` of a no-op hook plus the same `console.error` 3/3, a raw `process.stderr.write` 3/3.

Comment text only. No behaviour, no accepted arguments, no exported member and no runtime contract changes; the listener itself, its name and the pin that waits for it are untouched. It publishes because npm packs a `bin` target regardless of `files[]` (#14874) — measured: the tarball ships `bin/run.js` verbatim and the corrected prose is in it — which is why this is a `patch` rather than a `skip-changeset`.
