---
"@objectstack/cli": patch
"@objectstack/mcp": patch
---

fix(cli): `os serve` writes its banner, boot progress and kernel logs to stderr, so the stdio MCP channel carries only protocol (#7915)

With `OS_MCP_STDIO_ENABLED=true`, `objectstack serve` used `process.stdout` as
the MCP JSON-RPC channel **and** as its ordinary human/log output. MCP stdio
framing is newline-delimited JSON — a conforming client `JSON.parse`s every line
it reads off the server's stdout — so every banner line and every `INFO`/`WARN`
record reached the client as a transport error. Measured on the card's repro:
the `initialize` result arrived on **line 517**, behind 516 lines of
non-protocol text. It reads as "the transport is broken", which is also why it
stayed invisible until #7645 (PR #7914) made the transport answer at all.

**`serve`'s stdout is now the protocol's, and nothing else's.** Banners, boot
progress and kernel logs are diagnostics, not program output, and stderr is
where a CLI puts diagnostics — so they go there whether or not a stdio
transport is mounted. Two halves:

- every human line `serve` prints is written to stderr explicitly, the startup
  banner (`✓ Server is ready`, the plugin table, `Press Ctrl+C to stop`) and the
  boot-diagnostics replay included;
- everything else the process would write to stdout — `ObjectLogger`'s
  `debug`/`info`/`warn` records, and the stray `console.log`s several packages
  emit during boot — is forwarded to stderr for the life of the process, the
  same route `--json` already takes (#6217). `LoggerConfig` has a level but no
  destination knob, so the stream itself is the only seam that covers writers
  the CLI does not own.

**Unconditional, deliberately.** "Redirect when the stdio transport is active"
needs a reliable signal at the moment each line prints — before the config is
read, before the plugin is loaded — and fails silently and in the worse
direction when that signal is wrong or late: a frame-corrupting line that shows
up only in some boots is far harder to find than one that always does. In a
terminal the move costs nothing, since both streams render.

**Nothing is silenced.** Every line still appears, on stderr — including the
boot-phase warnings #4012 rescued from the quiet window. A shell that captured
both streams (`> log 2>&1`) sees exactly what it saw before; one that captured
stdout alone now finds `serve`'s output on stderr.

`@objectstack/mcp`: the stdio transport now holds its own channel to the real
stdout instead of writing through `process.stdout` — a host that intercepts
`process.stdout.write` to move its diagnostics (which is what `serve` does)
would otherwise swallow the protocol frames along with them. It claims that
channel in every host and on every construction path, so a transport's frames
never depend on who booted the plugin.
