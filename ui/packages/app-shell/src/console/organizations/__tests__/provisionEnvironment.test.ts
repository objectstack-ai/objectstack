// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * provisionProductionEnvironment — born-with-env contract.
 *
 *   - posts `Production` + the explicit org id to the cloud env endpoint;
 *   - resolves the created env on 2xx, reading it from the NESTED `environment`
 *     row the control plane wraps it in (objectui#6629), and REFUSES a 2xx
 *     whose `data` carries no such row (objectui#6707);
 *   - treats 403/409 ("org already has its production env" — e.g. the control
 *     plane's auto-default-environment plugin won the race) as SUCCESS
 *     (`alreadyProvisioned`), NOT a failure;
 *   - throws only on a genuine failure (5xx) so the caller can fall back to the
 *     lazy onboarding gate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const authFetch = vi.fn();
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => authFetch,
}));
vi.mock('../../../runtime-config', () => ({
  getCloudBase: () => '',
}));

import { provisionProductionEnvironment } from '../provisionEnvironment';

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('provisionProductionEnvironment', () => {
  it('posts Production + the org id to the cloud env endpoint and returns the env', async () => {
    authFetch.mockResolvedValue(
      res(200, { data: { environment: { id: 'env-1', hostname: 'os-abc.localhost' } } }),
    );

    const out = await provisionProductionEnvironment({ organizationId: 'org-123' });

    expect(authFetch).toHaveBeenCalledTimes(1);
    const [url, init] = authFetch.mock.calls[0];
    expect(String(url)).toContain('/api/v1/cloud/environments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ displayName: 'Production', organizationId: 'org-123' });
    expect(out).toMatchObject({ id: 'env-1', hostname: 'os-abc.localhost' });
  });

  // objectui#6629 — ANTI-VACUITY PIN. The control plane's success payload nests
  // the created row one level down — `{ environment, warnings, durationMs,
  // hostnameAssignment? }` — so reading `data` FLAT left `id` and `hostname`
  // permanently `undefined`. Nothing threw and nothing logged: both fields are
  // optional on the type, the whole call is best-effort by contract, and the
  // caller swallows failures — the only symptom was a "successful" provision
  // carrying no environment at all. A test that merely asserts the fixed path
  // is green would have been green BEFORE the fix too; this one is RED on the
  // pre-fix implementation (which returns the wrapper, whose `id` is
  // `undefined`), which is the whole reason it exists.
  it('reads the created env from the nested `environment` row, not from the wrapper', async () => {
    authFetch.mockResolvedValue(
      res(201, {
        success: true,
        data: {
          environment: { id: 'env-1', hostname: 'os-abc.localhost' },
          warnings: [],
          durationMs: 42,
          hostnameAssignment: { hostname: 'os-abc.localhost' },
        },
      }),
    );

    const out = await provisionProductionEnvironment({ organizationId: 'org-123' });

    // `toEqual`, not `toMatchObject`: the wrapper's siblings (`warnings`,
    // `durationMs`, `hostnameAssignment`) must not ride along into a value
    // typed `ProvisionedEnvironment`.
    expect(out).toEqual({ id: 'env-1', hostname: 'os-abc.localhost' });
  });

  // Contract-first (AGENTS.md #0.1): the fix reads exactly ONE dialect. A flat
  // `data` is not a second accepted spelling of the payload, so its keys must
  // not be picked up — no `data.environment ?? data` alias.
  //
  // objectui#6707 turned this pin from "resolves with nothing" into "REJECTS".
  // It used to assert the call still resolved, because refusing a wrong-shaped
  // `data` changes behaviour on a path the caller relies on swallowing, and
  // that was deliberately severed from #6629 as its own decision. It was ruled
  // (2026-08-29, option B): a flat payload is a producer violation, not a
  // second dialect, so it is refused. The assertion is also strictly STRONGER
  // than the one it replaces — a reintroduced `data.environment ?? data` alias
  // would resolve `{ id: 'flat-1' }` here and fail this test, exactly as it
  // failed the old one.
  it('rejects a flat `data` shape instead of falling back to it', async () => {
    authFetch.mockResolvedValue(
      res(200, { success: true, data: { id: 'flat-1', hostname: 'flat.localhost' } }),
    );

    await expect(provisionProductionEnvironment({ organizationId: 'org-123' })).rejects.toThrow(
      /`data\.environment` is missing/,
    );
  });

  // objectui#6707 — the producer-regression case the throw exists for, and it
  // is NOT the same failure as a missing envelope. A `data` that is present and
  // well-formed but carries no `environment` row (the other keys the handler
  // really sends are here; `hostnameAssignment` is conditional, and its absence
  // is the ordinary "no rename happened" case, never "unknown") must be refused
  // with its OWN diagnostic. The two conditions answer different questions —
  // "did the control plane wrap the payload?" vs "did it put the row where it
  // says it does?" — so collapsing them into one message would cost whoever
  // reads that logged warning the ability to tell a broken transport from a
  // regressed producer. Hence the negative assertion, not just the positive one.
  it('rejects an enveloped `data` whose `environment` row is absent, with its own diagnostic', async () => {
    authFetch.mockResolvedValue(res(201, { success: true, data: { warnings: [], durationMs: 42 } }));

    const err: unknown = await provisionProductionEnvironment({ organizationId: 'org-123' }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/`data\.environment` is missing/);
    expect((err as Error).message).not.toMatch(/envelope/i);
  });

  it('treats 403 (already has its production env) as success, not a failure', async () => {
    authFetch.mockResolvedValue(res(403, { success: false, error: 'PRODUCTION_ENV_LIMIT' }));

    const out = await provisionProductionEnvironment({ organizationId: 'org-123' });

    expect(out).toEqual({ alreadyProvisioned: true });
  });

  // Strict envelope pin (#3352): the control plane wraps success payloads as
  // `{ success, data }`, so a BARE body is a producer contract violation — it
  // must NOT be read as the provisioned environment. This used to fall through
  // to `return body`, reporting a successful provision from a shape that never
  // existed; now it throws into the caller's documented lazy-provision path.
  it('does NOT read a bare (un-enveloped) 2xx body as the provisioned env', async () => {
    authFetch.mockResolvedValue(res(200, { id: 'env-1', hostname: 'os-abc.localhost' }));

    await expect(provisionProductionEnvironment({ organizationId: 'org-123' })).rejects.toThrow(
      /envelope/i,
    );
  });

  it('throws when a 2xx body carries the envelope but no data payload', async () => {
    authFetch.mockResolvedValue(res(200, { success: true }));

    await expect(provisionProductionEnvironment({ organizationId: 'org-123' })).rejects.toThrow(
      /envelope/i,
    );
  });

  it('throws on a genuine failure so the caller can fall back to the lazy gate', async () => {
    authFetch.mockResolvedValue(res(500, { success: false }));

    await expect(provisionProductionEnvironment({ organizationId: 'org-123' })).rejects.toThrow(
      /status 500/,
    );
  });
});
