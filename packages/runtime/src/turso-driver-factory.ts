// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * libSQL/Turso driver loading — the SINGLE owner for both hosts (#6268).
 *
 * `@objectstack/driver-turso` drags `@libsql/client` (native bindings included),
 * so it is an OPTIONAL install rather than a dependency. Neither host can
 * therefore let the shared open-core factory build it for the `default`
 * datasource; both inject a host driver factory instead (`options.factory` on
 * `DefaultDatasourcePlugin` — the documented seam for "a host whose `default`
 * needs a driver the open-core factory cannot build"). Everything else stays
 * identical to every other kind: same connect path, same `bootCritical`
 * fail-fast verdict, same `OS_ALLOW_DRIVER_CONNECT_FAILURE` escape hatch, same
 * retained status in Setup → Datasources. Only the construction differs.
 *
 * ## Why the loud failure, and never a SQLite fallback
 *
 * When the optional package is absent the load fails with
 * {@link MissingDriverPackageError}, carrying the exact install command as DATA
 * (not only prose). There is deliberately no other branch. Degrading a
 * `libsql://` selection to SQLite would open an empty local file while the
 * operator's remote database sits untouched, and every write — a server write or
 * an `os migrate` DDL — would land in the wrong database. That is the #3276
 * lesson (a driver kind advertised but silently resolved to a *different*
 * engine), and it is the ruling both halves landed under (#5602 / PR #5819 for
 * the CLI, #5820 for the standalone stack).
 *
 * ## #6268 — why this module owns it, and what the hosts still own
 *
 * Until #6268 this shape existed TWICE: here, and in
 * `packages/cli/src/utils/storage-driver.ts`. They were kept equal by hand
 * because the dependency direction forbids the reverse import (cli → runtime,
 * never runtime → cli) and each of the two rulings that created them had a
 * single-package file face. Hand alignment had already started to fail — the CLI
 * half moved onto `@objectstack/spec`'s shared driver vocabulary in #6345 while
 * this half still carried a private `Set(['turso', 'libsql'])` — which is the
 * #3741 → #3758 shape: one decision, two implementations, one of them fixed.
 *
 * So this module is now the owner and the CLI delegates to it. The one thing
 * that CANNOT move, and is therefore a host-supplied input rather than a
 * duplicate:
 *
 *  - **{@link LoadTursoDriverFactoryOptions.importDriverPackage} — the module
 *    resolution root.** `@objectstack/driver-turso` is an optional PEER of
 *    `@objectstack/cli` and is not declared by `@objectstack/runtime` at all.
 *    A bare `import('@objectstack/driver-turso')` resolves from the node_modules
 *    tree of the module that *evaluates* it, so moving the CLI's import into
 *    this file would look for the package under `@objectstack/runtime` — which
 *    under pnpm's strict layout does not link it. An operator who ran the
 *    install command the error tells them to run would still be told the package
 *    is missing. The CLI therefore keeps passing its own thunk; the default
 *    below is this package's own root, for the standalone stack.
 *  - **{@link LoadTursoDriverFactoryOptions.missingUrlError} — the error TYPE
 *    for a config with no url.** The CLI raises its own `UnsupportedDriverError`
 *    (a CLI-only semantic: `serve.ts` re-throws it as a fatal boot error), which
 *    by ruling stays in the CLI. Only the type is host-chosen; the message is
 *    single-sourced here.
 *
 * The install command, the missing-package message, the driver-id vocabulary,
 * the handle shape and the error CLASS are all single-sourced — one
 * {@link MissingDriverPackageError} identity across both packages, which is what
 * keeps `serve.ts`'s `e instanceof MissingDriverPackageError` fatal branch
 * matching an error this module raised.
 */

import type {
  DatasourceConnectionSpec,
  DatasourceDriverHandle,
  IDatasourceDriverFactory,
} from '@objectstack/service-datasource';
import { resolveDatabaseDriverId } from '@objectstack/spec/data';

/** The optional package that provides the libSQL/Turso driver. */
export const TURSO_DRIVER_PACKAGE = '@objectstack/driver-turso';

/** The exact command an operator runs to install the optional libSQL driver. */
export const TURSO_DRIVER_INSTALL_COMMAND = `npm install ${TURSO_DRIVER_PACKAGE}`;

/**
 * True for the driver ids {@link loadTursoDriverFactory}'s factory builds.
 *
 * Resolved through `@objectstack/spec`'s shared driver table rather than a local
 * `Set`, so "which spellings mean libSQL" has ONE answer across the CLI, the
 * standalone stack, the open-core factory and the metadata gate. The private
 * `Set(['turso', 'libsql'])` this replaced (#6268) happened to agree with the
 * table on the day it was written — the table's `turso` row lists exactly those
 * two aliases — and would have silently stopped agreeing the moment a third
 * spelling was added on one side only.
 */
export function isTursoDriverId(driverId: string): boolean {
  return resolveDatabaseDriverId(driverId) === 'turso';
}

/**
 * Thrown by {@link loadTursoDriverFactory} when the OPTIONAL driver package the
 * selection needs is not installed, or resolves to something that is not the
 * driver (a shadowing stub, a truncated install, a major that renamed the
 * export).
 *
 * The install command rides as a field as well as inside the message so a
 * caller can render it however it likes, and so the pin test asserts the
 * command rather than a sentence shape.
 *
 * ## One class, deliberately (#6268)
 *
 * `packages/cli/src/commands/serve.ts` decides whether a boot failure is FATAL
 * with `e instanceof MissingDriverPackageError`. Two same-named classes — one
 * per package — would make that predicate silently stop matching, degrading a
 * fatal branch to a non-fatal one with no diagnostic anywhere. The CLI therefore
 * RE-EXPORTS this class rather than declaring its own; `storage-driver.test.ts`
 * pins the identity (`===`) and pins that an error raised by this module still
 * satisfies the CLI-side `instanceof`.
 */
export class MissingDriverPackageError extends Error {
  readonly driverType: string;
  readonly packageName: string;
  readonly installCommand: string;
  constructor(args: { driverType: string; packageName: string; installCommand: string; message: string }) {
    super(args.message);
    this.name = 'MissingDriverPackageError';
    this.driverType = args.driverType;
    this.packageName = args.packageName;
    this.installCommand = args.installCommand;
  }
}

export interface LoadTursoDriverFactoryOptions {
  /**
   * How the optional package is resolved — and, in tests, a substitute for it.
   *
   * NOT merely a test seam: the specifier resolves from the node_modules tree of
   * whichever module evaluates the `import()`, and the package is an optional
   * peer of `@objectstack/cli` while `@objectstack/runtime` does not declare it.
   * The CLI passes its own thunk so its operators keep resolving the package
   * they installed next to the CLI (see the module docstring). The default is
   * this package's own root, which is what the standalone stack wants.
   *
   * Tests pass a stub module (dispatch WITH the package) or a rejecting thunk
   * (dispatch WITHOUT it) — neither needs a real Turso endpoint, and the
   * missing-package path must stay testable in a workspace where the package
   * happens to be installed.
   */
  importDriverPackage?: () => Promise<unknown>;
  /**
   * Build the error raised when a `turso` connection spec carries no libSQL url.
   *
   * Host-chosen because the TYPE is host semantics: the CLI raises its own
   * `UnsupportedDriverError`, which `serve.ts` re-throws as a fatal boot error
   * and which by the #6268 ruling stays in the CLI. The MESSAGE is passed in
   * from here, so the wording is still single-sourced.
   *
   * Defaults to the standalone stack's plain `Error` with its `[StandaloneStack]`
   * prefix — the prefix lives here rather than in `standalone-stack.ts` because
   * that is the only caller taking the default, and moving it would change the
   * message that host has raised since #5820.
   */
  missingUrlError?: (message: string) => Error;
}

/**
 * Load the OPTIONAL libSQL/Turso driver package and wrap it as the host driver
 * factory `DefaultDatasourcePlugin` accepts.
 *
 * The import happens here, at boot, and only for a selection that actually asks
 * for libSQL — never at module load, so a stack that never sees a `libsql://`
 * URL pays nothing for this arm existing.
 *
 * Absent package ⇒ {@link MissingDriverPackageError}, carrying the exact install
 * command. There is no other branch: the caller must not fall back to SQLite
 * (see the class docstring), and the failure is raised BEFORE the plugin is
 * registered so the operator gets one clear message instead of a connect error
 * later in boot.
 */
export async function loadTursoDriverFactory(
  opts: LoadTursoDriverFactoryOptions = {},
): Promise<IDatasourceDriverFactory> {
  // `as any` on the specifier: the package is deliberately NOT a dependency of
  // `@objectstack/runtime` (that is what "optional" means here), so the literal
  // must not be type-resolved. Same shape the shared factory uses for the other
  // optional drivers (`default-datasource-driver-factory.ts`).
  const load = opts.importDriverPackage ?? (() => import('@objectstack/driver-turso' as any));
  const missingUrlError =
    opts.missingUrlError ?? ((message: string) => new Error(`[StandaloneStack] ${message}`));

  let mod: unknown;
  try {
    mod = await load();
  } catch (err) {
    throw new MissingDriverPackageError({
      driverType: 'turso',
      packageName: TURSO_DRIVER_PACKAGE,
      installCommand: TURSO_DRIVER_INSTALL_COMMAND,
      // One wording for both hosts (#6268). It names BOTH consequences rather
      // than picking one, because one message now answers a failed `os serve`
      // boot and a failed `os migrate` / embedded `createStandaloneStack` alike,
      // and an operator who is told only about the other host's symptom would
      // reasonably conclude the message is not about their situation.
      message:
        `A libSQL/Turso database was selected, but the driver package ${TURSO_DRIVER_PACKAGE} `
        + `is not installed. Install it next to the app or CLI that boots it:\n\n    ${TURSO_DRIVER_INSTALL_COMMAND}\n\n`
        + `(pnpm add ${TURSO_DRIVER_PACKAGE} / yarn add ${TURSO_DRIVER_PACKAGE}.) It is an `
        + 'OPTIONAL package — an optional peer dependency of the CLI — so a default install stays '
        + 'free of @libsql/client and its native bindings. The boot refuses rather than falling '
        + 'back to SQLite: a silent fallback would start the server against an empty local database '
        + '(and let an `os migrate` DDL run against that one) while your libSQL data stays '
        + 'untouched, and every write would land in the wrong database. To use SQLite deliberately, '
        + 'set OS_DATABASE_URL=file:./data/objectstack.db (or --database file:./data/objectstack.db). '
        + `Import error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const record = (mod ?? {}) as { TursoDriver?: unknown; default?: { TursoDriver?: unknown } };
  const TursoDriverCtor = (record.TursoDriver ?? record.default?.TursoDriver) as
    | (new (config: { url: string; authToken?: string }) => object)
    | undefined;
  if (typeof TursoDriverCtor !== 'function') {
    // Resolvable but not the module we expect (a shadowing stub, a truncated
    // install, an incompatible major that renamed its export). Same operator
    // remedy, so the same typed error — never a fallback.
    throw new MissingDriverPackageError({
      driverType: 'turso',
      packageName: TURSO_DRIVER_PACKAGE,
      installCommand: TURSO_DRIVER_INSTALL_COMMAND,
      message:
        `${TURSO_DRIVER_PACKAGE} resolved but exports no TursoDriver class, so the libSQL `
        + `database cannot be opened. Reinstall it:\n\n    ${TURSO_DRIVER_INSTALL_COMMAND}\n\n`
        + 'The boot refuses rather than falling back to SQLite, which would write your data '
        + 'into a different database than the one you configured.',
    });
  }

  return {
    supports: (driverId: string) => isTursoDriverId(driverId),
    create: (spec: DatasourceConnectionSpec): DatasourceDriverHandle => {
      const config = (spec.config ?? {}) as { url?: unknown; authToken?: unknown };
      const url = typeof config.url === 'string' ? config.url : '';
      if (!url) {
        // Defensive: both hosts resolve a URL before they select this kind (the
        // CLI refuses a URL-less `turso` selection in `resolveStorageDefinition`,
        // the standalone stack in its own resolution). A host composing the
        // definition by hand can still get here, and an empty libSQL url has no
        // default to fall back on.
        throw missingUrlError(
          `datasource '${spec.name ?? 'default'}': driver '${spec.driver}' needs a libSQL url in its `
          + 'config (e.g. libsql://my-db.turso.io or file:./data/objectstack.db).',
        );
      }
      const driver = new TursoDriverCtor({
        url,
        ...(typeof config.authToken === 'string' && config.authToken
          ? { authToken: config.authToken }
          : {}),
      }) as {
        connect?: () => Promise<void>;
        disconnect?: () => Promise<void>;
        checkHealth?: () => Promise<boolean>;
      };
      // Same handle shape the open-core factory builds (`toHandle`): ownership
      // stays the default `'factory'` — this instance was built for THIS
      // connect, so kernel teardown disconnects it.
      return {
        ...(typeof driver.connect === 'function' ? { connect: () => driver.connect!() } : {}),
        ...(typeof driver.disconnect === 'function' ? { disconnect: () => driver.disconnect!() } : {}),
        ...(typeof driver.checkHealth === 'function'
          ? { checkHealth: () => driver.checkHealth!(), ping: () => driver.checkHealth!() }
          : {}),
        driver,
      };
    },
  };
}
