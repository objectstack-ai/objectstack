---
'@objectstack/service-datasource': patch
---

fix(service-datasource): a datasource whose optional driver package is not installed (`@objectstack/driver-turso`, `@objectstack/driver-mongodb`, `@objectstack/driver-sqlite-wasm`) is refused with that package's install alone, no longer followed by "Run `pnpm install && pnpm build`"

Clause-②: no

- **What was wrong.** A `turso`, `mongodb` or `sqlite-wasm` datasource whose driver package is not installed is refused at boot, and the refusal already says so and names the install (`npm install @objectstack/driver-turso`, with the `pnpm add` and `yarn add` spellings beside it). It then went on to end on the unbuilt-workspace remedy anyway: "… That is a build precondition … Run `pnpm install && pnpm build`, then start again." Those are two fixes that contradict each other, and the second does nothing for a project, which adds these optional packages itself. Measured on the published release with a declared `turso` datasource and no `@objectstack/driver-turso` installed.
- **Now.** When the module that could not be resolved is one of those three packages, by its bare name (`Cannot find package '@objectstack/driver-turso'` under ESM, `Cannot find module '@objectstack/driver-turso'` under CJS), the refusal ends on one sentence that defers to the install named above it. It names no second command, no build step and no environment variable.
- **Unchanged.** A driver package whose build output is missing (the error names a path into its `dist/`, which is what a monorepo checkout that has been installed but not built reports), or a required `@objectstack/…` package that is not installed, still ends on `pnpm install && pnpm build`. A missing `pg`, `mysql2` or `better-sqlite3` client still ends on the install of that client. A refused connection, a wrong DSN or a rejected password still ends on the same sentence as before. When the boot is refused, the error type, the retained connection state and the `OS_ALLOW_DRIVER_CONNECT_FAILURE` degraded boot do not change, and the driver factory's own messages are unchanged: only the closing sentence of the refusal is different.

What to do: install the driver package the refusal names next to the server that opens the datasource, then start again.
