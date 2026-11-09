// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The CLI's INTERNAL parent-to-child channel for WHERE `os start` read the
 * auth secret it hands its `serve` child.
 *
 * `os start` gives the child a secret on every boot: the operator's
 * (`--auth-secret`, `$OS_AUTH_SECRET` and its legacy names) or, when the
 * operator set none, the one it keeps in `<home>/auth-secret`, generated on
 * the first run. The child sees the secret alone and cannot tell the two
 * apart, yet a command the child prints for the operator to run in their own
 * shell has to: the operator's secret is already in that shell, the persisted
 * one is not. The v18 ownership refusal is that command — the ceremony
 * composes the security plugin only with the secret the deployment serves
 * with — so the child names the file to export it from
 * (`OrganizationOwnershipBootGuardOptions.authSecretFile`).
 *
 * Same naming and ownership rule as `OS_INTERNAL_ARTIFACT_PATH`
 * (`internal-artifact-channel.ts`): `INTERNAL` in the domain slot, a private
 * call between two processes the CLI owns both ends of, deliberately not
 * listed in `content/docs/deployment/environment-variables.mdx`. The parent
 * OWNS the variable in the child env: it is set only when the secret came
 * from the file and deleted otherwise, so an inherited copy never speaks for
 * a secret the parent took from somewhere else.
 */
export const INTERNAL_AUTH_SECRET_FILE_ENV = 'OS_INTERNAL_AUTH_SECRET_FILE';

/**
 * Write the channel into a `serve` child's environment: the file when the
 * secret the child is given came from it, otherwise no variable at all.
 */
export function writeAuthSecretFileChannel(env: NodeJS.ProcessEnv, file: string | undefined): void {
  if (file) env[INTERNAL_AUTH_SECRET_FILE_ENV] = file;
  else delete env[INTERNAL_AUTH_SECRET_FILE_ENV];
}

/** Read the channel in the `serve` child: the file, or `undefined` when the parent set none. */
export function readAuthSecretFileChannel(env: NodeJS.ProcessEnv): string | undefined {
  const file = env[INTERNAL_AUTH_SECRET_FILE_ENV];
  return file ? file : undefined;
}
