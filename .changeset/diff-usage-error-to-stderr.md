---
"@objectstack/cli": patch
---

`os diff` with no path arguments no longer prints its usage error on stdout — in either face.

The refusal sat **above** the command's first `if (!flags.json)`, so the face was still undecided when it ran and it fired in **both**. `printError` plus three `console.log` calls — all four writing to stdout — then `process.exit(1)`. Measured on the published entry `bin/run.js` with `NO_COLOR=1` and the streams captured separately, `os diff --json` and bare `os diff` answered byte-identically: exit 1, **141 bytes of prose on stdout, an empty stderr**, and `JSON.parse(stdout)` throwing on the one stream `--json` reserves for the machine.

The diagnostic now goes to stderr, where the rest of this CLI's diagnostics already go. The 141 bytes moved intact — stdout 141 → 0, stderr 0 → 141. Nothing else moves:

- **the exit code is still 1**, so a consumer branching on exit status sees no change at all;
- **the wording is unchanged**, both usage hints included, so a human reading a terminal sees the same four lines;
- **nothing is accepted or rejected differently** — no invocation that worked before fails now.

⚠️ **No error payload is invented on this path.** What a `--json` consumer should *receive* on a refusal is an open envelope question, entangled with `os lint --eval --json`'s bare `{ error }` (no `code`, no `httpStatus`), and it is deliberately left open here — this change settles only that the machine's channel no longer carries prose. `--json` on this path emits nothing on stdout; a consumer must still read the exit status, exactly as it must today.

This is the sibling of the `resolveConfigPath` repair, and a genuinely different site: that one is reached through `loadConfig()`, this one is `diff.ts`'s own usage error, raised before any config work happens. The existing pin drives `os diff` with two paths precisely so the run gets *past* this check, so it could not see this path. A new pin (`diff-usage-error-stream.e2e.test.ts`) drives the bare form in both faces, and carries a structural tripwire: across 62 command modules, 27 of which offer `--json`, `diff` was the only one with a stdout write above its guard, and the tripwire goes red if another arrives.
