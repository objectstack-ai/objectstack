---
'@objectstack/cli': patch
---

fix(cli): `os serve` no longer hangs after binding its port when its runtime state file's directory can never be made

Clause-②: no

This covers the runtime state file that the entry `fix(cli,runtime): a state, output or cache directory that can never be made is refused at once, naming the path and the operating system's code, instead of hanging` lists as `Not covered yet`.

**What was wrong.** Once listening, `os serve` writes its runtime state file, `runtime.<environment>.<project>.json`, into `OS_HOME` before it prints the ready banner. It made that directory with Node's recursive `mkdir`, which never returns when a level answers `ENOENT` although its parent exists, as `/proc` and `/sys` answer for a name they do not have. Under such an `OS_HOME`, with the database outside it, the server bound its port and then looped in its own process, holding the event loop: no `Press Ctrl+C to stop`, no listening message to an `os dev` parent, and no request answered.

**What an operator sees now.** The directory is made with the same bounded walk as the other `OS_HOME` paths, so a directory that can never be made is refused at once. The state file has always been best-effort: the boot goes on without it and prints its banner, as it already did when the file could not be written for any other reason.

Nothing else changes. Every state file written before is still written, in the same place, before the banner; a home that can be made is still made, every missing level of it.
