---
"@objectstack/cli": patch
---

`os dev --help` and `os start --help` name `OS_PORT` for `--port`, and `os init --no-install` names the package manager it resolved in its Next steps.

Clause-②: no

- **`os dev --port`.** The help text read `Server port (overrides $PORT)`, though `os dev` reads `OS_PORT` first and `PORT` only as its legacy alias. It now reads `Server port (overrides $OS_PORT; $PORT is the legacy alias)`. Which variables are read, and in what order, is unchanged.
- **`os start --port`.** The same drift: the help text read `Port to listen on (overrides $PORT, default 3000)`, though `os start` reads `OS_PORT` first as well. It now reads `Port to listen on, default 3000 (overrides $OS_PORT; $PORT is the legacy alias)`. The port behaviour is unchanged.
- **`os init --no-install`.** The package manager was resolved only when an install ran, so a `--no-install` run always printed `npm install` and `npx objectstack …`, even with `--package-manager pnpm` or when invoked through pnpm. It is now resolved before the install step, the same way as before (the `--package-manager` flag, then the invoking package manager, then npm), so `os init my-app --no-install --package-manager pnpm` prints `pnpm install` and `pnpm exec objectstack …`. A run with no flag, invoked through npm or `npx`, still prints `npm install`: the scaffold supports npm, yarn and bun as well as pnpm.
