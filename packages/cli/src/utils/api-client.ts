// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectStackClient } from '@objectstack/client';
import { readAuthConfig } from './auth-config.js';

/**
 * API client configuration options for CLI commands
 */
export interface ApiClientOptions {
  /**
   * Server URL (defaults to OS_CLOUD_URL env var or http://localhost:3000)
   */
  url?: string;
  /**
   * Authentication token (defaults to stored credentials or OS_TOKEN env var)
   */
  token?: string;
  /**
   * Explicit environment id. Overrides the stored `activeEnvironmentId` from
   * `~/.objectstack/credentials.json` (written by `os environments switch`).
   */
  environmentId?: string;
  /**
   * Enable debug logging
   */
  debug?: boolean;
}

/**
 * Result returned by createApiClient — exposes the resolved token so commands
 * can call requireAuth() without accessing private client fields.
 */
export interface ApiClientResult {
  client: ObjectStackClient;
  token?: string;
  environmentId?: string;
}

/**
 * Create an authenticated ObjectStack API client for CLI commands.
 *
 * Resolves configuration in this priority order:
 * 1. Explicit options passed to the function
 * 2. Environment variables (OS_CLOUD_URL, OS_TOKEN)
 * 3. Stored credentials from `os login`
 * 4. Defaults (http://localhost:3000)
 */
export async function createApiClient(options: ApiClientOptions = {}): Promise<ApiClientResult> {
  // Resolve server URL (without applying defaults yet)
  let baseUrl = options.url || process.env.OS_CLOUD_URL;

  // Resolve authentication token
  let token = options.token || process.env.OS_TOKEN;

  // Resolve active environment id (explicit > env > stored credentials)
  let environmentId = options.environmentId || process.env.OS_ENVIRONMENT_ID;

  // If URL or token is missing, try to load from stored credentials
  if (!baseUrl || !token || !environmentId) {
    try {
      const authConfig = await readAuthConfig();
      if (!token && authConfig.token) {
        token = authConfig.token;
      }
      if (!baseUrl && authConfig.url) {
        baseUrl = authConfig.url;
      }
      if (!environmentId && authConfig.activeEnvironmentId) {
        environmentId = authConfig.activeEnvironmentId;
      }
    } catch {
      // No stored credentials - commands will fail if auth is required
    }
  }

  // Apply final default for baseUrl if still not resolved
  if (!baseUrl) {
    baseUrl = 'http://localhost:3000';
  }

  const client = new ObjectStackClient({
    baseUrl,
    token,
    environmentId,
    debug: options.debug || false,
  });

  return { client, token, environmentId };
}

/**
 * Ensure authentication is present, throwing an error if not.
 * Use this in commands that require authentication.
 */
export function requireAuth(token?: string): void {
  if (!token) {
    throw new Error(
      'Authentication required. Please run `os login` or set OS_TOKEN environment variable.'
    );
  }
}
