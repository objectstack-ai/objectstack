// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Cloud credential store — separate from the runtime credential store at
 * `~/.objectstack/credentials.json`.
 *
 * Why a second file?
 * ------------------
 * ObjectStack now has two distinct identities on a developer's machine:
 *
 *   1. **Runtime identity** — who you are inside your *own* ObjectOS
 *      instance (the CRM / Todo / app you're building). Stored in
 *      `credentials.json`, written by `os login`.
 *
 *   2. **Cloud identity** — who you are on the official ObjectOS Cloud
 *      package registry (`https://cloud.objectos.ai`). Stored in
 *      `cloud.json`, written by `os cloud login`. Used to publish &
 *      install packages, browse the marketplace, etc.
 *
 * Keeping them in separate files makes it unambiguous which token a
 * command is going to use, and makes it impossible to accidentally
 * publish a package with a runtime-scoped token.
 *
 * The control-plane commands (`os environments …`) are the one family that
 * can run on either session, because a control plane is either the hosted
 * cloud or a self-hosted server. Which one they use is decided in ONE place,
 * `createControlPlaneApiClient` in `api-client.ts`: `credentials.json`'s
 * session where it targets the server, else this file's — and for that
 * family this file's token goes only to this file's `url`.
 *
 * ## The deploy target — this file's second half
 *
 * `os deploy` (and `os dev`'s `d` key, which runs it) installs into ONE target:
 * the ObjectOS Cloud environment this file's session reaches, or a self-hosted
 * runtime `os environments use-runtime` recorded — its url and an API key that
 * runtime issued, in `runtimeTarget`. Which one is active is `deployTarget`.
 * The key lives here, in this protected (0600) file, beside the cloud token,
 * but in its OWN named record: no cloud read ({@link resolveCloudCredential},
 * `token`) ever sees it, and it is sent only to its own `url`
 * (`runtime-target.ts`). The two halves outlive each other: `os cloud logout`
 * clears the cloud session and keeps the runtime target, and a cloud login
 * keeps it too — {@link writeCloudConfig} carries it across every cloud write,
 * and only {@link writeDeployTargetRecord} changes it.
 */

import { chmod, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { makeDirectorySync } from './make-directory.js';

/** Canonical hosted control plane. */
export const DEFAULT_CLOUD_URL = 'https://cloud.objectos.ai';

export interface CloudConfig {
  /** Base URL of the cloud control plane (defaults to `https://cloud.objectos.ai`). */
  url: string;
  /** Bearer token returned by the device or password flow. */
  token: string;
  /** Authenticated user's email, for display. */
  email?: string;
  /** Authenticated user's id. */
  userId?: string;
  /** Active organization id chosen for publishing. */
  activeOrgId?: string;
  /**
   * Active environment id **on this control plane**, recorded by
   * `os environments switch` and read back by `os package publish` as the
   * `--env` fallback, and by `os environments` when it runs on this session.
   * It sits here, beside this file's own `url`, because an environment id is
   * only resolvable on the server it was chosen on — see
   * `active-environment.ts`, which owns that gate.
   */
  activeEnvironmentId?: string;
  /** ISO timestamp when the credential was created. */
  createdAt: string;
  /** ISO timestamp of last use (best-effort). */
  lastUsedAt?: string;
  /** The self-hosted runtime target — see the header; written only by {@link writeDeployTargetRecord}. */
  runtimeTarget?: RuntimeTarget;
  /** Which target `os deploy` uses; absent means the cloud. Written only by {@link writeDeployTargetRecord}. */
  deployTarget?: DeployTargetKind;
}

/** A self-hosted runtime `os deploy` installs into, recorded by `os environments use-runtime`. */
export interface RuntimeTarget {
  /** Base URL of the runtime (the one `os package install --url` would name). */
  url: string;
  /** An API key the runtime issued — sent only to `url`. */
  token: string;
  /** ISO timestamp when it was recorded. */
  recordedAt: string;
}

/** The two targets `os deploy` knows. */
export type DeployTargetKind = 'cloud' | 'runtime';

/** The deploy-target half of the file: everything a cloud write must carry across untouched. */
export interface DeployTargetRecord {
  runtimeTarget?: RuntimeTarget;
  deployTarget?: DeployTargetKind;
}

const DEPLOY_TARGET_KEYS = ['runtimeTarget', 'deployTarget'] as const;

export function getCloudCredentialsPath(): string {
  return join(homedir(), '.objectstack', 'cloud.json');
}

/** The file as stored, both halves; `{}` when there is none. */
async function readCloudFile(): Promise<Record<string, any>> {
  try {
    const parsed = JSON.parse(await readFile(getCloudCredentialsPath(), 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error: any) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Failed to read cloud credentials: ${error.message}`);
  }
}

async function writeCloudFile(content: Record<string, unknown>): Promise<void> {
  const path = getCloudCredentialsPath();
  if (Object.keys(content).length === 0) {
    try {
      await unlink(path);
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw new Error(`Failed to delete cloud credentials: ${error.message}`);
    }
    return;
  }
  // Bounded (#23858): see `writeAuthConfig`.
  makeDirectorySync(join(homedir(), '.objectstack'));
  await writeFile(path, JSON.stringify(content, null, 2), { mode: 0o600 });
  try {
    await chmod(path, 0o600);
  } catch {
    // Platforms without chmod support — silently continue.
  }
}

/** For a writer: a file that will not parse carries nothing across — the write replaces it, as it always did. */
async function readCloudFileForWrite(): Promise<Record<string, any>> {
  try {
    return await readCloudFile();
  } catch {
    return {};
  }
}

function deployTargetHalf(content: Record<string, any>): DeployTargetRecord {
  const half: Record<string, unknown> = {};
  for (const key of DEPLOY_TARGET_KEYS) if (content[key] !== undefined) half[key] = content[key];
  return half as DeployTargetRecord;
}

function withoutDeployTarget(content: Record<string, any>): Record<string, any> {
  const rest = { ...content };
  for (const key of DEPLOY_TARGET_KEYS) delete rest[key];
  return rest;
}

/**
 * The cloud session. A file that holds only a deploy target (`os environments
 * use-runtime` without `os cloud login`) holds no session: that reads as not
 * logged in, exactly as no file does.
 */
export async function readCloudConfig(): Promise<CloudConfig> {
  const content = await readCloudFile();
  if (typeof content.token !== 'string' || !content.token) {
    throw new Error('Not logged in to ObjectOS Cloud. Run `os cloud login` first.');
  }
  return content as CloudConfig;
}

export async function tryReadCloudConfig(): Promise<CloudConfig | undefined> {
  try {
    return await readCloudConfig();
  } catch {
    return undefined;
  }
}

/**
 * Write the cloud session. The deploy-target half on disk is carried across
 * whatever `config` holds of it: a login builds a fresh record, and must not
 * forget the self-hosted runtime on the way.
 */
export async function writeCloudConfig(config: CloudConfig): Promise<void> {
  const onDisk = deployTargetHalf(await readCloudFileForWrite());
  await writeCloudFile({ ...withoutDeployTarget(config), ...onDisk });
}

/** Clear the cloud session; a recorded deploy target stays (see the header). */
export async function deleteCloudConfig(): Promise<void> {
  await writeCloudFile(deployTargetHalf(await readCloudFileForWrite()));
}

/** The deploy-target half as stored; `{}` when nothing is recorded. */
export async function readDeployTargetRecord(): Promise<DeployTargetRecord> {
  return deployTargetHalf(await readCloudFile());
}

/** Replace the deploy-target half; the cloud session on disk is kept as it is. */
export async function writeDeployTargetRecord(record: DeployTargetRecord): Promise<void> {
  const content = withoutDeployTarget(await readCloudFileForWrite());
  await writeCloudFile({ ...content, ...deployTargetHalf(record as Record<string, unknown>) });
}

/**
 * The credential and control plane a cloud WRITE uses — `os package publish`
 * and `os deploy` alike, so the two cannot aim at different servers.
 *
 * Token: the explicit `--token` (oclif fills it from `$OS_CLOUD_API_KEY`),
 * then `$OS_TOKEN`, then this file's. Server: an explicit `--server` /
 * `$OS_CLOUD_URL`, then this file's recorded url, then {@link DEFAULT_CLOUD_URL}.
 * ⛔ `credentials.json` (the runtime identity, `os login`) is never read: a
 * package published with a runtime-scoped token is the mistake this file's
 * header exists to make impossible.
 *
 * `token` is undefined when no source has one; the caller refuses.
 */
export async function resolveCloudCredential(flags: {
  token?: string;
  server: string;
}): Promise<{ token: string | undefined; baseUrl: string }> {
  let token = flags.token ?? process.env.OS_TOKEN ?? undefined;
  let baseUrl = flags.server.replace(/\/+$/, '');
  const serverFlagWasDefault = !process.env.OS_CLOUD_URL && baseUrl === DEFAULT_CLOUD_URL;
  if (!token || serverFlagWasDefault) {
    const stored = await tryReadCloudConfig();
    if (!token && stored?.token) token = stored.token;
    if (serverFlagWasDefault && stored?.url) baseUrl = stored.url.replace(/\/+$/, '');
  }
  return { token, baseUrl };
}
