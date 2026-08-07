// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * libSQL/Turso driver loading for the standalone (runtime-only) stack (#5820).
 *
 * `standalone-stack.ts` translates a database URL into the `default` datasource
 * DEFINITION (ADR-0062 D1, #3826) and never constructs a driver itself — the
 * shared `DatasourceConnectionService` connects it. That works for every kind
 * the open-core factory can build; `turso` is the one kind it cannot, because
 * `@objectstack/driver-turso` drags `@libsql/client` (native bindings included)
 * and is therefore an OPTIONAL install rather than a dependency.
 *
 * So this module builds the host driver factory `DefaultDatasourcePlugin`
 * accepts (`options.factory`) — the documented seam for exactly this case: "a
 * host whose `default` needs a driver the open-core factory cannot build".
 * Everything else stays identical to every other kind: same connect path, same
 * `bootCritical` fail-fast verdict, same `OS_ALLOW_DRIVER_CONNECT_FAILURE`
 * escape hatch, same retained status in Setup → Datasources. Only the
 * construction differs.
 *
 * ## Why the loud failure, and never a SQLite fallback
 *
 * When the optional package is absent the load fails with
 * {@link MissingDriverPackageError}, carrying the exact install command as DATA
 * (not only prose). There is deliberately no other branch. Degrading a
 * `libsql://` selection to SQLite would open an empty local file while the
 * operator's remote database sits untouched, and every write — including an
 * `os migrate` DDL — would land in the wrong database. That is the #3276 lesson
 * (a driver kind advertised but silently resolved to a *different* engine), and
 * it is the same ruling the CLI side landed under (#5602 / PR #5819).
 *
 * ## Relationship to the CLI's `loadTursoDriverFactory`
 *
 * `packages/cli/src/utils/storage-driver.ts` carries the same shape for the
 * `os serve` / `os start` path. The two are independent today because the
 * dependency direction forbids the reverse import (cli → runtime, never
 * runtime → cli), and because #5602's file face was the CLI alone. Collapsing
 * them onto one owner — this module, with the CLI delegating — is filed as a
 * follow-up rather than done here, so this PR stays inside #5820's face.
 */

import type {
  DatasourceConnectionSpec,
  DatasourceDriverHandle,
  IDatasourceDriverFactory,
} from '@objectstack/service-datasource';

/** The optional package that provides the libSQL/Turso driver. */
export const TURSO_DRIVER_PACKAGE = '@objectstack/driver-turso';

/** The exact command an operator runs to install the optional libSQL driver. */
export const TURSO_DRIVER_INSTALL_COMMAND = `npm install ${TURSO_DRIVER_PACKAGE}`;

/** Driver ids this factory builds — the same pair the CLI's resolver treats as libSQL. */
const TURSO_DRIVER_IDS = new Set(['turso', 'libsql']);

/** True for the driver ids {@link loadTursoDriverFactory}'s factory builds. */
export function isTursoDriverId(driverId: string): boolean {
  return TURSO_DRIVER_IDS.has(driverId.trim().toLowerCase());
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
   * Test seam: substitute the dynamic `import('@objectstack/driver-turso')`.
   * Production passes nothing. Tests pass a stub module (dispatch WITH the
   * package) or a rejecting thunk (dispatch WITHOUT it) — neither needs a real
   * Turso endpoint, and the missing-package path must stay testable in a
   * workspace where the package happens to be installed.
   */
  importDriverPackage?: () => Promise<unknown>;
}

/**
 * Load the OPTIONAL libSQL/Turso driver package and wrap it as the host driver
 * factory `DefaultDatasourcePlugin` accepts.
 *
 * The import happens here, at boot, and only for a selection that actually asks
 * for libSQL — never at module load, so a stack that never sees a `libsql://`
 * URL pays nothing for this arm existing.
 */
export async function loadTursoDriverFactory(
  opts: LoadTursoDriverFactoryOptions = {},
): Promise<IDatasourceDriverFactory> {
  // `as any` on the specifier: the package is deliberately NOT a dependency of
  // `@objectstack/runtime` (that is what "optional" means here), so the literal
  // must not be type-resolved. Same shape the shared factory uses for the other
  // optional drivers (`default-datasource-driver-factory.ts`).
  const load = opts.importDriverPackage ?? (() => import('@objectstack/driver-turso' as any));

  let mod: unknown;
  try {
    mod = await load();
  } catch (err) {
    throw new MissingDriverPackageError({
      driverType: 'turso',
      packageName: TURSO_DRIVER_PACKAGE,
      installCommand: TURSO_DRIVER_INSTALL_COMMAND,
      message:
        `A libSQL/Turso database was selected, but the driver package ${TURSO_DRIVER_PACKAGE} `
        + `is not installed. Install it next to your app:\n\n    ${TURSO_DRIVER_INSTALL_COMMAND}\n\n`
        + `(pnpm add ${TURSO_DRIVER_PACKAGE} / yarn add ${TURSO_DRIVER_PACKAGE}.) It is an `
        + 'OPTIONAL package, so a default install stays free of @libsql/client and its native '
        + 'bindings. The boot refuses rather than falling back to SQLite: a silent fallback would '
        + 'open an empty local database while your libSQL data stays untouched, and every write — '
        + 'including an `os migrate` DDL — would land in the wrong database. To use SQLite '
        + 'deliberately, set OS_DATABASE_URL=file:./data/objectstack.db. '
        + `Import error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const record = (mod ?? {}) as { TursoDriver?: unknown; default?: { TursoDriver?: unknown } };
  const TursoDriverCtor = (record.TursoDriver ?? record.default?.TursoDriver) as
    | (new (config: { url: string; authToken?: string }) => object)
    | undefined;
  if (typeof TursoDriverCtor !== 'function') {
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
        // Defensive: the standalone stack always resolves a URL before it
        // selects this kind. A host composing the definition by hand can still
        // get here, and an empty libSQL url has no default to fall back on.
        throw new Error(
          `[StandaloneStack] datasource '${spec.name ?? 'default'}': driver '${spec.driver}' needs a `
          + 'libSQL url in its config (e.g. libsql://my-db.turso.io or file:./data/objectstack.db).',
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
