---
'@objectstack/cli': patch
'@objectstack/mcp': patch
---

feat(cli): `os skills install | update | status` install, update and check the published skills catalog at the server's version, with or without a project

Clause-②: yes (widening: a new published CLI command group, `os skills install | update | status`)
Metadata-protocol: none

Nothing installed the published skills catalog except `create-objectstack`'s scaffold-time sync, so a user who only connected an MCP client had no way to install it, and a project had no command to refresh it after an upgrade.

- **`os skills install`** copies `@objectstack/skills` at one version into the agent's skills directory (`.claude/skills/` under the current directory, or `--dir`), in an empty directory or in a project; no `package.json` is read or written. The version is `--version` (exact), else the target environment's (`--target`, a URL or a restriction profile file, read exactly as `os validate --target` reads it), else the CLI's own version (the two are released together); the output names which. The tarball is read with `npm pack` from the registry the environment configures, and only `dist/skills/<name>/` is copied. A version the registry does not publish is refused, naming it. What was written is recorded in `.objectstack-skills.json` beside the skills.
- **`os skills update`** moves the recorded catalog to another version: it replaces the catalog's skills, removes those the new version dropped, and never writes, replaces or removes a skill directory it did not install. A catalog skill changed locally is refused unless `--force`.
- **`os skills status`** reports the installed version against the expected one, plus missing, modified and extra skills; it exits `0`, or `1` on a mismatch with `--check`. All three take `--json`.

`@objectstack/mcp`: the open server's `initialize` skills install line now names `os skills install --version <version>` (and its `npx -p @objectstack/cli@<version>` form for a machine without the CLI) instead of `pnpm add -D @objectstack/skills@<version>`, which needed a project.
