---
"@objectstack/skills": patch
---

docs(skills): the upgrade skill's preflight re-installs the catalog from `@objectstack/skills` when a 17.x project moves to 18, and both READMEs give the scaffolder's pinned `--copy` sync (#23276)

Clause-②: no

`objectstack-upgrade`'s §0 Preflight gains one step for the skills themselves. A 17.x project's skills were installed with `skills add` from the repository's `main`; their `skills-lock.json` entries read `sourceType: github`, and `experimental_sync` skips them (it prints `Skipped … installed with skills add` and exits 0), so a project that only bumps its packages keeps its 17.x-era skill text. The step removes the eleven `objectstack-*` skills the catalog carried during 17.x (a name not installed is skipped; `--all` when they are the project's only skills), installs `@objectstack/skills` at the installed `@objectstack/spec`'s version, and copies it with `npx skills@1.7.2 experimental_sync --agent claude-code --copy -y` — the command `create-objectstack` runs. The step is paid under the token ratchet by deleting text the same file restates elsewhere; the ceiling is unchanged.

`README.md` (the npm page) and `dist/skills/README.md` (the catalog's front page, copied from the repository's `skills/README.md`) replace the unpinned linked sync (`npx skills experimental_sync --agent claude-code -y`) with that pinned `--copy` spelling and say why: without `--copy` the sync writes links into `node_modules`, which a clone of a project that commits its skills does not have.
