---
'@objectstack/cli': patch
---

Clause-②: no

fix(cli): on a first run, `os start` writes its compile step's progress to stderr, so stdout carries only the stdio MCP transport's JSON-RPC frames

- **What was wrong.** With `OS_MCP_STDIO_ENABLED=true`, stdout is the stdio MCP transport's protocol channel, and an MCP client parses every line it reads there as JSON-RPC. `os start` already writes its own banner and progress to stderr, but in a project with no `dist/objectstack.json` it compiles the config first, and that compile step wrote its progress (`◆ Compile`, `✓ Build complete`, `Artifact: …`, 24 lines for a one-object app) to stdout, ahead of the answer to the client's `initialize`.
- **What changed.** The automatic compile step's output now goes to stderr, next to the rest of `os start`'s own output, with or without the stdio transport. Nothing is dropped: the same lines still print, on stderr.
- **Unchanged:** the flags and environment variables of `os start` and `os compile`, when `os start` compiles, the artifact it writes, and `os compile`'s own output when you run it directly.
