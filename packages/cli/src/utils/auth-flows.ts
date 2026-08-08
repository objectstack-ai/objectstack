// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared authentication flows for CLI login commands.
 *
 * Two commands consume this module:
 *   - `os login`         — log in to a runtime ObjectOS instance.
 *   - `os cloud login`   — log in to the hosted ObjectStack Cloud control plane.
 *
 * The flows themselves are identical (both target ObjectStack servers
 * speaking the same plugin-auth endpoints); only the credential storage
 * destination differs, which is the caller's responsibility.
 *
 * These helpers are intentionally side-effect-free with respect to disk
 * I/O so callers can persist the resulting token wherever they need to.
 * They DO write to stdout for the interactive device-flow UX; pass
 * `silent: true` to suppress all human-readable output (used by `--json`).
 *
 * ⚠ `silent: true` on its own is NOT a complete `--json` story, and #6730 is
 * what that costs. Silence removes the human-readable verification URL and
 * puts nothing in its place, so `os cloud login --json` reached stdout with a
 * single well-formed document and never handed automation the URL at all —
 * switching off the half of device flow that a script exists to use. A
 * `--json` caller therefore passes `silent: true` **and**
 * {@link BrowserFlowOptions.onDeviceCode}, which re-emits the same event in
 * machine-readable form, before the user authorizes.
 */

import { ObjectStackClient } from '@objectstack/client';

export interface AuthFlowUser {
  id?: string;
  email?: string;
}

export interface AuthFlowResult {
  token: string;
  user?: AuthFlowUser;
}

/**
 * Email + password authentication (CI / non-interactive path).
 */
export async function loginWithPassword(
  url: string,
  email: string,
  password: string,
): Promise<AuthFlowResult> {
  const client = new ObjectStackClient({ baseUrl: url });
  const response = await client.auth.login({ type: 'email', email, password });

  if (!response.data?.token && !response.data?.user) {
    throw new Error('Login failed: Invalid response from server');
  }

  const token = response.data?.token || (response as any).token;
  if (!token) throw new Error('Login failed: No token received from server');

  return {
    token,
    user: response.data?.user ? { id: response.data.user.id, email: response.data.user.email } : { email },
  };
}

/**
 * Open a URL in the system default browser (best-effort, cross-platform).
 */
async function openBrowser(url: string): Promise<void> {
  const { exec } = await import('node:child_process');
  const platform = process.platform;
  const cmd =
    platform === 'darwin'
      ? `open "${url}"`
      : platform === 'win32'
      ? `start "" "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, () => {
    /* best-effort */
  });
}

/**
 * RFC 8628 §3.2 device-authorization fields, spelled exactly as the server
 * sends them.
 *
 * Handed to {@link BrowserFlowOptions.onDeviceCode} verbatim rather than
 * re-derived by the caller, because for a `--json` caller these field names
 * ARE the wire contract: `os cloud login --json` emits this object as its
 * first NDJSON record (#6730), and it has to be field-identical to the record
 * `os login --json` emits (#6531) — a consumer written against the documented
 * stream must not have to special-case which of the two commands produced it.
 * The camelCase conveniences beside it exist for human-facing UI, where the
 * spelling is nobody's contract.
 */
export interface DeviceAuthorizationRecord {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in?: number;
}

export interface BrowserFlowOptions {
  /** OAuth client id; defaults to `OS_CLI_CLIENT_ID` env or `objectstack-cli`. */
  clientId?: string;
  /** If true, only print the verification URL — do not launch a browser. */
  noBrowser?: boolean;
  /** Suppress all human-readable stdout (callers using --json). */
  silent?: boolean;
  /**
   * Override the spinner / verification-URL printer for custom UI.
   *
   * Awaited: the `--json` caller writes an NDJSON record here, and
   * {@link emitJson} only resolves once the stdout write has actually drained
   * (a pipe buffers asynchronously — see `utils/format.ts`). Firing it and
   * walking straight into the poll loop would leave that guarantee to luck on
   * exactly the record automation needs first.
   */
  onDeviceCode?: (info: {
    verificationUrl: string;
    userCode: string;
    expiresIn: number;
    /** The server's own fields, for callers whose output shape is a contract. */
    record: DeviceAuthorizationRecord;
  }) => void | Promise<void>;
}

/**
 * RFC 8628 OAuth 2.0 Device Authorization Grant.
 */
export async function loginWithBrowser(
  url: string,
  opts: BrowserFlowOptions = {},
): Promise<AuthFlowResult> {
  const clientId = opts.clientId ?? process.env.OS_CLI_CLIENT_ID ?? 'objectstack-cli';
  const silent = !!opts.silent;

  // RFC 8628 §3.1 — Device Authorization Request
  const res = await globalThis.fetch(`${url}/api/v1/auth/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: 'openid profile email' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `Device request failed (${res.status}): ${(err as any)?.error_description || (err as any)?.message || res.statusText}`,
    );
  }
  const deviceData = (await res.json()) as any;
  const { device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval = 5 } =
    deviceData ?? {};

  if (!device_code || !user_code || !verification_uri) {
    throw new Error(
      'Server did not return RFC 8628 device authorization fields. Use `--email <email> --password <password>` instead.',
    );
  }

  const verificationUrl =
    verification_uri_complete || `${verification_uri}?user_code=${encodeURIComponent(user_code)}`;

  if (opts.onDeviceCode) {
    await opts.onDeviceCode({
      verificationUrl,
      userCode: user_code,
      expiresIn: expires_in ?? 600,
      record: { device_code, user_code, verification_uri, verification_uri_complete, expires_in },
    });
  } else if (!silent) {
    console.log('  To authorize this CLI, visit:');
    console.log('');
    console.log(`  ${verificationUrl}`);
    console.log('');
    console.log(`  User code: ${user_code}`);
    console.log('');
  }

  if (!opts.noBrowser && !silent) {
    await openBrowser(verificationUrl);
    console.log('  (Browser opened automatically. Press Ctrl+C to cancel.)');
    console.log('');
  }

  // RFC 8628 §3.4 — Device Access Token Request (poll)
  let pollMs = (interval || 5) * 1000;
  const expiryTime = Date.now() + (expires_in || 600) * 1000;
  let spinner = 0;
  const spinChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  while (Date.now() < expiryTime) {
    await new Promise((r) => setTimeout(r, pollMs));

    const pollRes = await globalThis.fetch(`${url}/api/v1/auth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code,
        client_id: clientId,
      }),
    });
    const pollJson = (await pollRes.json()) as any;

    if (pollRes.ok && pollJson?.access_token) {
      const accessToken = pollJson.access_token as string;

      // Resolve user info via /get-session (device-token response omits user details per RFC 8628)
      let user: AuthFlowUser | undefined;
      try {
        const sessionRes = await globalThis.fetch(`${url}/api/v1/auth/get-session`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (sessionRes.ok) {
          const sessionData = (await sessionRes.json()) as any;
          const u = sessionData?.user ?? sessionData?.data?.user;
          if (u) user = { id: u.id, email: u.email };
        }
      } catch {
        // best-effort
      }

      if (!silent) process.stdout.write('\r\x1b[K');
      return { token: accessToken, user };
    }

    // Standard RFC 8628 error codes
    const errCode = pollJson?.error;
    if (errCode === 'authorization_pending') {
      // keep polling
    } else if (errCode === 'slow_down') {
      pollMs += 5000;
    } else if (errCode === 'expired_token' || errCode === 'access_denied' || errCode === 'invalid_grant') {
      throw new Error(
        errCode === 'access_denied'
          ? 'Login denied by user.'
          : 'Login timed out or device code is no longer valid. Please retry.',
      );
    } else if (!pollRes.ok) {
      throw new Error(
        `Polling failed (${pollRes.status}): ${pollJson?.error_description || pollJson?.message || pollRes.statusText}`,
      );
    }

    if (!silent) {
      process.stdout.write(`\r  ${spinChars[spinner % spinChars.length]} Waiting for browser approval...`);
      spinner++;
    }
  }

  throw new Error('Login timed out.');
}
