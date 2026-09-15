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
 *   2. **Cloud identity** — who you are on the official ObjectStack Cloud
 *      package registry (`https://cloud.objectos.ai`). Stored in
 *      `cloud.json`, written by `os cloud login`. Used to publish &
 *      install packages, browse the marketplace, etc.
 *
 * Keeping them in separate files makes it unambiguous which token a
 * command is going to use, and makes it impossible to accidentally
 * publish a package with a runtime-scoped token.
 */

import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
   * `--env` fallback. It sits here, beside this file's own `url`, because an
   * environment id is only resolvable on the server it was chosen on — see
   * `active-environment.ts`, which owns that gate.
   */
  activeEnvironmentId?: string;
  /** ISO timestamp when the credential was created. */
  createdAt: string;
  /** ISO timestamp of last use (best-effort). */
  lastUsedAt?: string;
}

export function getCloudCredentialsPath(): string {
  return join(homedir(), '.objectstack', 'cloud.json');
}

export async function readCloudConfig(): Promise<CloudConfig> {
  const path = getCloudCredentialsPath();
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content) as CloudConfig;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error('Not logged in to ObjectStack Cloud. Run `os cloud login` first.');
    }
    throw new Error(`Failed to read cloud credentials: ${error.message}`);
  }
}

export async function tryReadCloudConfig(): Promise<CloudConfig | undefined> {
  try {
    return await readCloudConfig();
  } catch {
    return undefined;
  }
}

export async function writeCloudConfig(config: CloudConfig): Promise<void> {
  const path = getCloudCredentialsPath();
  const dir = join(homedir(), '.objectstack');

  await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 });
  try {
    await chmod(path, 0o600);
  } catch {
    // Platforms without chmod support — silently continue.
  }
}

export async function deleteCloudConfig(): Promise<void> {
  const path = getCloudCredentialsPath();
  try {
    await unlink(path);
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw new Error(`Failed to delete cloud credentials: ${error.message}`);
    }
  }
}
