---
'@objectstack/cli': patch
---

The published README now describes the `os` that ships. Three of its claims were false.

Clause-②: no

**Short flags.** The README listed `-v, --version` and `-h, --help` as global options. `os -v` and `os -h` exit 2 with `command -v not found` / `command -h not found`, because only `--version` and `--help` are registered. It now lists `--version` and `--help` alone and says there is no short form. `-v` already belongs to commands of their own: it is `--verbose` on `os dev`, `os serve`, `os start` and `os doctor`, and `--version` on `os package publish` and `os package install`.

**The `os plugin` group.** The README said there is no `os plugin` command group. `os plugin build`, `os plugin sign` and `os plugin publish` are registered, and the README now lists them. It also says the group has no `install`, and that `os plugin` is a different thing from `os plugins`, which is not a command.

**Two command rows.** `os init [name]` creates a new directory of that name when a name is given, so it no longer says "in the current directory" for every case. `os dev` restarts the server after each rebuild, so it no longer says "with hot reload".

**What changes for an operator.** Nothing at runtime. No command, flag, exit code or help page changes.
