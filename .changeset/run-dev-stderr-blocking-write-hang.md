---
"@objectstack/cli": patch
---

fix(cli): `run-dev.js` can no longer freeze in the kernel when its stderr reader stops reading

Over an unbuilt workspace with the read end of its output alive but not being
drained, the dev entry point is contracted to give up and exit 2 rather than
wait. Intermittently it did neither: it stayed alive past every ceiling and
ended only when something killed it — 27 of 30 runs on a cold `tsx` transform
cache, against 1 of 90 on a warm one.

The bound that was supposed to stop it (`STDERR_DRAIN_STALL_MS`, polled by a
50 ms `setInterval`) was not late; it was unreachable. Sampled from outside the
process, the main thread was parked inside `write(2)` on fd 2 with `O_NONBLOCK`
clear on that file description, so the event loop was not running and no timer,
callback or promise in the file could fire. No ceiling of any size separates
that from a wait, which is why raising and re-deriving one never helped.

The flag is not stable and nothing in this repo clears it: node sets
`O_NONBLOCK` when it opens the pipe, and libuv clears it again in the pre-exec
of any child spawned with inherited stdio — and because inheriting is `dup2`,
the flag lives on an open file description the spawner shares, so the spawner
loses it too. Under `tsx` that child is the esbuild service, started when a
module has to be transformed, which is why a fresh CI checkout hits this and a
warm developer box almost never does. Measured on one run: `O_NONBLOCK` true at
102 ms, false at 1132 ms in the same sample the esbuild service appears in, main
thread in `write(2)` from 2730 ms and never out of it.

`bin/run-dev.js` now re-asserts non-blocking mode on the write path before each
stderr write, which cannot be outrun by a later spawn the way a one-shot at
startup can. This is the inverse of the `setBlocking(true)` both this file and
`src/utils/format.ts` refuse: it is what keeps their shared premise — that a
write to a pipe gets buffered rather than parking the thread — true.

`bin/` is not named in this package's `files`, so only `bin/run.js` (the `bin`
target) is packed: no published byte changes here.
