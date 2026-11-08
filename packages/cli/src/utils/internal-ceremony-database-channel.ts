// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The CLI's INTERNAL parent-to-child channel for the database `os start`'s
 * and `os dev`'s ownership refusal must name (#31488, #31547).
 *
 * `os start` resolves its database on the shared ladder
 * (`resolveProjectDatabaseUrl`, `@objectstack/runtime`) with two inputs no
 * other command sees: its `-d` flag and its `--home` flag. The ceremony the
 * v18 ownership refusal names (`os migrate organization-ownership`) resolves
 * the same ladder WITHOUT them, so run bare in the operator's shell it plans
 * another database: the project's own, or none at all. The `serve` child sees
 * only the URL it was handed and cannot tell how the parent reached it; this
 * channel tells it, carrying the URL the child serves when, and only when,
 * the ceremony would not find it (`OrganizationOwnershipBootGuardOptions.databaseUrl`).
 *
 * Same naming and ownership rule as `OS_INTERNAL_AUTH_SECRET_FILE`
 * (`internal-auth-secret-channel.ts`): `INTERNAL` in the domain slot, a
 * private call between two processes the CLI owns both ends of, deliberately
 * not listed in `content/docs/deployment/environment-variables.mdx`. The
 * parent OWNS the variable in the child env: set when there is a database to
 * name, deleted otherwise, so an inherited copy never speaks for this run.
 *
 * `os dev` writes the same channel from its own resolution (#31547): its `-d`
 * flag (or `--fresh`'s throwaway file) is just as invisible to the ceremony,
 * and its refusal names the ceremony with `--dev`, which resolves the same
 * ladder. Beside the URL, both commands carry what their `--database-driver`
 * and `--database-auth-token` flags put in the child's environment only
 * ({@link writeCeremonyConnectionChannel}): the driver by value, the token
 * only as the fact that the flag supplied it.
 */

import type { ResolvedProjectDatabaseUrl } from '@objectstack/runtime';

export const INTERNAL_CEREMONY_DATABASE_URL_ENV = 'OS_INTERNAL_CEREMONY_DATABASE_URL';
/** The `--database-driver` value the parent handed the child (#31547). */
export const INTERNAL_CEREMONY_DATABASE_DRIVER_ENV = 'OS_INTERNAL_CEREMONY_DATABASE_DRIVER';
/** `1` when `--database-auth-token` supplied the child's token (#31547); never the token itself. */
export const INTERNAL_CEREMONY_AUTH_TOKEN_FROM_FLAG_ENV = 'OS_INTERNAL_CEREMONY_AUTH_TOKEN_FROM_FLAG';

/**
 * The database the refusal must name: the parent's resolved URL when its `-d`
 * flag chose it (`os dev`'s `--fresh` file too), or when the file of a `--home` home is the database (the
 * unified default or a legacy file under that home). `undefined` when the
 * ceremony's own ladder reaches the same database: `$OS_DATABASE_URL`, the
 * project's declared datasource, or the default file of the project's
 * `.objectstack` or an exported `$OS_HOME`.
 */
export function ceremonyDatabaseUrl(
  resolved: Pick<ResolvedProjectDatabaseUrl, 'url' | 'source'>,
  opts: { homeFlag: string | undefined },
): string | undefined {
  if (resolved.source === 'explicit') return resolved.url;
  const homeFile = resolved.source === 'unified-default' || resolved.source === 'legacy-file';
  if (homeFile && opts.homeFlag !== undefined && opts.homeFlag.trim() !== '') return resolved.url;
  return undefined;
}

/** Write the channel into a `serve` child's environment: the URL to name, otherwise no variable at all. */
export function writeCeremonyDatabaseChannel(env: NodeJS.ProcessEnv, url: string | undefined): void {
  if (url) env[INTERNAL_CEREMONY_DATABASE_URL_ENV] = url;
  else delete env[INTERNAL_CEREMONY_DATABASE_URL_ENV];
}

/** Read the channel in the `serve` child: the URL, or `undefined` when the parent set none. */
export function readCeremonyDatabaseChannel(env: NodeJS.ProcessEnv): string | undefined {
  const url = env[INTERNAL_CEREMONY_DATABASE_URL_ENV];
  return url ? url : undefined;
}

/**
 * Write what the ceremony needs, beside the URL, to open the database the
 * child opens (#31547): the `--database-driver` value, and whether
 * `--database-auth-token` supplied the token. Each is set exactly when the
 * parent put the flag's value in the child's environment
 * (`OS_DATABASE_DRIVER` / `OS_DATABASE_AUTH_TOKEN`), and deleted otherwise: a
 * driver or token the operator exported is in the shell that runs the
 * commands already. The token's value is never written here.
 */
export function writeCeremonyConnectionChannel(
  env: NodeJS.ProcessEnv,
  flags: { databaseDriver: string | undefined; databaseAuthToken: string | undefined },
): void {
  if (flags.databaseDriver) env[INTERNAL_CEREMONY_DATABASE_DRIVER_ENV] = flags.databaseDriver;
  else delete env[INTERNAL_CEREMONY_DATABASE_DRIVER_ENV];
  if (flags.databaseAuthToken) env[INTERNAL_CEREMONY_AUTH_TOKEN_FROM_FLAG_ENV] = '1';
  else delete env[INTERNAL_CEREMONY_AUTH_TOKEN_FROM_FLAG_ENV];
}

/**
 * Read it in the `serve` child, shaped as the guard's options
 * (`databaseDriver`, `databaseAuthTokenFromFlag`): only the members the parent set.
 */
export function readCeremonyConnectionChannel(
  env: NodeJS.ProcessEnv,
): { databaseDriver?: string; databaseAuthTokenFromFlag?: true } {
  const driver = env[INTERNAL_CEREMONY_DATABASE_DRIVER_ENV];
  return {
    ...(driver ? { databaseDriver: driver } : {}),
    ...(env[INTERNAL_CEREMONY_AUTH_TOKEN_FROM_FLAG_ENV] === '1' ? { databaseAuthTokenFromFlag: true as const } : {}),
  };
}
