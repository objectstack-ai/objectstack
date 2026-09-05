---
"@objectstack/cli": patch
---

`os validate|info|diff|lint|compile|build|verify|migrate meta|i18n check|i18n extract --json` no longer print human text on stdout when the config file is missing.

`resolveConfigPath()` emitted both of its refusals — the explicit-path miss and the auto-detect miss — through `printError` and `console.log`, **both of which write to stdout**, and then called `process.exit(1)` directly. Ten published `--json` faces reach that helper, so a missing config file answered them with exit 1, an unparseable stdout and an **empty stderr**: 206 bytes of prose on the one stream `--json` reserves for the machine. And because the exit was called rather than thrown, every command's catch-all `--json` error exit — all of which sit downstream of a throw — never ran.

The diagnostic now goes to stderr, where the rest of this CLI's diagnostics already go. Nothing else moves:

- **the exit code is still 1**, so a consumer branching on exit status sees no change at all;
- **the wording is unchanged**, hints included, so a human reading a terminal sees the same three lines;
- **nothing is accepted or rejected differently** — no config that loaded before fails now, and none that failed now loads.

⚠️ **No error payload is invented on this path.** What a `--json` consumer should *receive* when the config file is missing is an envelope question that touches ten published faces at once, and it is deliberately left open here — this change settles only that the machine's channel no longer carries prose. `--json` on this path emits nothing on stdout; a consumer must still read the exit status, exactly as it must today.

A new pin (`config-miss-stdout-purity.e2e.test.ts`) drives all ten faces on both branches of the helper. The existing purity pin could not: it discovers its family as the commands that call `bootSchemaStack`, and these fail before any kernel boots.
