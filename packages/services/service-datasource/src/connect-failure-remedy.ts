// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The remedy clause of a fail-fast datasource connect failure — and the one
 * cause that needs a DIFFERENT remedy (#5794).
 *
 * ## The failure this exists for
 *
 * `handleFailure`'s fail-fast throw used to end on exactly one sentence, for
 * every cause: *"Fix the datasource configuration, or set
 * OS_ALLOW_DRIVER_CONNECT_FAILURE=1 to boot anyway and serve errors until it is
 * reachable."* That is correct advice for the cause it was written for — a
 * database that is genuinely unreachable, a wrong DSN, a rotated password.
 *
 * It is **harmful, in both halves, for one specific cause**: booting an
 * unbuilt workspace, where the driver's `dist/` does not exist and the failure
 * is `ERR_MODULE_NOT_FOUND` rather than a refused connection. Measured on an
 * unbuilt worktree (#5726, and re-measured for #5794):
 *
 * ```text
 * ✗ datasource 'default': connect failed — Cannot find module
 *   '…/node_modules/@objectstack/driver-sql/dist/index.mjs' imported from …
 *   Fix the datasource configuration, or set OS_ALLOW_DRIVER_CONNECT_FAILURE=1
 *   to boot anyway and serve errors until it is reachable.
 * ```
 *
 *  - **"Fix the datasource configuration"** sends the reader to edit a
 *    configuration that is *already correct*. Nothing they can write there
 *    creates a `dist/` directory.
 *  - **"set OS_ALLOW_DRIVER_CONNECT_FAILURE=1 to boot anyway"** is worse than
 *    useless: it does not work around the problem, it *hides* it. A half-built
 *    workspace then reports itself started and fails every request with
 *    `ERR_DATASOURCE_UNAVAILABLE`, which is a strictly harder thing to diagnose
 *    than the honest refusal to boot. That flag exists for a database that is
 *    unreachable — a fact about the world, which may resolve itself. A missing
 *    build artifact is a fact about this checkout, and no env var should boot
 *    past it. (Same line #5714 drew for an unhonourable `pool` block.)
 *
 * And the one fix that *does* work — `pnpm build` — was never mentioned.
 *
 * This is #5217's invariant in a second place: **one unmet precondition is one
 * precondition, not N content problems.** The local worktree is the first place
 * anyone reproduces a CI red, so this message is handed to the reader at
 * precisely their least-informed moment; CI never produces this shape at all,
 * because a build always runs ahead of it there.
 *
 * ## Message discipline: ONE correct fix, and no escape hatch
 *
 * The unbuilt remedy names `pnpm install && pnpm build` once and stops. It does
 * not mention `OS_ALLOW_DRIVER_CONNECT_FAILURE` — not even to warn against it.
 * Naming an escape hatch is how it gets used: a reader who is already stuck
 * skims for the shortest line that looks like it will let them continue. Same
 * discipline as `datasource-pool-support.ts` (#5714 / #5931) and as
 * `scripts/check-dev-prereqs.mjs` (#5795), whose own pin asserts its red text
 * mentions its fix exactly once.
 *
 * `pnpm install && pnpm build` rather than a bare `pnpm build` is the complete
 * form: `ERR_MODULE_NOT_FOUND` cannot distinguish "installed but unbuilt" from
 * "never installed", and the combined command is correct for both — the same
 * choice `check-dev-prereqs` makes for a workspace with no `node_modules`.
 *
 * ## A missing database CLIENT is not an unbuilt workspace (#24909)
 *
 * The unbuilt remedy was chosen for every module-not-found, and one of those is
 * not a build fault at all: `@objectstack/driver-sql` speaks to PostgreSQL,
 * MySQL and native SQLite through knex, and knex loads the database client
 * (`pg`, `mysql2`, `better-sqlite3`) that the PROJECT installs — `pg` and
 * `mysql2` are optional peers, `better-sqlite3` an optional dependency. A
 * scaffolded app pointed at PostgreSQL without `pg` installed was refused with
 * "a build precondition … Run `pnpm install && pnpm build`", which it followed
 * and was refused again: neither command adds a package the project never
 * declared. Measured on the published release, outside any workspace:
 *
 * ```text
 * ✗ datasource 'default': connect failed — Knex: run $ npm install pg --save
 *   Cannot find module 'pg' … The driver package could not be LOADED at all …
 *   Run `pnpm install && pnpm build`, then start again.
 * ```
 *
 * The two causes are told apart by WHICH module could not be resolved, read
 * from the error text — measured on every arm of the shared factory, ESM and
 * CJS builds alike:
 *
 *  - knex re-throws a NEW `Error` for a missing client and drops its `code`,
 *    keeping only `Cannot find module 'pg'` (`'mysql2'`, `'better-sqlite3'`) in
 *    the text — a BARE third-party specifier;
 *  - an unbuilt driver package is a PATH (`Cannot find module
 *    '…/@objectstack/driver-sql/dist/index.mjs'`), and an uninstalled one is
 *    its `@objectstack/…` name (`Cannot find package '@objectstack/driver-sql'`).
 *
 * Only the closed list in {@link OPTIONAL_DRIVER_CLIENT_PACKAGES} is re-routed:
 * it is exactly the clients the factory's knex arms load, so it names a fix
 * that is known to be right. Every other module-not-found — any path, any
 * `@objectstack/…` package, any other bare name (a hard dependency such as
 * `knex` missing is a broken install, for which `pnpm install` is the fix) —
 * keeps the unbuilt remedy unchanged.
 *
 * The client remedy keeps this module's discipline: it names the install of
 * THAT module once and stops — no build, no environment variable, no
 * configuration key. The server does not know which package manager the
 * project uses, so it spells the one install the way the factory's
 * optional-driver messages already do: `npm install <client>`, with the pnpm
 * and yarn spellings of the same command beside it.
 *
 * ## Scope: a message branch, nothing else
 *
 * This changes no behaviour. The fail-fast verdict, when it fires, which error
 * type is thrown, the retained connection state, and the degraded-boot path
 * under `OS_ALLOW_DRIVER_CONNECT_FAILURE` are all untouched — only the closing
 * sentence differs, and only for these causes.
 */

import { isModuleNotFoundError } from '@objectstack/types';

/**
 * The remedy for every cause except the unbuilt workspace — a database that is
 * genuinely unreachable, a wrong DSN, a credential that will not resolve.
 *
 * **Byte-for-byte the sentence this message has always ended on.** Pinned as a
 * constant rather than left inline so that "the other causes are unchanged" is
 * a thing the tests can assert against one declaration instead of a copy.
 */
export const GENERIC_CONNECT_FAILURE_REMEDY =
  `Fix the datasource configuration, or set OS_ALLOW_DRIVER_CONNECT_FAILURE=1 to boot anyway and ` +
  `serve errors until it is reachable.`;

/**
 * The remedy when the driver package could not be loaded at all.
 *
 * Deliberately mentions no environment variable and no configuration key — see
 * the module note. One fix, stated once.
 */
export const UNBUILT_WORKSPACE_REMEDY =
  `The driver package could not be LOADED at all — it is not installed, or its build output is ` +
  `missing. That is a build precondition, not a datasource fault: the configuration is fine, and ` +
  `no boot-time override can make a driver that does not exist answer a query. Run ` +
  `\`pnpm install && pnpm build\`, then start again.`;

/**
 * The database clients `@objectstack/driver-sql` loads through knex and that a
 * project installs itself — the client each SQL arm of the shared factory names
 * (`client: 'pg'` / `'mysql2'` / `'better-sqlite3'`; knex requires the package
 * of the same name). A module-not-found naming one of these, as a bare
 * specifier, is a missing install and not an unbuilt workspace.
 *
 * Closed on purpose: a name on this list is promised the install remedy, so it
 * holds only the clients whose install is known to be the fix. The pins build
 * each one's real failure through the real factory arm, so a renamed client
 * shows up there rather than as a silent return to the build advice.
 */
export const OPTIONAL_DRIVER_CLIENT_PACKAGES: readonly string[] = ['pg', 'mysql2', 'better-sqlite3'];

/**
 * The remedy when the database client the driver loads is not installed.
 *
 * One fix, stated once: the install of that package, in the three package
 * managers' spellings of the same command (the server cannot know which one the
 * project uses — the factory's optional-driver messages make the same choice).
 * No build, no environment variable, no configuration key — see the module note.
 */
export function missingDriverClientRemedy(client: string): string {
  return (
    `The database client package \`${client}\` is not installed, so no connection was attempted. ` +
    `It is an OPTIONAL install of @objectstack/driver-sql, loaded only for the database this ` +
    `datasource uses: a build cannot produce it, and no boot-time override can stand in for it. ` +
    `Install it next to the server that opens this datasource — \`npm install ${client}\` ` +
    `(pnpm add ${client} / yarn add ${client}) — then start again.`
  );
}

/** `Cannot find module 'x'` (CJS `require`) and `Cannot find package 'x'` (ESM `import`). */
const UNRESOLVED_SPECIFIER = /Cannot find (?:module|package) '([^']+)'/;

/**
 * The specifier a module-not-found failed to resolve, as the first
 * `Cannot find module|package '…'` in its text says — `undefined` when the
 * value is not a module-not-found at all, or carries only the `code`.
 *
 * Read from the TEXT because that is the only place it exists on this path:
 * Node's errors for a bare specifier carry no field naming it (`code` and, for
 * CJS, `requireStack` — only ESM's missing-FILE shape adds a `url`), and knex's
 * re-throw for a missing client keeps neither the `code` nor the original
 * error — only the message (measured; see the module note). The first match is the one that
 * failed: every wrapper on this path puts its own words first and the
 * interpolated import error after them.
 */
function unresolvedSpecifier(cause: unknown): string | undefined {
  if (cause === undefined || !isModuleNotFoundError(cause)) return undefined;
  const message = cause instanceof Error ? cause.message : String(cause);
  return UNRESOLVED_SPECIFIER.exec(message)?.[1];
}

/**
 * The database client this connect failed to load, when that is the cause —
 * one of {@link OPTIONAL_DRIVER_CLIENT_PACKAGES}, named exactly (a subpath such
 * as `pg/lib/x` means the client IS installed and is not this case).
 */
export function missingDriverClient(cause: unknown): string | undefined {
  const specifier = unresolvedSpecifier(cause);
  return specifier !== undefined && OPTIONAL_DRIVER_CLIENT_PACKAGES.includes(specifier)
    ? specifier
    : undefined;
}

/**
 * Did this connect fail because the driver's module could not be RESOLVED, as
 * opposed to a connection that was attempted and refused — and was it not
 * merely a missing database client ({@link missingDriverClient})?
 *
 * Delegates to `@objectstack/types`' shared classifier — the single owner of
 * this judgement since framework#3265, already relied on by the CLI's
 * optional-plugin guards and its `requires` capability resolver. A second copy
 * here would be free to drift from it, and the way it would drift is by
 * mis-reading ESM's `Cannot find package` as a crash (the framework#1595 bug
 * that classifier was written to end).
 *
 * That classifier checks the **structured** signal first (`err.code` is
 * `ERR_MODULE_NOT_FOUND` under ESM `import()`, `MODULE_NOT_FOUND` under CJS
 * `require()`) and only then falls back to the message text. The fallback earns
 * its place on this path specifically: the factory's `sqlite-wasm` and `mongo`
 * arms re-throw a `new Error(...)` that interpolates the original message but
 * drops its `code`, so those two arms reach here with the text signal alone.
 *
 * `undefined` — the call sites that have no thrown value to classify, such as
 * an unsupported driver id — is never a module-resolution failure.
 */
export function isUnbuiltWorkspaceFailure(cause: unknown): boolean {
  if (cause === undefined) return false;
  return isModuleNotFoundError(cause) && missingDriverClient(cause) === undefined;
}

/**
 * The sentence a fail-fast connect failure ends on, chosen by cause.
 *
 * @param cause the value `connect()`/the factory threw, when there is one.
 */
export function connectFailureRemedy(cause: unknown): string {
  const client = missingDriverClient(cause);
  if (client !== undefined) return missingDriverClientRemedy(client);
  return isUnbuiltWorkspaceFailure(cause) ? UNBUILT_WORKSPACE_REMEDY : GENERIC_CONNECT_FAILURE_REMEDY;
}
