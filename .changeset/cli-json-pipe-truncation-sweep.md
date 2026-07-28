---
"@objectstack/cli": patch
---

fix(cli): finish the `--json` truncation fix — every command, and the second document it was hiding (#3780 follow-up)

#3780 routed three commands through `emitJson`. The other ~100 emission sites
still wrote machine output with `console.log`, which on a **pipe** is cut off
at one 64 KiB buffer when the command exits right after: Node buffers pipe
writes asynchronously and the exit tears the process down mid-drain. It is
invisible to whoever writes it — stdout to a TTY is synchronous, so every
interactive run looks perfect while every scripted consumer, the only audience
`--json` has, gets invalid JSON.

The exit does not have to be an explicit `process.exit`. oclif ends failing
commands with `handle()` → `Exit.exit()` → `process.exit()` and flushes
nothing on that path (`flush()` runs only on `execute()`'s success path), so a
plain `this.exit(1)` — or any thrown error — truncates identically. 73 of the
104 sites had exactly that shape. Even `lint` was only half fixed: `--eval
--json` writes a whole corpus report and was still on `console.log`.

All 104 sites now go through `emitJson`, `formatOutput`'s `json`/`yaml`
branches through the same drain-aware write (`--format yaml` truncated too),
and an ESLint rule keeps the pattern from growing back one command at a time.
Control flow is untouched — a following `this.exit(1)` stays, it is simply
safe once the buffer has drained. Output bytes are unchanged: roughly half the
sites emitted compact and half indented, and each keeps whichever it had.

**Draining the write exposed a second defect underneath it.** Because
`this.exit(1)` *throws*, a command whose body sits in one `try` unwinds its
inner "report and stop" into the outer `catch`, which reports again — so
`os validate --json` on a failing config printed **two** JSON documents, which
is neither valid JSON nor valid JSONL. Truncation had been hiding the second
one. Nine commands had this shape; their catch clauses now re-throw the exit
signal (`isExitSignal`) instead of describing it as a failure.

Measured on `os validate --json` against a config with 900 schema errors,
piped:

| | bytes | parses |
|---|---:|---|
| before | 131072 (exactly two buffers, cut mid-string) | no |
| truncation fix alone | 1514711 (two documents) | no |
| both fixes | 1514648 (one document, 900 errors) | **yes** |

Pinned end to end: a real command, a real pipe, a payload past several
buffers — plus a control case asserting the `console.log` pattern it replaced
genuinely truncates, so the gate cannot quietly stop testing anything.

Not covered: the ~30 human-facing `console.log` paths, which are unaffected,
and `os serve` / `os dev` logging. This is deliberately not fixed by forcing
stdout into blocking mode process-wide, which would be one line and cover
everything — the same binary runs the dev server, and a blocking write to a
pipe with a slow reader blocks the event loop, trading truncated JSON for a
server that stalls on its own logs.
