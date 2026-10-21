---
'@objectstack/skills': patch
---

docs(skills): the npm page and the catalog's front page give the install line for the project's own package manager

Clause-②: no

`README.md` (the npm page) and `dist/skills/README.md` (the catalog's front page, copied from the repository's `skills/README.md`) printed `npm install --save-dev "@objectstack/skills@$(node -p …)"` as the only install line. In a pnpm-installed project that line exits `1` with `npm error Cannot read properties of null (reading 'edgesOut')` and writes nothing, and `create-objectstack` installs with pnpm when it is available, so a scaffolded project is commonly a pnpm project.

- **Both pages** now print `pnpm add -D "@objectstack/skills@$(node -p "require('@objectstack/spec/package.json').version")"`, with the npm and yarn spellings on a comment line beside it, and the rule: add the package with the manager that installed the project. The `objectstack-upgrade` skill's re-install step, which an agent follows for this exact move, prints the same line.
- **The npm page** names pnpm's `ERR_PNPM_NO_MATCHING_VERSION` beside npm's `ETARGET` for a project on `@objectstack/spec` 17.x, and runs `npx skills list` before `npx skills remove --all`, which removes every installed skill without asking.
