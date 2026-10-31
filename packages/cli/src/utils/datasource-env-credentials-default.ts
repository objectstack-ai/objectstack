// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27687] The CLI host's default for the code-datasource env-credential
 * switch (`OS_DATASOURCE_ENV_CREDENTIALS`, owned by
 * `@objectstack/service-datasource`).
 *
 * The switch is off in every composition that does not opt in, because on a
 * host where several tenants' artifacts share one process a process-wide
 * `OS_DATASOURCE_{NAME}_PASSWORD` would be readable by every tenant artifact
 * declaring that name. `os serve` (and `os start` / `os dev`, which run it)
 * boots ONE operator's artifact plus the packages that operator installs, so
 * it opts in — by stamping the default into the environment the datasource
 * admin plugin reads at `init()`, the same seam `os start` uses for
 * `OS_CRYPTO_AUTOKEY`. An operator's explicit value, `off` included, always
 * wins: only an unset or empty switch is stamped.
 *
 * Returns whether it stamped.
 */
export function stampDatasourceEnvCredentialsDefault(
  env: Record<string, string | undefined>,
  switchName: string,
): boolean {
  const current = env[switchName];
  if (current !== undefined && current.trim() !== '') return false;
  env[switchName] = 'on';
  return true;
}
