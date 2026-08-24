// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';

/**
 * Authentication configuration stored in ~/.objectstack/credentials.json
 */
export interface AuthConfig {
  /**
   * Server URL (base URL for the ObjectStack instance)
   */
  url: string;
  /**
   * Authentication token (Bearer token)
   */
  token: string;
  /**
   * User email (for display purposes)
   */
  email?: string;
  /**
   * User ID
   */
  userId?: string;
  /**
   * Timestamp when credentials were created
   */
  createdAt: string;
  /**
   * Timestamp when credentials were last used
   */
  lastUsedAt?: string;
  /**
   * Active project id for subsequent CLI calls. Set via `os environments switch`;
   * read by `createApiClient` so every command lands in the right project
   * without an explicit flag.
   */
  activeEnvironmentId?: string;
}

/**
 * Get the path to the credentials file
 */
export function getCredentialsPath(): string {
  return join(homedir(), '.objectstack', 'credentials.json');
}

/**
 * Read stored authentication configuration
 */
export async function readAuthConfig(): Promise<AuthConfig> {
  const path = getCredentialsPath();
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content) as AuthConfig;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error('No stored credentials found. Please run `os login` first.');
    }
    throw new Error(`Failed to read credentials: ${error.message}`);
  }
}

/**
 * Write authentication configuration
 */
export async function writeAuthConfig(config: AuthConfig): Promise<void> {
  const path = getCredentialsPath();
  const dir = join(homedir(), '.objectstack');

  // Ensure directory exists
  await mkdir(dir, { recursive: true });

  // Write credentials file
  await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 });

  // Explicitly enforce permissions in case the file already existed with broader perms
  try {
    await chmod(path, 0o600);
  } catch {
    // Best-effort — platforms that don't support chmod will silently continue
  }
}

/**
 * Delete stored authentication configuration
 */
export async function deleteAuthConfig(): Promise<void> {
  const path = getCredentialsPath();
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(path);
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw new Error(`Failed to delete credentials: ${error.message}`);
    }
  }
}

/**
 * Update last used timestamp
 */
export async function touchAuthConfig(): Promise<void> {
  try {
    const config = await readAuthConfig();
    config.lastUsedAt = new Date().toISOString();
    await writeAuthConfig(config);
  } catch {
    // Ignore errors - this is best-effort
  }
}
