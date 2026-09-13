// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16545] The END-TO-END proof the card names: `GET /api/v1/datasources` with
 * a `tenancy` service registered through a THROWING factory answers `503
 * SERVICE_UNAVAILABLE` on the wire.
 *
 * ## What this file is, and what it is NOT
 *
 * It is the card's own probe, and it drives `admin-routes.ts` **read-only** —
 * `packages/services/**` is another lane's surface and nothing in it is
 * modified by this card. The repair lives one package over, in
 * `HonoHttpServer.wrap()` (`@objectstack/plugin-hono-server`), which is the
 * seam every direct-mount route passes; the wrapper-level pin for both
 * directions lives beside it in `handler-throw-declared-envelope.test.ts`.
 * This file exists because a seam repaired in isolation and a REQUEST that
 * actually reaches the caller are different facts.
 *
 * ## The measured chain, and the ruling behind each link
 *
 *  1. `resolveAdmissionTenancyPosture` asks the kernel for `tenancy`.
 *  2. The factory rejects with an UNBRANDED error — registered, and failed to
 *     construct. `classifyAdmissionTenancyPosture` (#13906 decision 1 option A)
 *     turns exactly that into `AuthzStoreUnavailableError`: declared `status:
 *     503`, declared `code: SERVICE_UNAVAILABLE`.
 *  3. `requireDatasourceAdmin`'s own `catch` re-raises it rather than
 *     laundering an outage into a denial — the #13279 ruling, which this card
 *     leaves completely untouched. Only the RENDERING moves.
 *  4. The throw escapes the handler. Before this card the adapter answered
 *     `500 { code: 'INTERNAL_ERROR', message: 'No response from handler' }` —
 *     the declared code never reached the caller and the message named the
 *     wrong component. It now answers the envelope the throw declared.
 *
 * ## Why there are three arms and not one
 *
 * `admin-routes.ts` has a SECOND 503 of its own: `resolve()` answers `503
 * SERVICE_UNAVAILABLE "The datasource-admin service is not available."` when
 * the service is missing. A suite that asserted only `status === 503` would
 * pass just as well against a fixture whose wiring was simply broken, and would
 * have measured nothing about this card. So the subject arm asserts the
 * OUTAGE's own message, and two controls stand beside it:
 *
 *  - a HEALTHY tenancy lets the request REACH A VERDICT — the anonymous-deny
 *    `401 UNAUTHENTICATED` these arms' unauthenticated caller has earned;
 *  - a tenancy service that was NEVER REGISTERED stays quiet and reaches the
 *    same verdict, because an embedding with no `plugin-auth` is a SUPPORTED
 *    composition (#13906 decision 1 option A) and this card must not make it
 *    an outage.
 *
 * ⭐ The controls answering `401` rather than `200` is the SHARPER reading, and
 * it is the discriminator this card is actually about: a 401 is a VERDICT the
 * door reached, while the outage arm reaches no verdict at all — which is
 * exactly why #13279 refuses to answer it as a denial. Two different 4xx/5xx
 * answers separated by whether a decision was ever taken.
 */

import { describe, it, expect, vi } from 'vitest';
import { ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_STATUS } from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';

/** The declared refusal `AuthzStoreUnavailableError` carries (ADR-0112). */
const OUTAGE_STATUS = 503;
const OUTAGE_CODE = 'SERVICE_UNAVAILABLE';

/** How the `tenancy` slot behaves for a given arm. */
type Tenancy =
  | { kind: 'healthy' }
  | { kind: 'throws' }
  | { kind: 'never-registered' };

/**
 * The kernel's async accessor, in the three shapes the classification
 * distinguishes. The brand is an own property, never `instanceof` — a monorepo
 * resolves the same module through more than one path and two copies of a class
 * make `instanceof` answer false for a genuine instance.
 */
function kernelFor(tenancy: Tenancy) {
  return {
    getServiceAsync: async (name: string) => {
      if (name !== 'tenancy') throw new Error(`unexpected service: ${name}`);
      if (tenancy.kind === 'healthy') return { getTenancyPosture: () => 'single' };
      if (tenancy.kind === 'never-registered') {
        // Branded "never registered" ⇒ the quiet `undefined` arm.
        throw Object.assign(new Error("Service 'tenancy' is not registered"), {
          __objectstackServiceNotRegistered: true,
          code: 'SERVICE_NOT_REGISTERED',
          serviceName: 'tenancy',
        });
      }
      // Registered and FAILED TO CONSTRUCT — unbranded, so the classification
      // raises the ADR-0112 outage. This is the card's scenario.
      throw new Error('tenancy factory exploded while constructing');
    },
  };
}

function mount(tenancy: Tenancy) {
  const listDatasources = vi.fn(async () => []);
  const ctx = {
    getService: vi.fn((name: string) => {
      // No session and no API key reaches these arms: the outage is raised
      // while the posture is being resolved, which happens BEFORE any identity
      // verdict — that ordering is the whole reason the throw escapes.
      if (name === 'auth') return { api: { getSession: async () => undefined } };
      if (name === 'objectql' || name === 'data') return { find: async () => [] };
      return { listDatasources };
    }),
    getKernel: () => kernelFor(tenancy),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as PluginContext;

  const server = new HonoHttpServer(0);
  // The adapter's own diagnostics are not this file's subject; keep them quiet
  // so a real escaped throw does not print a stack per arm.
  server.setLogger({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(),
  } as any);
  registerDatasourceAdminRoutes(server, ctx, '/api/v1');
  return { app: server.getRawApp(), listDatasources };
}

async function list(tenancy: Tenancy) {
  const { app, listDatasources } = mount(tenancy);
  const res = await app.fetch(new Request('http://local/api/v1/datasources'));
  const text = await res.text();
  let body: any;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = { raw: text }; }
  return { status: res.status, body, listDatasources };
}

describe('GET /api/v1/datasources — an authz-store outage reaches the caller as its declared envelope', () => {
  it('answers 503 SERVICE_UNAVAILABLE, not 500 INTERNAL_ERROR "No response from handler"', async () => {
    const { status, body } = await list({ kind: 'throws' });

    expect(status).toBe(OUTAGE_STATUS);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(OUTAGE_CODE);

    // The regression, spelled out: these are the exact bytes the caller used to
    // get, and they are what this card removes from this path.
    expect(body.error.message).not.toBe('No response from handler');
    expect(body.error.code).not.toBe('INTERNAL_ERROR');
  });

  it('carries the OUTAGE’s own message — not the missing-service 503 one door over', async () => {
    const { body } = await list({ kind: 'throws' });

    // `resolve()` in the same registrar answers `503 SERVICE_UNAVAILABLE "The
    // datasource-admin service is not available."`. Asserting only the status
    // would let a broken fixture pass for a repaired outage.
    expect(body.error.message).toContain('authorization store could not be read');
    expect(body.error.message).toContain('not a permission denial');
    expect(body.error.message).not.toContain('datasource-admin service is not available');
  });

  it('never reached the service — an unreadable store licenses no verdict (#13279 intact)', async () => {
    const { listDatasources } = await list({ kind: 'throws' });

    // The card moves the RENDERING only. If the outage started resolving to a
    // verdict, this would be non-zero and #13279 would have been reversed as a
    // rider.
    expect(listDatasources).not.toHaveBeenCalled();
  });
});

describe('the controls that make the arm above readable', () => {
  it('a HEALTHY tenancy lets the request reach a VERDICT', async () => {
    const { status, body } = await list({ kind: 'healthy' });

    // The caller in these arms carries no session and no API key, so the
    // verdict it has earned is the platform's anonymous deny. What matters is
    // that a verdict was REACHED: posture resolution completed and the door ran
    // on. Nothing here is 503, and nothing here is the adapter's bare 500.
    expect(status).toBe(ANONYMOUS_DENY_STATUS);
    expect(body.error.code).toBe(ANONYMOUS_DENY_CODE);
    expect(status).not.toBe(OUTAGE_STATUS);
  });

  it('a NEVER-REGISTERED tenancy stays quiet and reaches the same verdict', async () => {
    // An embedding with no `plugin-auth` is a SUPPORTED composition (#13906
    // decision 1 option A). This card must not turn it into an outage, and a
    // gate that rendered every escaped throw would not be able to tell.
    const { status, body } = await list({ kind: 'never-registered' });

    expect(status).toBe(ANONYMOUS_DENY_STATUS);
    expect(body.error.code).toBe(ANONYMOUS_DENY_CODE);
    expect(status).not.toBe(OUTAGE_STATUS);
  });
});
