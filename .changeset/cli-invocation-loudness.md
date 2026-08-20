---
"@objectstack/cli": patch
---

Two ways to invoke the CLI wrong used to present as a crashed boot. Both now say what they are.

`node packages/cli/dist/index.js` — the package `main`, which is a re-export barrel — ran to completion, printed nothing and exited 0. Backgrounded, that is indistinguishable from a server that came up and died. It now writes two lines to stderr, the first saying that running this file starts nothing and the second naming `bin/run.js` as the CLI entry point, and exits 1.

A rejected invocation such as `objectstack dev --no-ui` answered with oclif's error line followed by a full usage dump, and in a background log the dump is what the eye lands on. One line now goes to stderr ahead of it:

```
objectstack: INVOCATION ERROR — Nonexistent flag: --no-ui. The command never ran: nothing was started and nothing is listening. Invoked as: objectstack dev --no-ui
```

No flag surface changed: `dev` still rejects `--no-ui` (only `serve` declares `ui` with `allowNo`). What changed is what the CLI says when it rejects an invocation.
