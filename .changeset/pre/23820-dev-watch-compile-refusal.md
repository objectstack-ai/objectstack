---
'@objectstack/cli': patch
---

fix(cli): `os dev` (and `pnpm dev` on a scaffold) prints why a watched save was refused, not only `✗ compile failed`

Clause-②: no

When a saved file makes the compile refuse, the watcher now prints the compile's output under its failure line: the same lines `pnpm build` prints on that tree, without `--verbose`.

- **Before.** On a fresh `os init my-app -t app` scaffold (namespace `my_app`), saving an object named `task` printed `↻ recompiling (2 files)...` and then a bare `✗ compile failed (3782ms)`. The reason never appeared. The compile writes its refusals to stdout, and the watcher discarded stdout and printed stderr only.
- **After.** The failure line is followed by the compile's stdout, then its stderr. For that save it shows `✗ Object 'task' is missing the package namespace prefix. Rename it to 'my_app_task' (namespace = 'my_app').` and the lines around it.

What does not change: a successful recompile prints exactly what it printed before, and the compile's progress output stays hidden on success. `--verbose` still passes the compile's output straight through, so on a failure nothing is printed twice. A failed compile still writes no artifact and still triggers no restart.
