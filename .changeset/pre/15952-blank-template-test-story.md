---
'create-objectstack': minor
---

The blank starter ships a test story: `pnpm test` boots the scaffolded app's own stack with `bootStack` from `@objectstack/verify` and asserts one business fact through its in-process handle

Clause-②: no

A project scaffolded with `npx create-objectstack` used to start with no `test` script and no way to assert its own behaviour, so the first test an author wrote was a hand-assembled kernel or a faked `ctx`. The blank template now carries:

- **`note.test.ts`**, one starter test. It boots the app the project declares (its objects, its plugins, the services it requires) on the real engine, in-process, with an in-memory database and no server, and asserts that a note without a title is refused with the engine's own `VALIDATION_FAILED` error naming `title`, beside the same note with a title being saved. It addresses the object as `Note.name`, so it follows the namespace scaffolding writes.
- **`vitest.config.ts`**: a 60 s hook timeout for the boot, vitest's console capture switched off, so a log line the stack writes while a worker shuts down cannot fail a green run, and `OS_REGISTRY_LOG: 'warn'`, which drops the engine's one-line-per-registered-item boot log.
- **`package.json`**: a `test` script (`vitest run`), and `@objectstack/verify` (at the project's `@objectstack/*` range) and `vitest` as devDependencies. The vitest range is `~4.0.0`, the one `objectstack init -t plugin` and `objectstack create plugin` declare, and it is generated from that shared policy rather than written by hand, so the three scaffolders cannot drift apart. `~4.0.0` is the range that installs on npm 10, the npm Node 22 bundles; `^4.0.0` does not.
- **`tsconfig.json`** includes every root `*.ts` (`"*.ts"`, as `objectstack init` writes it), so `pnpm typecheck` checks the starter test and the vitest config.
- **`README.md`** lists `pnpm test` beside `validate`, `lint` and `typecheck`.

The project's CI workflow is unchanged: its steps are the script set every scaffolder's project must declare, and `objectstack init -t app` declares no `test` script.
