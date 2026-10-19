---
'@objectstack/cli': patch
---

Clause-②: no

fix(cli): `os start` with the stdio MCP transport answers the `initialize` an MCP client writes when it spawns the server, and boots the configured app

- **What was wrong.** An MCP client writes `initialize` to the server's stdin as soon as it spawns it. `os start` hands its stdin down to the processes it starts, and the CLI's argument parser fills an omitted positional argument from a pending stdin line. So the client's `initialize` became a config path. In a project with no `dist/objectstack.json`, the automatic compile step failed with `Config file not found: …/{"jsonrpc":"2.0",…}` and `os start` exited 1. In a project with a compiled artifact, the server printed `No objectstack.config.ts found — booting from artifact`, booted without the config's own plugins, and never answered `initialize`.
- **What changed.** The automatic compile step now gets no stdin, and `os start` names the config path when it starts `os serve` (the same `objectstack.config.ts` in the working directory that `os serve` used by default). The client's first message stays in the pipe for the stdio transport, and the config is loaded.
- **Unchanged:** the flags and environment variables of `os start`, `os serve` and `os compile`, and which config and artifact a boot uses.
