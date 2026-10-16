---
'@objectstack/cli': patch
'@objectstack/runtime': patch
---

fix(cli,runtime): a state, output or cache directory that can never be made is refused at once, naming the path and the operating system's code, instead of hanging

Clause-②: no

**What was wrong.** These commands and runtime paths created their directories with Node's recursive `mkdir`. Node's recursive mkdir never returns when a level answers `ENOENT` although its parent exists — what `/proc` and `/sys` answer for a name they do not have. It looped `mkdir("/proc/x")` and `mkdir("/proc")` without end, holding the event loop, so the command printed nothing more and no timeout could fire:

- `os start` with `--home` / `OS_HOME` on such a path hung after its header.
- `os serve` hung the same way on the empty-boot artifact stub under `OS_HOME`, and on the cache of an `http(s):` `OS_ARTIFACT_URL` under `OS_HOME`.
- `os create --dir`, `os init <name>`, `os compile --output`, `os generate` (`--dir`, and `--output` for types, client and migration), `os i18n extract --out` and `os plugin build --out` hung on an output path there.
- `os login` and `os cloud login` never finished writing credentials under a `HOME` there, and the package enable / disable state the packages routes write under `OS_HOME` held the event loop of the host serving them.

**What an operator sees now.** The command exits non-zero at once with the operating system's own error, which names the level that cannot be made:

```text
✗ Cannot create home directory at /proc/os-x: ENOENT: no such file or directory, mkdir '/proc/os-x'
```

Not covered yet: the runtime state file `os serve` writes into `OS_HOME` once it is listening.

Nothing else changes. Every directory these paths made before is still made, every missing level of it; every path that was refused before is still refused, with the operating system's code. The one difference is the path that was never answered at all.
