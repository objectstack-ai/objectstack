---
'@objectstack/cli': patch
---

fix(cli): `os start` forwards SIGTERM and SIGINT to its `serve` child and takes the child down when it exits

Clause-②: no

`os start` runs the server as a separate `serve` child process. It used to
listen for that child's exit and nothing else. A SIGTERM or SIGINT sent to the
`start` process alone (a plain `kill`, `docker stop`, a systemd stop, a CI step)
ended `start` and left `serve` running with no parent. The port stayed bound,
`/health` kept answering 200, and the next start on that port collided with it.

`os start` now supervises its child the way `os dev` already does, through the
same mechanism:

- SIGTERM or SIGINT to `start` is forwarded to the child. `start` waits for the
  child to shut down, then exits with the child's exit code, which is 0 after a
  graceful shutdown. It used to die on the signal at once (shell status 143 for
  SIGTERM, 130 for SIGINT) while the child kept running.
- Whatever else ends `start`, the child is sent SIGTERM on the way out.
- A child that exits on its own still ends `start` with the child's exit code,
  as before.

One visible side effect, the same one `os dev` already has: Ctrl-C at a terminal
signals `start` and the child together, so the child now receives SIGINT twice
and logs one `Shutdown already in progress, ignoring SIGINT` warning. The
terminal prompt also returns only after the server has stopped, not before.

No flag, port, environment variable, banner line or `os dev` behaviour changes.
