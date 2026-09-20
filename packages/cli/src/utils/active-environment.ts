// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where an "active environment id" lives, and which control plane it belongs to.
 *
 * ## An environment id is only meaningful against ONE server
 *
 * The CLI keeps two credential stores on purpose (`cloud-config.ts`'s header
 * states the split): `credentials.json` is the **runtime** identity — who you
 * are inside your own ObjectOS instance — and `cloud.json` is the **cloud**
 * identity on the package registry. They are not two spellings of one account:
 * they carry **different servers**. `credentials.json`'s url falls back to
 * `http://localhost:3000` (`api-client.ts`), `cloud.json`'s default is
 * `https://cloud.objectos.ai` (`DEFAULT_CLOUD_URL`), and that second one is
 * where `os package publish` POSTs.
 *
 * So `activeEnvironmentId` means *"an environment on the server this file is
 * about"*. Handing `credentials.json`'s copy to a publish aimed at
 * cloud.objectos.ai names a uuid belonging to a **different control plane**;
 * the server resolves an install target by bare id, with no name or short-id
 * rescue, so the best case is a 404 and the worst is a stranger's id.
 *
 * ⛔ That is why `os package publish` must never read `credentials.json` for
 * this value, and why every read and write below is gated on the two urls
 * agreeing. The gate — not the file name — is the invariant.
 *
 * ## Two stores, two active environments
 *
 * `os environments switch` keeps writing `credentials.json` (that is the copy
 * `createApiClient` reads for the `data` / `meta` / `environments` families,
 * and `os environments` authenticating as the runtime identity is deliberate).
 * When the control plane it just talked to IS `cloud.json`'s server, it records
 * the same id there too — and that is the copy the publish reads back.
 *
 * ## Two writers, ONE gate
 *
 * `os environments switch <id>` is not the only command that names an active
 * environment: `os environments create --activate` (the default) names the one
 * it just provisioned, and that is the FIRST half of the flow this module
 * exists for — create your own cloud dev environment, publish into it, with no
 * `switch` anywhere. Both writers call `recordCloudActiveEnvironmentId` and
 * neither carries a url check of its own: a second copy of this gate is how
 * one of the two stops gating while every test still passes.
 */

import { readAuthConfig } from './auth-config.js';
import { tryReadCloudConfig, writeCloudConfig } from './cloud-config.js';

/**
 * A base url reduced to the identity of the server it names: scheme, host and
 * path, without a trailing slash, query or fragment. `new URL` already
 * lower-cases scheme and host; an unparseable string is compared as typed
 * rather than silently treated as "no url", so a malformed entry can still
 * only ever match itself.
 */
export function normalizeControlPlaneUrl(url: string | undefined | null): string | undefined {
  if (typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

/**
 * True when two recorded urls name the same control plane. An absent url on
 * either side is NOT a match: "I do not know which server this is" must never
 * read as "the one you are pointed at".
 */
export function isSameControlPlane(
  a: string | undefined | null,
  b: string | undefined | null,
): boolean {
  const left = normalizeControlPlaneUrl(a);
  const right = normalizeControlPlaneUrl(b);
  return left !== undefined && left === right;
}

/**
 * Record `environmentId` as the active environment in `cloud.json`, but only
 * when `controlPlaneUrl` is the server that file is about.
 *
 * @returns `true` when the id was written, `false` when there is no cloud
 * credential or it belongs to a different control plane (both ordinary —
 * the caller keeps its own store either way).
 */
export async function recordCloudActiveEnvironmentId(
  environmentId: string,
  controlPlaneUrl: string | undefined,
): Promise<boolean> {
  const cloud = await tryReadCloudConfig();
  if (!cloud) return false;
  if (!isSameControlPlane(cloud.url, controlPlaneUrl)) return false;

  cloud.activeEnvironmentId = environmentId;
  cloud.lastUsedAt = new Date().toISOString();
  await writeCloudConfig(cloud);
  return true;
}

/**
 * The active environment id for the control plane at `controlPlaneUrl`, read
 * from `cloud.json` — the `--env` fallback for `os package publish`.
 *
 * One-time migration: a user who ran `os environments switch` before this
 * value existed in `cloud.json` has it in `credentials.json` instead. It is
 * copied across once — and **only** when both files' urls name the control
 * plane being published to, so the copy can never cross planes. Once copied,
 * `credentials.json` is not consulted again; the migration is the single
 * guarded seam, never a resolution path.
 */
export async function resolveCloudActiveEnvironmentId(
  controlPlaneUrl: string | undefined,
): Promise<string | undefined> {
  const cloud = await tryReadCloudConfig();
  if (!cloud) return undefined;
  if (!isSameControlPlane(cloud.url, controlPlaneUrl)) return undefined;
  if (cloud.activeEnvironmentId) return cloud.activeEnvironmentId;

  const runtime = await readAuthConfig().catch(() => undefined);
  if (!runtime?.activeEnvironmentId) return undefined;
  if (!isSameControlPlane(runtime.url, controlPlaneUrl)) return undefined;

  cloud.activeEnvironmentId = runtime.activeEnvironmentId;
  await writeCloudConfig(cloud);
  return cloud.activeEnvironmentId;
}
