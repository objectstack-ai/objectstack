---
"create-objectstack": minor
---

feat(create-objectstack): a scaffolded project installs its AI skills from the `@objectstack/skills` package at its own `@objectstack/spec` version, never from the repository's `main` branch

Clause-②: no

- **The project depends on the catalog.** The blank template's `devDependencies` gain `@objectstack/skills`, at the same `^<version>` as every other `@objectstack/*` dependency, so a new project's dependency set changes: the skills are the ones written for the `@objectstack/spec` it installs.
- **The install reads `node_modules`.** After `<pm> install`, the scaffolder runs `npx -y skills@1.7.2 experimental_sync --agent claude-code --copy -y`, which copies the installed package's catalog into `.claude/skills/` as real files, once, beside a `skills-lock.json` that names the package as every skill's source. The GitHub `npx skills add objectstack-ai/objectstack/skills …` command is gone from the run, its summary and the `AGENTS.md` and `README.md` it writes into the project.
- **The summary says what happened.** It names the package version installed and prints the same command for re-installing after an upgrade of the `@objectstack/*` packages, and for any other agent runtime. When the install leaves no catalog to read, or a skill did not come from the package, the run says so instead of reporting the skills installed.
- **The flags keep their meaning.** `--skip-skills` skips the skills step. `--skip-install` installs no skills, because nothing is in `node_modules` yet; the summary names `<pm> install` and then the sync command.
- **To move a project created earlier onto the package:** add `@objectstack/skills` to `devDependencies` at your `@objectstack/spec` range and run your package manager's install. Remove the skills `skills add` installed — `npx skills remove objectstack-data -y` and so on for each `objectstack-*` skill, or `npx skills remove --all` if you installed no others — because the sync skips a skill it did not install and leaves the old copy in place. Then run `npx skills@1.7.2 experimental_sync --agent claude-code --copy -y` (name your own runtime after `--agent`).
