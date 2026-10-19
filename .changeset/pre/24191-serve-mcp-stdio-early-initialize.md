---
'@objectstack/cli': patch
---

Clause-②: no

fix(cli): `os serve` with the stdio MCP transport and no config argument answers the `initialize` an MCP client writes when it spawns the server, and boots the configured app

- **What was wrong.** An MCP client writes `initialize` to the server's stdin as soon as it spawns it. The CLI's argument parser fills an omitted positional argument from a pending stdin line, and `os serve`'s config path is an optional positional. So, started without a config path, `os serve` took the client's `initialize` as its config path. In a project with a compiled `dist/objectstack.json`, it printed `No objectstack.config.ts found — booting from artifact`, booted without the config's own plugins, and never answered `initialize`. `os start` already named the path when it started `os serve`; this is the same defect for `os serve` started directly.
- **What changed.** `os serve` no longer reads its config path from stdin. Without the argument it uses `objectstack.config.ts` in the working directory, as its help says, and the client's first message stays in the pipe for the stdio transport. Reading the config path from stdin was never documented, and no script, test or doc in this repository relied on it; to serve another config, pass its path as the argument.
- **Unchanged:** the flags and environment variables of `os serve`, and which config and artifact a boot uses when the path is given or when nothing waits on stdin.
