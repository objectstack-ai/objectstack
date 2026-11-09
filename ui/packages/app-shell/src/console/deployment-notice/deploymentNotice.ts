// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The deployment notice's wire and storage (objectstack#30120, ruling A3).
 *
 * A production deployment that boots without `OS_DATABASE_URL`,
 * `OS_AUTH_SECRET` or `OS_SECRET_KEY` keeps its data and both secrets on its
 * own disk. The server states that to administrators at
 * `GET /api/settings/deployment/notice` (`@objectstack/service-settings`,
 * `deployment-notice.ts`), behind the settings door and the
 * `manage_platform_settings` capability: a member is refused `403`, and the
 * state is never on the public auth config. Outside production mode the
 * server answers no findings.
 *
 * A hide is two things: the server's `POST …/hide` writes the acknowledgement
 * to the audit log (and refuses when the deployment keeps none), and this
 * module remembers it for this administrator in this browser, keyed by the
 * fingerprint of what was acknowledged. A finding that appears later changes
 * the fingerprint, so the notice comes back.
 *
 * @module
 */

import { bearerAuthHeaders } from '../../utils/authToken.js';

export type DeploymentFindingId =
  | 'database_local_file'
  | 'auth_secret_generated'
  | 'data_key_file'
  | 'file_storage_local'
  | 'email_not_configured';

export interface DeploymentFinding {
  id: DeploymentFindingId;
  severity: 'high' | 'low';
  variable?: 'OS_DATABASE_URL' | 'OS_AUTH_SECRET' | 'OS_SECRET_KEY';
  file?: string;
}

export interface DeploymentNoticeState {
  production: boolean;
  findings: DeploymentFinding[];
  fingerprint: string;
}

const serverUrl = (): string => (import.meta.env?.VITE_SERVER_URL || '').replace(/\/$/, '');
const NOTICE_PATH = '/api/settings/deployment/notice';

const KNOWN_FINDINGS: ReadonlySet<string> = new Set<DeploymentFindingId>([
  'database_local_file',
  'auth_secret_generated',
  'data_key_file',
  'file_storage_local',
  'email_not_configured',
]);

/**
 * The served state, or `null` when there is none to draw: a refusal (a
 * member, a server without the route), a fault, or a body that is not the
 * declared shape. The notice is an aside, so none of these is an error the
 * page shows.
 */
export function parseDeploymentNotice(body: unknown): DeploymentNoticeState | null {
  const data =
    body && typeof body === 'object' && (body as { success?: unknown }).success === true
      ? (body as { data?: unknown }).data
      : undefined;
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.production !== 'boolean' || typeof d.fingerprint !== 'string' || !Array.isArray(d.findings)) {
    return null;
  }
  // A finding this Console has no words for is left out, not drawn blank.
  const findings = d.findings.filter(
    (f): f is DeploymentFinding =>
      !!f &&
      typeof f === 'object' &&
      KNOWN_FINDINGS.has((f as { id?: unknown }).id as string) &&
      ((f as { severity?: unknown }).severity === 'high' || (f as { severity?: unknown }).severity === 'low'),
  );
  return { production: d.production, findings, fingerprint: d.fingerprint };
}

export async function fetchDeploymentNotice(): Promise<DeploymentNoticeState | null> {
  try {
    const res = await fetch(`${serverUrl()}${NOTICE_PATH}`, {
      credentials: 'include',
      headers: { Accept: 'application/json', ...bearerAuthHeaders() },
    });
    if (!res.ok) return null;
    return parseDeploymentNotice(await res.json());
  } catch {
    return null;
  }
}

/** What the server said to a hide. */
export type HideAnswer = 'hidden' | 'no-audit-log' | 'changed' | 'failed';

export async function hideDeploymentNotice(fingerprint: string): Promise<HideAnswer> {
  try {
    const res = await fetch(`${serverUrl()}${NOTICE_PATH}/hide`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...bearerAuthHeaders() },
      body: JSON.stringify({ fingerprint }),
    });
    if (res.ok) return 'hidden';
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as { error?: { details?: { reason?: unknown } } } | null;
      // The deployment that keeps no audit log says so; every other conflict
      // is a notice that moved on since it was read.
      return body?.error?.details?.reason === 'no_audit_log' ? 'no-audit-log' : 'changed';
    }
    return 'failed';
  } catch {
    return 'failed';
  }
}

/** Per administrator, per browser: the fingerprint they hid. */
export const HIDDEN_KEY_PREFIX = 'os:deployment-notice-hidden:';

type HiddenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): HiddenStorage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function hiddenFingerprint(userId: string, store: HiddenStorage | undefined = storage()): string | null {
  try {
    return store?.getItem(HIDDEN_KEY_PREFIX + userId) ?? null;
  } catch {
    return null;
  }
}

export function rememberHidden(userId: string, fingerprint: string, store: HiddenStorage | undefined = storage()): void {
  try {
    store?.setItem(HIDDEN_KEY_PREFIX + userId, fingerprint);
  } catch {
    /* the server's audit row still records the hide */
  }
}

export function forgetHidden(userId: string, store: HiddenStorage | undefined = storage()): void {
  try {
    store?.removeItem(HIDDEN_KEY_PREFIX + userId);
  } catch {
    /* ignore */
  }
}

type T = (key: string, opts?: Record<string, unknown>) => string;

/**
 * The text the copy button puts on the clipboard: the variables to set, each
 * preceded by a comment saying what value it takes. An env-file shape, so it
 * pastes into a `.env`, a compose file's `environment:` or a platform's
 * variables screen.
 */
export function deploymentVariablesText(findings: readonly DeploymentFinding[], t: T): string {
  const lines: string[] = [];
  for (const f of findings) {
    if (f.severity !== 'high' || !f.variable) continue;
    if (lines.length > 0) lines.push('');
    if (f.id === 'database_local_file') {
      lines.push(
        `# ${t('deploymentNotice.copy.database', {
          defaultValue:
            'Your database, e.g. postgres://user:pass@db-host:5432/app, or file:/path/on/a/kept/volume/app.db. Today the data is in {{file}}: move it over before you switch.',
          file: f.file ?? '',
        })}`,
      );
    } else if (f.file) {
      lines.push(
        `# ${t('deploymentNotice.copy.carryOver', {
          defaultValue: 'Carry the current value over: the contents of {{file}}',
          file: f.file,
        })}`,
      );
    } else {
      lines.push(
        `# ${t('deploymentNotice.copy.newValue', {
          defaultValue: 'A long random value, the same on every restart, e.g. the output of: openssl rand -hex 32',
        })}`,
      );
    }
    lines.push(`${f.variable}=`);
  }
  return lines.join('\n');
}
