---
"@objectstack/cli": patch
---

`os migrate plan` / `os migrate apply` exit when their work is done

Measured on ObjectStack Cloud's staging control plane, inside `docker run --rm`: the CLI finished in 4.3 seconds and printed its own `Graceful shutdown complete`, and the run was cancelled by hand **78 minutes later** — the shell's next statement never ran, so it was still blocked on that one `docker run`.

The composition these commands perform (#12938) registers a host's plugins for their DECLARATIONS: `init()` runs, `start()` is replaced with a no-op. Anything a host plugin arms during Phase 1 whose release would have been installed by Phase 2 — an interval, a pool, a watcher, a `kernel:ready` hook that starts a dispatcher — has no release path at all, so the event loop never drains while the kernel reports a clean shutdown.

Both commands now end the process deliberately once their document is written, after the kernel teardown they already ran. Chasing the handle instead would mean auditing host code this repo cannot see, which is the same argument that made the composition declaration-only in the first place. `stdout` and `stderr` are drained before the exit, so a `--json` payload on a pipe is not truncated — and the drain itself is bounded, so a pipe whose reader has gone away cannot become a second way for the command not to return.

Failure paths are unchanged: `this.exit(n)` throws an oclif `ExitError` that oclif's own handler already turns into a `process.exit`.
