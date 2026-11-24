// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30509] The public origin approval links are built under
 * (`ApprovalServiceOptions.publicBaseUrl`): the approval e-mail's link to the
 * request page, and ADR-0043's action link.
 *
 * Order: the plugin's own `publicBaseUrl` option, else the deployment's
 * address in the order `os serve` and plugin-email's template `baseUrl` read
 * it — `OS_AUTH_URL` (legacy `BETTER_AUTH_URL`), then `OS_BASE_URL` — with
 * `??`, so a variable set to the empty string is a value, as there.
 *
 * ⛔ Never the `http://localhost:<port>` tail plugin-email ends that chain
 * with: an address nobody configured is a guess, and a guessed origin in an
 * e-mail sends the reader somewhere that is not this deployment. With nothing
 * configured, or a value that is not an absolute `http(s)` URL, the answer is
 * the empty origin — links stay relative, as before — and `problem` says why,
 * for the plugin to warn once at boot.
 */
export interface PublicBaseUrlResolution {
  /** The origin, no trailing slash; `''` when none resolved. */
  readonly url: string;
  /** Where it came from. */
  readonly source: 'option' | 'OS_AUTH_URL' | 'BETTER_AUTH_URL' | 'OS_BASE_URL' | 'none';
  /** Set when `url` is `''`: what was missing or wrong. */
  readonly problem?: string;
}

export function resolvePublicBaseUrl(
  option: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): PublicBaseUrlResolution {
  const optionValue = option?.trim();
  const [source, raw]: [PublicBaseUrlResolution['source'], string | undefined] = optionValue
    ? ['option', optionValue]
    : env.OS_AUTH_URL !== undefined
      ? ['OS_AUTH_URL', env.OS_AUTH_URL]
      : env.BETTER_AUTH_URL !== undefined
        ? ['BETTER_AUTH_URL', env.BETTER_AUTH_URL]
        : env.OS_BASE_URL !== undefined
          ? ['OS_BASE_URL', env.OS_BASE_URL]
          : ['none', undefined];
  if (source === 'none') {
    return {
      url: '',
      source,
      problem: 'neither the publicBaseUrl option nor OS_AUTH_URL / OS_BASE_URL is set',
    };
  }
  const value = String(raw).trim().replace(/\/+$/, '');
  let parsed: URL | undefined;
  try {
    parsed = new URL(value);
  } catch {
    parsed = undefined;
  }
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return {
      url: '',
      source: 'none',
      problem: `${source === 'option' ? 'the publicBaseUrl option' : source} is '${value}', which is not an absolute http(s) URL`,
    };
  }
  return { url: value, source };
}

/**
 * The auth service's Console page composer (`AuthManager.getConsoleUrl`):
 * `${origin}${uiBasePath}${path}`, where `AuthConfig.uiBasePath` (default
 * `/_console`) is the one setting that says where this deployment mounts the
 * Console. Absent, or answering nothing, when the kernel has no auth service.
 */
export type ConsolePageComposer = (path: string) => string | undefined;

/**
 * [#34862] The link to a Console page under the approval links' base:
 * `${publicBaseUrl}${mount}${pagePath}`.
 *
 * The Console routes on its own paths (`/system/approvals`), and a server
 * mounts it under a path of its own: `os serve` serves it at `/_console/` and
 * nothing at `/system/*`, so a link without the mount opens nothing. The mount
 * is read from the auth service's composer, never written here, so the
 * approval links follow `uiBasePath` exactly as the auth e-mails (and the
 * mention e-mail) do: `/_console` by default, nothing for a deployment that
 * sets it to `/`.
 *
 * The origin stays `publicBaseUrl` (`resolvePublicBaseUrl`, never a guessed
 * one): only the composer's PATH is taken, less any base path the two share,
 * so a deployment under a sub-path is not prefixed twice. No composer, or one
 * that throws or answers something that is not a URL: no mount, the link the
 * plugin built before.
 */
export function consolePageLink(
  publicBaseUrl: string,
  composer: ConsolePageComposer | undefined,
  pagePath: string,
): string {
  return `${publicBaseUrl}${consoleMountPath(publicBaseUrl, composer)}${pagePath}`;
}

function consoleMountPath(publicBaseUrl: string, composer: ConsolePageComposer | undefined): string {
  let composed: string | undefined;
  try {
    composed = composer?.('/');
  } catch {
    return '';
  }
  if (!composed) return '';
  let mount: string;
  try {
    mount = new URL(composed).pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
  let basePath = '';
  try {
    basePath = publicBaseUrl ? new URL(publicBaseUrl).pathname.replace(/\/+$/, '') : '';
  } catch {
    basePath = '';
  }
  if (basePath && (mount === basePath || mount.startsWith(`${basePath}/`))) return mount.slice(basePath.length);
  return mount;
}
