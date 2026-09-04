---
"@objectstack/cli": patch
---

The published `os` binary no longer freezes in the kernel when whatever is reading its output stops draining.

Node puts the CLI's stderr on the non-blocking write path when it opens the pipe, so a write to a reader that has stopped is buffered rather than parking the thread. libuv clears that flag again in the pre-exec of every child spawned with **inherited** stdio — and inheriting is `dup2`, so the flag lives on an open file description the spawner shares. Clearing it for the child clears it for the CLI too.

Measured on the built binary, `os dev --verbose` with its output piped to a reader that stopped draining: `os dev` spawns `os serve --dev` with inherited stdio at 2.8 s, that child spawns the esbuild service with inherited stderr at 5.2 s, and fd 2 stays blocking for the rest of the run. 3.1 s after the reader stopped, the main thread sat in `write(2)` (`wchan=sock_alloc_send_pskb`), 4 of 4 runs — parked 28.9 s, **ignoring SIGINT while parked**, and released only when the consumer resumed. Not a crash and not a timeout: alive, idle, unresponsive, with an empty log. Anything that pipes `os dev` and reads it slowly — a CI log collector, a backgrounded runner, a supervisor that stops draining while it does work — could park the CLI this way.

`bin/run.js` now installs `keepStderrNonBlocking()` before oclif can write a byte. The guard re-asserts `O_NONBLOCK` immediately ahead of each write, which is what the measurement requires: the clearing that persisted was made by a **grandchild** the CLI does not spawn and cannot see, so a one-shot at startup would be undone silently and no change to the CLI's own spawn sites would have prevented it.

The guard itself is not new — it shipped in no published install. It lived at `packages/cli/bin/stderr-nonblocking.mjs`, and `files` names only `dist`, `README.md` and `CHANGELOG.md`; npm packs a `bin` **target** regardless of `files`, which is why `bin/run.js` reached every install and the module beside it reached none. It now compiles from `src/utils/stderr-nonblocking.ts` into `dist/`, under the whitelist that was already there.

Nothing about which arguments the CLI accepts, what it prints, or what it exits with changes. The refusal of `setBlocking(true)` in `src/utils/format.ts` stands and is untouched — this is its inverse, and what keeps its premise true.
