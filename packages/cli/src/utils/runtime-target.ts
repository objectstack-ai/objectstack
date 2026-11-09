// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The self-hosted runtime a developer deploys into — ObjectStack's Docker image
 * (Community) or ObjectOS Enterprise — remembered so nobody types its url and
 * key on every deploy.
 *
 * ## One record, three readers
 *
 * `os environments use-runtime <url> --token <key>` records it and makes it the
 * active deploy target (`os environments switch` makes the cloud active again).
 * Then:
 *
 *   - `os deploy` (and `os dev`'s `d` key, which runs it) installs into it when
 *     it is the ACTIVE target ({@link activeRuntimeTarget});
 *   - `os package install` falls back to it when `-u` / `-t` are not given,
 *     active or not — that command only ever talks to a runtime
 *     ({@link runtimeInstallTarget}).
 *
 * The record is stored by `cloud-config.ts` (its header: the deploy-target half
 * of `~/.objectstack/cloud.json`, 0600); this module adds no second store.
 *
 * ## The key goes only to the runtime that issued it
 *
 * A `--url` naming another server never receives the stored key: the url
 * identity is `isSameControlPlane` (`active-environment.ts`), the one
 * comparison every stored-credential read in this CLI uses.
 */

import {
  readDeployTargetRecord,
  writeDeployTargetRecord,
  type RuntimeTarget,
} from './cloud-config.js';
import { isSameControlPlane } from './active-environment.js';

/** `os package install`'s url when nothing names one. */
export const DEFAULT_RUNTIME_INSTALL_URL = 'http://localhost:3000';

function usable(target: RuntimeTarget | undefined): RuntimeTarget | undefined {
  if (!target || typeof target.url !== 'string' || !target.url.trim()) return undefined;
  if (typeof target.token !== 'string' || !target.token) return undefined;
  return { ...target, url: target.url.trim().replace(/\/+$/, '') };
}

/** The recorded runtime, active or not; undefined when none (or none usable) is recorded. */
export async function storedRuntimeTarget(): Promise<RuntimeTarget | undefined> {
  return usable((await readDeployTargetRecord()).runtimeTarget);
}

/** The recorded runtime when it is the active deploy target. */
export async function activeRuntimeTarget(): Promise<RuntimeTarget | undefined> {
  const record = await readDeployTargetRecord();
  return record.deployTarget === 'runtime' ? usable(record.runtimeTarget) : undefined;
}

/** Record `url` + `token` and make the runtime the active deploy target. */
export async function recordRuntimeTarget(url: string, token: string, now: Date = new Date()): Promise<RuntimeTarget> {
  const target: RuntimeTarget = { url: url.trim().replace(/\/+$/, ''), token, recordedAt: now.toISOString() };
  await writeDeployTargetRecord({ runtimeTarget: target, deployTarget: 'runtime' });
  return target;
}

/** Forget the recorded runtime; the cloud becomes the deploy target. Returns what was forgotten. */
export async function forgetRuntimeTarget(): Promise<RuntimeTarget | undefined> {
  const previous = usable((await readDeployTargetRecord()).runtimeTarget);
  await writeDeployTargetRecord({});
  return previous;
}

/**
 * Make the cloud the active deploy target, keeping the recorded runtime.
 * Returns the runtime's url when it WAS the active target (the caller says so),
 * else undefined, writing nothing.
 */
export async function activateCloudDeployTarget(): Promise<string | undefined> {
  const record = await readDeployTargetRecord();
  if (record.deployTarget !== 'runtime') return undefined;
  await writeDeployTargetRecord({ ...record, deployTarget: 'cloud' });
  return record.runtimeTarget?.url ?? '';
}

/**
 * `os package install`'s server and key: an explicit `--url` / `--token` (oclif
 * fills them from `$OS_RUNTIME_URL` / `$OS_RUNTIME_TOKEN`) win; the stored
 * runtime fills what they leave open, its key only when the url is its own;
 * the url falls back to {@link DEFAULT_RUNTIME_INSTALL_URL}.
 *
 * `useStoredToken: false` when the caller authenticates otherwise
 * (`--email` / `--password`), so two identities are never mixed.
 */
export async function runtimeInstallTarget(flags: {
  url?: string;
  token?: string;
  useStoredToken: boolean;
}): Promise<{ url: string; token: string | undefined; rememberedUrl: boolean; rememberedToken: boolean }> {
  const explicitUrl = flags.url?.trim() ? flags.url.trim().replace(/\/+$/, '') : undefined;
  const wantsStored = !explicitUrl || (!flags.token && flags.useStoredToken);
  const stored = wantsStored ? await storedRuntimeTarget() : undefined;
  const url = explicitUrl ?? stored?.url ?? DEFAULT_RUNTIME_INSTALL_URL;
  const rememberedToken = Boolean(stored && flags.useStoredToken && !flags.token && isSameControlPlane(stored.url, url));
  return {
    url,
    token: flags.token ?? (rememberedToken ? stored!.token : undefined),
    rememberedUrl: !explicitUrl && Boolean(stored),
    rememberedToken,
  };
}
