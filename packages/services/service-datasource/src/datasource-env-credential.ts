// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The runtime-environment credential slot for a CODE-defined datasource
 * (#27687, maintainer ruling: option 5).
 *
 * A datasource declared in code (`defineDatasource`, an installed package's
 * `*.datasource.ts`) cannot carry its password: the driver contracts refuse an
 * inline `config.password` and a `user:password@` URL, because the declaration
 * is compiled into the artifact and stored whole in `sys_metadata`. It also
 * cannot reach the two ruled routes a UI-created datasource has — the admin
 * door refuses a code-origin datasource, and nothing mints a `sys_secret:`
 * handle for one. This slot is the code author's route: the credential stays
 * out of the declaration and is read at CONNECT time from an environment
 * variable whose name the platform derives from the datasource name —
 * `warehouse` reads `OS_DATASOURCE_WAREHOUSE_PASSWORD` — the same pattern as
 * `OS_DATABASE_URL` for `default`.
 *
 * ## The guards, each a ruled condition
 *
 *  - **The metadata names no variable.** The name is derived, so authored
 *    metadata cannot point the runtime at an arbitrary host variable.
 *  - **Code origin only, by provenance.** The slot is read for a name in the
 *    host's code-datasource set (`code-datasource-names`, filled by the
 *    runtime from code) on a `declared-auto` connect — ⛔ never on the
 *    caller-supplied `record.origin`, which `connectDeclared` defaults to
 *    `'code'`. A datasource created through the UI or API under the same name
 *    connects through `registerPool` (`runtime-admin`) and never reads it.
 *  - **A host switch, off unless the host opts in.** On a host where several
 *    tenants' artifacts share one process, a process-wide variable is readable
 *    by every tenant artifact that declares the same name. So the slot is read
 *    only when {@link DATASOURCE_ENV_CREDENTIALS_SWITCH} is `on`. The
 *    single-artifact CLI host (`os serve` / `os start` / `os dev`) stamps
 *    that default; every other composition leaves it unset, i.e. off.
 *  - **A declared credential wins.** `external.credentialsRef` and
 *    `external.connector` keep precedence and stay fail-closed: a declared
 *    reference that does not resolve never falls back to the environment.
 *  - **The value goes nowhere but the driver.** It is handed to the driver
 *    factory as the connection's `secret` and is never logged, stored or
 *    answered; a message names the VARIABLE, never its value.
 */

/** The host switch: `on` reads the slot, `off` (or unset) never does. */
export const DATASOURCE_ENV_CREDENTIALS_SWITCH = 'OS_DATASOURCE_ENV_CREDENTIALS';

/**
 * The environment variable a code-defined datasource reads its credential
 * from: `OS_DATASOURCE_` + the name upper-cased, each character outside
 * `[A-Z0-9]` replaced by `_`, + `_PASSWORD`.
 *
 * The suffix is the ruled spelling for every driver; the value is the
 * connection's `secret`, which each driver arm applies where its client takes
 * it (the password for postgres, mysql and mongo; the `authToken` for turso).
 */
export function datasourceEnvCredentialVar(name: string): string {
  return `OS_DATASOURCE_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_PASSWORD`;
}

/**
 * Read the host switch. Unset or empty is `off`; `on` / `off` are read in any
 * letter case; anything else is refused with a sentence, because a typo that
 * silently read as off would leave every code datasource unconnected with a
 * reason that blames the variable.
 */
export function resolveDatasourceEnvCredentialsSwitch(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env[DATASOURCE_ENV_CREDENTIALS_SWITCH];
  if (raw === undefined || raw.trim() === '') return false;
  const value = raw.trim().toLowerCase();
  if (value === 'on') return true;
  if (value === 'off') return false;
  throw new Error(
    `${DATASOURCE_ENV_CREDENTIALS_SWITCH} must be 'on' or 'off', got '${raw}'. `
      + "'on' lets a code-defined datasource read its credential from OS_DATASOURCE_"
      + "{NAME}_PASSWORD at connect; 'off' (the default outside the CLI host) never reads it.",
  );
}

/**
 * The slot as {@link DatasourceConnectionService} consumes it. Absent ⇒ the
 * slot is off, which is what every composition that does not opt in gets.
 */
export interface DatasourceEnvCredentialSource {
  /** Whether the host registers `name` from code — the provenance set, never a record's `origin`. */
  isCodeDatasource(name: string): boolean;
  /** Read one variable. Called only with a name {@link datasourceEnvCredentialVar} derived. */
  read(variable: string): string | undefined;
}
