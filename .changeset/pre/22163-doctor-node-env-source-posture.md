---
'@objectstack/cli': patch
---

fix(cli): `os doctor` no longer tells a freshly scaffolded project that it is running in production (#22163)

Clause-②: no

- **What changed.** With `NODE_ENV` unset, in a directory whose `objectstack.config.ts` boots as itself, the `NODE_ENV` row now reads `✓ Not set — os dev runs this project as development; os start forces production`, with no fix text. That covers a config alone, and a config beside its own compiled `dist/objectstack.json`, which the first `os dev` writes. Before, the row read `⚠ Not set — this environment is being treated as production` and, under `--verbose`, told the operator to set `NODE_ENV=development`, which `os dev` already sets.
- **What did not change.** In every other directory, the `⚠ … treated as production` warning and its fix text are the same as before. That includes a config beside `OS_ARTIFACT_URL` or beside an `OS_ARTIFACT_PATH` naming another artifact, an artifact with no config, and a directory with neither. `doctor` reads the two variables the way `os dev` does: from the process environment over the `.env*` files loaded for development.
- **Nothing else moves.** The `Environment files` row still reports the `.env*` cascade for `node_env=production`. The `/discovery` `environment` default is unchanged, and so is the way `os serve`, `os start` and `os dev` resolve the mode. A `NODE_ENV` that is set still prints no row, and `doctor`'s exit code is unchanged.
