---
'@objectstack/cli': patch
---

The published README now describes the `os` that ships. Five things it said were false.

Clause-②: no

- **Short flags.** The README listed `-v, --version` and `-h, --help` as global options. `os -v` and `os -h` exit 2 with `command -v not found` / `command -h not found`, because only `--version` and `--help` are registered. It now lists `--version` and `--help` alone and says there is no short form. `-v` already belongs to commands of their own: it is `--verbose` on `os dev`, `os serve`, `os start` and `os doctor`, and `--version` on `os package publish` and `os package install`.
- **The `os plugin` group.** The README said there is no `os plugin` command group. `os plugin build`, `os plugin sign` and `os plugin publish` are registered, and the README now lists them. It also says the group has no `install`, and that `os plugin` is a different thing from `os plugins`, which is not a command.
- **Two command rows.** `os init [name]` creates a new directory of that name when a name is given, so it no longer says "in the current directory" for every case. `os dev` restarts the server after each rebuild, so it no longer says "with hot reload".
- **Cloud credentials and flags.** The README said every cloud command takes its credentials from `os cloud login` or from `--token` / `OS_CLOUD_API_KEY` and `--server` / `OS_CLOUD_URL`. That holds only for `os package publish` and `os plugin publish`. `os environments list`, `show`, `create`, `bind` and `switch` take `-u, --url` (env `OS_CLOUD_URL`) and `-t, --token` (env `OS_TOKEN`), and otherwise use the `os login` session in `~/.objectstack/credentials.json` — never the `os cloud login` session. With only `os cloud login` done they exit 1 with `Authentication required`. The README now has a per-command table, and its typical publish flow says so at the `os environments create` step.
- **`os serve --ui`.** The README said it enables "Studio UI". It enables the bundled Console portal at `/_console/` when `@object-ui/console` is installed, which is what `os serve --help` says.

**What changes for an operator.** Nothing at runtime. No command, flag, environment variable, exit code or help page changes.
