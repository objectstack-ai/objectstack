// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which environment a command that INSTALLS into ObjectOS Cloud installs into —
 * one resolution for every such command (`os package publish --install` and
 * `os deploy`), so the two cannot disagree about where a package lands.
 *
 * ## The order
 *
 *   1. the explicit id — `--env`, which oclif also fills from `$OS_ENVIRONMENT_ID`;
 *   2. the active environment `os environments switch` / `os environments create
 *      --activate` recorded in `cloud.json` FOR THIS CONTROL PLANE
 *      (`active-environment.ts` owns that gate; this module adds no second one);
 *   3. the organization's ONLY environment, asked of the control plane
 *      (`GET /api/v1/cloud/environments`, which the control plane already
 *      filters to the caller's own organizations). On ObjectOS Cloud every
 *      organization has exactly one environment (cloud ADR-0024), so for nearly
 *      everyone this step is the answer and nobody has to type a uuid.
 *
 * ## No guess — refuse before any write
 *
 * Zero environments, several, or a list the control plane would not give: the
 * answer is a REFUSAL naming how to pass one, and the caller exits non-zero
 * before its first write. A command that was asked to install and did not
 * must never read as success — publishing anyway and saying "skipping
 * auto-install" on one line of a successful run is the shape this replaces.
 *
 * Archived and platform-infrastructure (`is_system`) rows are not candidates:
 * neither is an environment a developer installs into, and counting an
 * archived row would turn "the only environment" into "several" for every
 * organization that ever archived one.
 */

import { resolveCloudActiveEnvironmentId } from './active-environment.js';
import { readErrorMessage } from './response-envelope.js';

/** One environment as the control plane's list answers it, reduced to what a pick needs. */
export interface CloudEnvironmentSummary {
  id: string;
  displayName?: string;
  organizationId?: string;
  status?: string;
  /** `is_system` on the row: platform infrastructure, not an environment a developer installs into. */
  infrastructure?: boolean;
}

/** The list call's outcome: the rows, or why there are none to read. */
export type EnvironmentListOutcome =
  | { ok: true; environments: CloudEnvironmentSummary[] }
  | { ok: false; status: number; error: string };

/** Reads the caller's environments from one control plane. Injected in tests. */
export type ListCloudEnvironments = (args: {
  baseUrl: string;
  token: string;
  timeoutMs: number;
}) => Promise<EnvironmentListOutcome>;

/** Where a resolved install target came from — printed, so the user sees why. */
export type InstallTargetSource = 'flag' | 'active' | 'only';

export type InstallTargetResolution =
  | { kind: 'resolved'; environmentId: string; source: InstallTargetSource; displayName?: string }
  | { kind: 'refused'; message: string };

/**
 * `GET {baseUrl}/api/v1/cloud/environments` with the publish credential.
 * Never throws: a network failure, a timeout and a non-2xx are all an
 * `ok: false` the resolver turns into a refusal.
 */
export const listCloudEnvironments: ListCloudEnvironments = async ({ baseUrl, token, timeoutMs }) => {
  const controller = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const response = await fetch(`${baseUrl}/api/v1/cloud/environments`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    let parsed: any = null;
    try { parsed = await response.json(); } catch { /* empty / non-json */ }
    if (!response.ok) {
      return { ok: false, status: response.status, error: readErrorMessage(parsed, response) };
    }
    const rows = (parsed?.data ?? parsed)?.environments;
    if (!Array.isArray(rows)) {
      return { ok: false, status: response.status, error: 'the answer carried no `environments` list' };
    }
    return {
      ok: true,
      environments: rows
        .filter((row: any) => row && typeof row.id === 'string' && row.id)
        .map((row: any) => ({
          id: row.id,
          displayName: typeof row.display_name === 'string' && row.display_name ? row.display_name : undefined,
          organizationId: typeof row.organization_id === 'string' ? row.organization_id : undefined,
          status: typeof row.status === 'string' ? row.status : undefined,
          infrastructure: row.is_system === true || row.is_system === 1,
        })),
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false, status: 0, error: `the request timed out after ${timeoutMs}ms` };
    }
    return { ok: false, status: 0, error: err?.message ?? String(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** The rows a developer can install into: not archived, not platform infrastructure. */
export function installableEnvironments(rows: CloudEnvironmentSummary[]): CloudEnvironmentSummary[] {
  return rows.filter((row) => row.status !== 'archived' && !row.infrastructure);
}

/** `name (id)`, or the bare id when the row has no name. */
export function describeEnvironment(env: { id: string; displayName?: string }): string {
  return env.displayName ? `${env.displayName} (${env.id})` : env.id;
}

/**
 * Resolve the install target. `subject` names what needs it, for the refusal's
 * first words — `--install` on `os package publish`, `os deploy` on deploy.
 * `purpose` finishes "needs an environment …" for a caller that does not
 * install (`os mcp connect` connects to it); the resolution is the same one.
 */
export async function resolveInstallTarget(args: {
  subject: string;
  purpose?: string;
  explicit: string | undefined;
  baseUrl: string;
  token: string;
  timeoutMs: number;
  list?: ListCloudEnvironments;
}): Promise<InstallTargetResolution> {
  const explicit = args.explicit?.trim();
  if (explicit) return { kind: 'resolved', environmentId: explicit, source: 'flag' };

  const active = await resolveCloudActiveEnvironmentId(args.baseUrl);
  if (active) return { kind: 'resolved', environmentId: active, source: 'active' };

  const needs = `${args.subject} needs an environment ${args.purpose ?? 'to install into'}`;
  const remedy = 'Pass `--env <id>` (or set $OS_ENVIRONMENT_ID), or record one with `os environments switch <id>`.';
  const listed = await (args.list ?? listCloudEnvironments)({
    baseUrl: args.baseUrl,
    token: args.token,
    timeoutMs: args.timeoutMs,
  });
  if (!listed.ok) {
    return {
      kind: 'refused',
      message:
        `${needs}. None was given, and the list of your `
        + `organization's environments on ${args.baseUrl} could not be read`
        + `${listed.status ? ` (${listed.status})` : ''}: ${listed.error}. ${remedy}`,
    };
  }

  const candidates = installableEnvironments(listed.environments);
  if (candidates.length === 1) {
    const only = candidates[0];
    return { kind: 'resolved', environmentId: only.id, source: 'only', displayName: only.displayName };
  }
  if (candidates.length === 0) {
    return {
      kind: 'refused',
      message:
        `${needs}, and your account has none on ${args.baseUrl}. `
        + `Create one in the ObjectOS Cloud console, then run this again. ${remedy}`,
    };
  }
  return {
    kind: 'refused',
    message:
      `${needs}, and your account can reach `
      + `${candidates.length} on ${args.baseUrl}, so none was picked:\n`
      + candidates.map((env) => `    • ${describeEnvironment(env)}`).join('\n')
      + `\n  ${remedy}`,
  };
}

/** The progress line naming where the install goes and why there. */
export function installTargetLine(target: Extract<InstallTargetResolution, { kind: 'resolved' }>): string {
  const where = describeEnvironment({ id: target.environmentId, displayName: target.displayName });
  switch (target.source) {
    case 'only':
      return `Installing into ${where}, your organization's only environment`;
    case 'active':
      return `Installing into the active environment ${where} (os environments switch / os environments create --activate)`;
    default:
      return `Installing into ${where}`;
  }
}
