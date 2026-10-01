---
'@objectstack/cli': patch
---

`@objectstack/cli` moves to the `@oclif/core` 5 line: its `@oclif/core` dependency goes from `^4.13.3` to `^5.1.2`. The Command classes the package exports (`CompileCommand`, `ValidateCommand`, `ServeCommand` and the rest) now build on `@oclif/core` 5, so code that extends one of them or runs it beside its own oclif setup should use `@oclif/core` 5 as well.

Node.js 22 or later is required. Every `@oclif/core` 5 release declares `engines.node` `>=22.0.0`, the same floor this package already declared.

The `os` commands, flags and output are unchanged. On 5.1.2 every help page renders byte-for-byte as it did on 4.13.3. The published entry also answers `--version`, `--help`, an unknown command, an unknown flag and a refused `--port` with the same exit codes and the same bytes.
