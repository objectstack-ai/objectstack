---
'@objectstack/cli': patch
---

fix(cli): a config that fails to load is no longer reported as "Compile failed"

Clause-②: no
Metadata-protocol: none

When the `os compile` child that `os dev`, `os start`, `os serve --dev` and `os environments bind --build` run exits non-zero, the closing line said `Compile failed — fix errors above …`. The parent sees only the child's exit status, so the same line followed a refusal raised while `objectstack.config.ts` loads (for example a licence or key-management refusal), and an operator went looking for a code error.

The line now says what is true of every way the child fails, a syntax error, a refusal thrown at load or a refusal that prints and exits: `objectstack.config did not load or compile — the reason is printed above; fix it before …`, with each command's own tail (`starting dev server`, `starting the server` with the `--artifact` hint, `starting the dev server.`, `binding`). The `os dev` watch recompile's failure line reads `✗ objectstack.config did not load or compile (Nms)` in place of `✗ compile failed (Nms)`, with the compile output after it as before. Nothing classifies the failure: exit statuses, error codes and the text the child prints are unchanged.

A script that matched `Compile failed` in this output should match `did not load or compile`.
