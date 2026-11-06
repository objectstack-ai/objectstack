// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Is the environment serving the version I just installed?" — the one client
 * function `os deploy` waits on.
 *
 * ## Why a wait at all
 *
 * The control plane answers the install as soon as it has written the desired
 * state and evicted the kernel; the environment rebuilds afterwards, keeps
 * serving the OLD build while it does (stale-while-rebuild), and keeps serving
 * it if the build fails. So "installed" in the publish answer means "asked
 * for", and a developer who opens the app right away sees the old version
 * with no word that the new one failed to build.
 *
 * ## ⚠️ The read this polls is an ASSUMPTION until objectstack-ai/cloud#3651 lands
 *
 * The served-version signal is the server half's item 3, and its contract is
 * not final. Everything that depends on its shape lives in TWO functions here
 * — {@link fetchInstallationReport} (the request) and
 * {@link interpretInstallationReport} (the reading) — and nothing outside this
 * file knows the shape, so adopting the final contract edits this file only.
 *
 * Assumed: the installation read that exists today,
 * `GET /api/v1/cloud/environments/:envId/installations/:packageId` (keyed by the
 * internal `sys_package.id`, answered with the publish credential, envelope
 * `{ success, data }`), additionally answers the observed columns the control
 * database already carries on `sys_package_installation`, camel-cased beside
 * its existing `installed` / `installationId` / `version` keys:
 *
 *     observedStatus     'installed' | 'incomplete' | 'pending' | 'drift' | 'failed'
 *     observedVersionId  the sys_package_version.id the environment now serves
 *     observedVersion    that version's string
 *     reconcileError     the build failure's reason, when observedStatus is 'failed'
 *     lastReconciledAt   ISO time of the report the four above come from
 *
 * A report with NONE of those keys is a control plane that does not report a
 * served version yet — today's cloud. That is said plainly and the wait ends
 * without claiming the new version is live; it never spins to the timeout.
 */

import { readErrorMessage } from './response-envelope.js';

/** What the wait is for: one version of one package in one environment. */
export interface ServedVersionTarget {
  baseUrl: string;
  token: string;
  environmentId: string;
  /** `sys_package.id` (internal), the key the installation read uses. */
  packageId: string;
  /** Shown in messages. */
  manifestId: string;
  version: string;
  versionId: string | undefined;
  /** Client clock when the publish started; a failure reported before it is a previous build's. */
  since: number;
}

/** One reading of the installation, reduced to what the wait decides on. */
export type InstallationReading =
  | { kind: 'served'; version: string; incomplete: boolean }
  | { kind: 'failed'; reason: string }
  | { kind: 'pending'; observed: string }
  | { kind: 'unsupported' };

/** One poll's outcome, before interpretation. */
export type InstallationReport =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; error: string; retryable: boolean };

export type FetchInstallationReport = (target: ServedVersionTarget) => Promise<InstallationReport>;

/** The wait's verdict — the caller prints it and picks the exit code. */
export type ServedVersionVerdict =
  | { kind: 'served'; version: string; incomplete: boolean }
  | { kind: 'failed'; reason: string }
  | { kind: 'timeout'; waitedMs: number; lastObserved: string }
  | { kind: 'unsupported' }
  | { kind: 'unreadable'; status: number; error: string };

const OBSERVED_KEYS = ['observedStatus', 'observedVersionId', 'observedVersion', 'reconcileError', 'lastReconciledAt'];

/** The request half of the assumed contract. Never throws. */
export const fetchInstallationReport: FetchInstallationReport = async (target) => {
  const url =
    `${target.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(target.environmentId)}`
    + `/installations/${encodeURIComponent(target.packageId)}`;
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${target.token}` } });
    let parsed: any = null;
    try { parsed = await response.json(); } catch { /* empty / non-json */ }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: readErrorMessage(parsed, response),
        // An answer about the credential or the ids will not change by asking again.
        retryable: response.status >= 500 || response.status === 429,
      };
    }
    const data = parsed?.data ?? parsed;
    return { ok: true, data: data && typeof data === 'object' ? data : {} };
  } catch (err: any) {
    return { ok: false, status: 0, error: err?.message ?? String(err), retryable: true };
  }
};

/** The reading half of the assumed contract. Pure. */
export function interpretInstallationReport(
  data: Record<string, unknown>,
  target: Pick<ServedVersionTarget, 'version' | 'versionId' | 'since'>,
): InstallationReading {
  if (!OBSERVED_KEYS.some((key) => key in data)) return { kind: 'unsupported' };

  const status = typeof data.observedStatus === 'string' ? data.observedStatus : undefined;
  const observedVersionId = typeof data.observedVersionId === 'string' ? data.observedVersionId : undefined;
  const observedVersion = typeof data.observedVersion === 'string' ? data.observedVersion : undefined;
  const isOurs =
    (target.versionId !== undefined && observedVersionId === target.versionId)
    || observedVersion === target.version;

  if ((status === 'installed' || status === 'incomplete') && isOurs) {
    return { kind: 'served', version: observedVersion ?? target.version, incomplete: status === 'incomplete' };
  }
  if (status === 'failed') {
    const reportedAt = typeof data.lastReconciledAt === 'string' ? Date.parse(data.lastReconciledAt) : NaN;
    // A failure is ours when it names our version, or was reported after this
    // publish began. An older failure is a previous build's and is not news.
    if (isOurs || (Number.isFinite(reportedAt) && reportedAt >= target.since)) {
      const reason = typeof data.reconcileError === 'string' && data.reconcileError.trim()
        ? data.reconcileError.trim()
        : 'the environment reported a failed build without a reason';
      return { kind: 'failed', reason };
    }
  }
  const observed = observedVersion
    ? `${status ?? 'status not reported'}, serving ${observedVersion}`
    : (status ?? 'nothing reported yet');
  return { kind: 'pending', observed };
}

/**
 * Poll until the environment serves `target.version`, reports its build
 * failed, or `timeoutMs` passes. The clock and the sleep are injectable so a
 * test drives the whole wait without real time.
 */
export async function waitUntilServed(
  target: ServedVersionTarget,
  options: {
    timeoutMs: number;
    intervalMs: number;
    fetchReport?: FetchInstallationReport;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    onPending?: (observed: string) => void;
  },
): Promise<ServedVersionVerdict> {
  const fetchReport = options.fetchReport ?? fetchInstallationReport;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = now();
  let lastObserved = 'nothing reported yet';

  for (;;) {
    const report = await fetchReport(target);
    if (!report.ok) {
      if (!report.retryable) return { kind: 'unreadable', status: report.status, error: report.error };
      lastObserved = `the read answered ${report.status || 'no response'}: ${report.error}`;
    } else {
      const reading = interpretInstallationReport(report.data, target);
      if (reading.kind !== 'pending') return reading;
      if (reading.observed !== lastObserved) options.onPending?.(reading.observed);
      lastObserved = reading.observed;
    }
    const waited = now() - started;
    if (waited >= options.timeoutMs) return { kind: 'timeout', waitedMs: waited, lastObserved };
    await sleep(Math.min(options.intervalMs, Math.max(0, options.timeoutMs - waited)));
  }
}
