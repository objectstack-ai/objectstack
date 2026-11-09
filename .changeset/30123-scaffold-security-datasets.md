---
'@objectstack/cli': patch
'create-objectstack': patch
---

feat(cli,create-objectstack): a new project has a wired place for permission sets and datasets, `os g permission` / `os g dataset` write them, and the generated AGENTS.md names the package manager the project was created with

Clause-②: yes (widening)
Metadata-protocol: none

- **`create-objectstack`: the blank starter ships `src/security/index.ts` and `src/datasets/index.ts`**, empty barrels already handed to the stack's `permissions` and `datasets` keys in `objectstack.config.ts`, like the eight directories it wired before. A permission set or a dataset exported from them is loaded and counted by `validate` with no edit to the config. The generated `AGENTS.md` lists both directories.
- **`@objectstack/cli`: `os g permission NAME [--object OBJECT]`** writes `src/security/NAME.permission.ts`, a `definePermissionSet` granting read, create and edit (no delete) on the object `--object` names, or the stack's only object, with `readScope: 'own'` declared. **`os g dataset NAME [--object OBJECT]`** writes `src/datasets/NAME.dataset.ts`, a `defineDataset` over that object with a `record_count` measure, grouped by the record's title field when it has one. `defineDataset` types the literal, so it needs no `as const`. Both pass `os validate`, `os build` and `os lint` with no finding on a fresh project. `os init` wires both directories too.
- **`create-objectstack`: the generated `AGENTS.md` (and `.github/copilot-instructions.md`) says `pnpm run validate` in a project created with pnpm**, and `npm run …` in one created with npm, the same package manager the install line and "Next steps" name. It used to say `npm run` in every project.
