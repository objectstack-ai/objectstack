---
'@objectstack/cli': patch
---

`os serve` says once when it cannot write its runtime state file, naming the file and the operating system's error, and goes on booting

Clause-②: no

- **Before:** when `runtime.<environment>.<project>.json` could not be written — an `OS_HOME` under `/proc`, or one below a regular file (`ENOTDIR`) — the write's catch printed nothing. The boot printed its ready banner, an `os dev` parent got its `objectstack:listening` message, and a supervisor that then read the file got `ENOENT` with no reason anywhere.
- **Now:** one warning on stderr, among the other boot warnings and before the banner, names the file it could not write and carries the operating system's error verbatim (for example `ENOTDIR: not a directory, stat '…'`). It says the server runs on without the file and that `OS_HOME` must point at a directory the process can write.
- **Unchanged:** the file stays best-effort, so the boot never fails on it; its name, its payload and its removal on exit; the banner and the IPC message; stdout, which stays the stdio MCP transport's alone.
