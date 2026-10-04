// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectStackClient } from '@objectstack/client';
import { readAuthConfig, type AuthConfig } from './auth-config.js';
import { DEFAULT_CLOUD_URL, tryReadCloudConfig, type CloudConfig } from './cloud-config.js';
import { isSameControlPlane } from './active-environment.js';

/** Where `credentials.json`'s session points when it records no url. */
const DEFAULT_RUNTIME_URL = 'http://localhost:3000';

/**
 * The stored session a client's values were read from: `credentials.json`
 * (`os login`) or `cloud.json` (`os cloud login`).
 */
export type StoredSession = 'credentials' | 'cloud';

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
  /**
   * The control-plane URL this client actually talks to, after the precedence
   * below has been applied. Returned so a caller never has to re-derive it —
   * a second copy of that precedence is how the two drift apart.
   */
  baseUrl: string;
  /**
   * The stored session {@link createControlPlaneApiClient} chose — the file
   * whose server this client talks to. Unset when neither file was chosen, and
   * always unset from {@link createApiClient}, which reads `credentials.json`
   * only. A command that records an active environment back into a store reads
   * it, so it never writes one server's environment id into the other
   * server's file.
   */
  session?: StoredSession;
}

function buildClient(
  values: { baseUrl: string; token?: string; environmentId?: string; session?: StoredSession },
  debug: boolean | undefined,
): ApiClientResult {
  const { baseUrl, token, environmentId, session } = values;
  const client = new ObjectStackClient({
    baseUrl,
    token,
    environmentId,
    debug: debug || false,
  });
  return { client, token, environmentId, baseUrl, ...(session ? { session } : {}) };
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
    baseUrl = DEFAULT_RUNTIME_URL;
  }

  return buildClient({ baseUrl, token, environmentId }, options.debug);
}

/** One stored session, read as a candidate for a control-plane command. */
interface SessionCandidate {
  store: StoredSession;
  url: string | undefined;
  token: string | undefined;
  activeEnvironmentId: string | undefined;
}

/**
 * Choose the stored session a control-plane command talks with. The ONE copy
 * of this order — see {@link createControlPlaneApiClient}.
 */
function chooseControlPlaneSession(
  explicitUrl: string | undefined,
  runtime: AuthConfig | undefined,
  cloud: CloudConfig | undefined,
): SessionCandidate | undefined {
  const fromCredentials: SessionCandidate | undefined = runtime
    ? { store: 'credentials', url: runtime.url, token: runtime.token, activeEnvironmentId: runtime.activeEnvironmentId }
    : undefined;
  const fromCloud: SessionCandidate | undefined = cloud
    ? {
        store: 'cloud',
        url: cloud.url || DEFAULT_CLOUD_URL,
        token: cloud.token,
        activeEnvironmentId: cloud.activeEnvironmentId,
      }
    : undefined;

  if (!explicitUrl) return fromCredentials ?? fromCloud;
  if (fromCredentials && isSameControlPlane(fromCredentials.url, explicitUrl)) return fromCredentials;
  if (fromCloud && isSameControlPlane(fromCloud.url, explicitUrl)) return fromCloud;
  // An explicit url neither file names: `credentials.json`'s session, as it
  // was before `cloud.json` was consulted at all — and ⛔ never `cloud.json`'s,
  // whose token goes only to the server that issued it.
  return fromCredentials;
}

/**
 * Create an authenticated client for the CONTROL-PLANE commands —
 * `os environments list | show | create | bind | switch`, which talk to
 * `/api/v1/cloud/environments` on the hosted cloud or a self-hosted control
 * plane.
 *
 * Two stored sessions can authenticate them (`cloud-config.ts` states why
 * there are two files): `credentials.json`, written by `os login`, and
 * `cloud.json`, written by `os cloud login`. This is the one place that
 * chooses between them — ⛔ never a second copy per command:
 *
 * 1. `credentials.json`'s session where it targets the server this command
 *    talks to. With no `--url` / `OS_CLOUD_URL` it names that server itself,
 *    so a user who has run `os login` sees no change at all.
 * 2. Else `cloud.json`'s session, on the same terms: with no explicit url it
 *    names the server (its recorded url, or `https://cloud.objectos.ai`).
 * 3. Else — an explicit url neither file names — `credentials.json`'s session
 *    as before; never `cloud.json`'s.
 *
 * Explicit options and env vars (`url` / `OS_CLOUD_URL`, `token` / `OS_TOKEN`,
 * `environmentId` / `OS_ENVIRONMENT_ID`) still win field by field, exactly as
 * in {@link createApiClient}; the chosen session fills only what they leave
 * open. The active environment comes from the chosen session's own file: an
 * environment id resolves only on the server that recorded it
 * (`active-environment.ts`).
 */
export async function createControlPlaneApiClient(options: ApiClientOptions = {}): Promise<ApiClientResult> {
  const explicitUrl = options.url || process.env.OS_CLOUD_URL;
  const runtime = await readAuthConfig().catch(() => undefined);
  const cloud = await tryReadCloudConfig();
  const chosen = chooseControlPlaneSession(explicitUrl, runtime, cloud);

  return buildClient(
    {
      baseUrl: explicitUrl || chosen?.url || DEFAULT_RUNTIME_URL,
      token: options.token || process.env.OS_TOKEN || chosen?.token,
      environmentId: options.environmentId || process.env.OS_ENVIRONMENT_ID || chosen?.activeEnvironmentId,
      session: chosen?.store,
    },
    options.debug,
  );
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

/**
 * {@link requireAuth} for the control-plane commands, whose remedy names both
 * logins: a client from {@link createControlPlaneApiClient} accepts either
 * stored session, and the hosted one is the one most users need.
 */
export function requireControlPlaneAuth(token?: string): void {
  if (!token) {
    throw new Error(
      'Authentication required. Run `os cloud login` for ObjectStack Cloud or `os login` for a '
        + 'self-hosted control plane, or set OS_TOKEN.'
    );
  }
}
