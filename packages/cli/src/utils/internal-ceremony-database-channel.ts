// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The CLI's INTERNAL parent-to-child channel for the database `os start`'s
 * ownership refusal must name (#31488).
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
 */

import type { ResolvedProjectDatabaseUrl } from '@objectstack/runtime';

export const INTERNAL_CEREMONY_DATABASE_URL_ENV = 'OS_INTERNAL_CEREMONY_DATABASE_URL';

/**
 * The database the refusal must name: `os start`'s resolved URL when its `-d`
 * flag chose it, or when the file of a `--home` home is the database (the
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
