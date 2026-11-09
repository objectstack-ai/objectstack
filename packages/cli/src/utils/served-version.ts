// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Is the environment serving the version I just installed?" — the one client
 * function `os deploy` waits on.
 *
 * ## Why a wait at all
 *
 * The control plane answers the install as soon as it has written the desired
 * state; the environment rebuilds afterwards, keeps serving the OLD build while
 * it does (stale-while-rebuild), and keeps serving it if the build fails. So
 * "installed" in the publish answer means "asked for", and a developer who
 * opens the app right away may see the old version with no word that the new
 * one failed to build.
 *
 * ## The read: `data.served` (objectstack-ai/cloud#3651, PR objectstack-ai/cloud#3662)
 *
 * `GET /api/v1/cloud/environments/{environmentId}/packages/{manifestId}`, with
 * the credential the publish used, answers `data.served`:
 *
 *     state             'live' | 'pending' | 'failed'
 *     desiredVersionId  the installed version — equals the publish answer's `id`
 *     versionId         the version the environment last reported serving
 *     version           its version string
 *     observedStatus    installed | incomplete | failed | pending | null
 *     observedAt        when that was reported
 *     error             the build's failure reason (redacted), when state is 'failed'
 *
 * `live` ends the wait; `failed` prints `error` and exits non-zero; `pending`
 * keeps polling. ⛔ Not the installed-state probe
 * (`GET …/installations/:packageId`): it keeps its old shape and carries no
 * `served`.
 *
 * Two facts about the server shape the loop:
 *
 * 1. **Builds are request-driven.** Nothing rebuilds until the environment
 *    gets traffic, so every poll also sends one request to the environment's
 *    own URL ({@link wakeEnvironment}) — that starts the rebuild, or retries a
 *    failed one.
 * 2. **Failures surface late.** A failure is reported only once the runtime's
 *    failure streak trips (three failed rounds in a row) or a build outruns its
 *    timeout; one failed round still reads `pending`. The default wait is sized
 *    for that, and a timeout says so.
 *
 * Everything that knows this shape lives in this file — {@link fetchServedReport}
 * (the request) and {@link interpretServedReport} (the reading) — so a change
 * to the contract edits this file only. An answer with no `served` at all is a
 * control plane from before that contract: said plainly, never spun to the
 * timeout, never called live.
 */

import { readErrorMessage } from './response-envelope.js';

/** What the wait is for: one version of one package in one environment. */
export interface ServedVersionTarget {
  baseUrl: string;
  token: string;
  environmentId: string;
  /** The read is keyed by manifest id. */
  manifestId: string;
  version: string;
  /** The publish answer's `id` — what `served.desiredVersionId` must equal. */
  versionId: string | undefined;
}

/** One reading of `data.served`, reduced to what the wait decides on. */
export type ServedReading =
  | { kind: 'served'; version: string; incomplete: boolean }
  | { kind: 'failed'; reason: string }
  | { kind: 'superseded'; desiredVersionId: string }
  | { kind: 'pending'; observed: string }
  | { kind: 'unsupported' };

/** One poll's outcome, before interpretation. */
export type ServedReport =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; error: string; retryable: boolean };

export type FetchServedReport = (target: ServedVersionTarget) => Promise<ServedReport>;

/** The wait's verdict — the caller prints it and picks the exit code. */
export type ServedVersionVerdict =
  | { kind: 'served'; version: string; incomplete: boolean }
  | { kind: 'failed'; reason: string }
  | { kind: 'superseded'; desiredVersionId: string }
  | { kind: 'timeout'; waitedMs: number; lastObserved: string }
  | { kind: 'unsupported' }
  | { kind: 'unreadable'; status: number; error: string };

/** The request half of the contract. Never throws. */
export const fetchServedReport: FetchServedReport = async (target) => {
  const url =
    `${target.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(target.environmentId)}`
    + `/packages/${encodeURIComponent(target.manifestId)}`;
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

/** The reading half of the contract. Pure. */
export function interpretServedReport(
  data: Record<string, unknown>,
  target: Pick<ServedVersionTarget, 'version' | 'versionId'>,
): ServedReading {
  const served = data.served;
  if (!served || typeof served !== 'object') return { kind: 'unsupported' };
  const s = served as Record<string, unknown>;
  const str = (key: string) => (typeof s[key] === 'string' && (s[key] as string).trim() ? (s[key] as string).trim() : undefined);

  // The installation now points at a different version: someone installed over
  // this deploy, so neither `live` nor `failed` is about the version we published.
  const desired = str('desiredVersionId');
  if (desired && target.versionId && desired !== target.versionId) {
    return { kind: 'superseded', desiredVersionId: desired };
  }

  const state = str('state');
  const observedStatus = str('observedStatus');
  if (state === 'live') {
    return { kind: 'served', version: str('version') ?? target.version, incomplete: observedStatus === 'incomplete' };
  }
  if (state === 'failed') {
    return { kind: 'failed', reason: str('error') ?? 'the environment reported a failed build without a reason' };
  }
  const version = str('version');
  const observed = version
    ? `${observedStatus ?? 'status not reported'}, serving ${version}`
    : (observedStatus ?? 'nothing reported yet');
  return { kind: 'pending', observed };
}

/** One environment as its detail read answers it, reduced to what the CLI addresses it by. */
export interface CloudEnvironmentAddress {
  /** `https://` + `data.environment.hostname`; `undefined` when the row carries none. */
  origin: string | undefined;
  /** `data.environment.slug`, when the row carries one. */
  slug: string | undefined;
  /** `data.environment.display_name`, when the row carries one. */
  displayName: string | undefined;
}

/**
 * The control plane's environment read (`GET /api/v1/cloud/environments/{id}`),
 * reduced to {@link CloudEnvironmentAddress}. Never throws: a network failure
 * and a non-2xx are an `ok: false` naming the status, so a caller that cannot
 * go on without the answer (`os mcp connect`) says why, and one that can
 * ({@link fetchEnvironmentOrigin}) reads it as "no origin".
 */
export async function readCloudEnvironment(
  target: Pick<ServedVersionTarget, 'baseUrl' | 'token' | 'environmentId'>,
): Promise<({ ok: true } & CloudEnvironmentAddress) | { ok: false; status: number; error: string }> {
  try {
    const response = await fetch(
      `${target.baseUrl}/api/v1/cloud/environments/${encodeURIComponent(target.environmentId)}`,
      { headers: { Authorization: `Bearer ${target.token}` } },
    );
    const parsed: any = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, error: readErrorMessage(parsed, response) };
    const row = (parsed?.data ?? parsed)?.environment;
    const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
    const hostname = text(row?.hostname)?.replace(/\/+$/, '');
    return {
      ok: true,
      origin: hostname ? (/^https?:\/\//i.test(hostname) ? hostname : `https://${hostname}`) : undefined,
      slug: text(row?.slug),
      displayName: text(row?.display_name),
    };
  } catch (err: any) {
    return { ok: false, status: 0, error: err?.message ?? String(err) };
  }
}

/**
 * The environment's own origin, from the control plane's environment read
 * (`data.environment.hostname`). `undefined` when it has none or the read
 * fails — the wait then cannot wake the build, and the caller says so.
 */
export async function fetchEnvironmentOrigin(target: Pick<ServedVersionTarget, 'baseUrl' | 'token' | 'environmentId'>): Promise<string | undefined> {
  const read = await readCloudEnvironment(target);
  return read.ok ? read.origin : undefined;
}

/**
 * One request to the environment itself, so a request-driven rebuild starts
 * (or a failed one retries). Best-effort by design: the answer while it builds
 * is a retryable 503 (`SERVICE_UNAVAILABLE`), and nothing about it is read. `/api/v1/discovery`
 * is served by the environment's kernel — unlike `/api/v1/health`, the
 * container liveness probe, which answers without one.
 */
export async function wakeEnvironment(origin: string, timeoutMs = 10_000): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${origin}/api/v1/discovery`, { signal: controller.signal });
  } catch {
    // Unreachable or slow — the next poll asks again.
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Poll until the environment serves `target.version`, reports its build
 * failed, or `timeoutMs` passes. Each poll first wakes the environment (when
 * `wake` is given). The clock and the sleep are injectable so a test drives
 * the whole wait without real time.
 */
export async function waitUntilServed(
  target: ServedVersionTarget,
  options: {
    timeoutMs: number;
    intervalMs: number;
    fetchReport?: FetchServedReport;
    wake?: () => Promise<void>;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    onPending?: (observed: string) => void;
  },
): Promise<ServedVersionVerdict> {
  const fetchReport = options.fetchReport ?? fetchServedReport;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = now();
  let lastObserved = 'nothing reported yet';

  for (;;) {
    await options.wake?.();
    const report = await fetchReport(target);
    if (!report.ok) {
      if (!report.retryable) return { kind: 'unreadable', status: report.status, error: report.error };
      lastObserved = `the read answered ${report.status || 'no response'}: ${report.error}`;
    } else {
      const reading = interpretServedReport(report.data, target);
      if (reading.kind !== 'pending') return reading;
      if (reading.observed !== lastObserved) options.onPending?.(reading.observed);
      lastObserved = reading.observed;
    }
    const waited = now() - started;
    if (waited >= options.timeoutMs) return { kind: 'timeout', waitedMs: waited, lastObserved };
    await sleep(Math.min(options.intervalMs, Math.max(0, options.timeoutMs - waited)));
  }
}
