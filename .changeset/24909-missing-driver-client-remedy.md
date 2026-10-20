---
'@objectstack/service-datasource': patch
---

fix(service-datasource): a datasource whose database client is not installed (`pg`, `mysql2`, `better-sqlite3`) is refused with the install of that client, not with "Run `pnpm install && pnpm build`"

Clause-②: no

- **What was wrong.** When a boot-critical datasource could not connect because a module could not be resolved, the refusal always ended on the unbuilt-workspace remedy: "The driver package could not be LOADED at all … That is a build precondition … Run `pnpm install && pnpm build`, then start again." That is right for a monorepo checkout whose driver build output is missing. It is wrong for a project that points at PostgreSQL or MySQL without installing the database client: `pg` and `mysql2` are optional peers of `@objectstack/driver-sql` (and `better-sqlite3` an optional dependency) that the project installs itself, so neither command adds them, and a reader who followed the advice was refused again with the same text.
- **Now.** When the module that could not be resolved is one of those three clients (knex reports it as `Cannot find module 'pg'`), the refusal ends on the install of that client instead: `npm install pg` (with the `pnpm add` and `yarn add` spellings beside it), and no build step. It names no environment variable.
- **Unchanged.** A driver package whose build output is missing, or a required `@objectstack/…` driver package that is not installed (any but the optional `@objectstack/driver-turso`, `@objectstack/driver-mongodb` and `@objectstack/driver-sqlite-wasm`), still ends on `pnpm install && pnpm build`. A refused connection, a wrong DSN or a rejected password still ends on the same sentence as before. When the boot is refused, the error type, the retained connection state and the `OS_ALLOW_DRIVER_CONNECT_FAILURE` degraded boot do not change: only the closing sentence of the refusal is different.

What to do: install the client the refusal names next to the server that opens the datasource, then start again.
