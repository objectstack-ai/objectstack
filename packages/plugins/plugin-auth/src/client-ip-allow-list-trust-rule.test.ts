// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0069 D5 / D7 — the IP allow-list judges, and the login audit records, the
// client address the SERVER established, by the platform's one client-address
// trust rule (`./client-address.ts`, shared with the runtime's inbound rate
// limiter):
//
//   - forwarded headers count only when the deployment declares
//     `server.trustProxy` (`AuthManagerOptions.trustProxy`);
//   - otherwise the address is the transport's peer (`IHttpRequest.remoteAddress`);
//   - an address that cannot be established is REFUSED while ranges are set;
//   - with no ranges configured nothing is judged.
//
// One pin per branch. The fixture mounts `AuthPlugin.registerAuthRoutes` on a
// real Hono app in front of a real `AuthManager` on the installed better-auth,
// and every verdict is read off a real `Response`: the gate and the route that
// feeds the audit are raw-app mounts, so a suite driving `AuthManager` alone
// would never run them. The transport peer is supplied the way
// `@hono/node-server` supplies it, as the Node request on `c.env.incoming`.
//
// ADR-0112 is `code` AND `status`; every refusal assertion carries both.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import type { PluginContext } from '@objectstack/core';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-24739';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const EMAIL = 'member.24739@example.com';

/** Documentation ranges (RFC 5737): one allowed, one not, one private proxy hop. */
const RANGE = '203.0.113.0/24';
const INSIDE = '203.0.113.7';
const OUTSIDE = '198.51.100.9';
const PROXY_HOP = '10.0.0.2';

const mockCtx = () =>
  ({
    registerService: vi.fn(),
    getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  }) as unknown as PluginContext & { logger: { warn: ReturnType<typeof vi.fn> } };

/**
 * ADMITTED: the request passed the gate and reached the auth service, whose
 * session read refuses a request carrying no credential with its own answer.
 * REFUSED: the D5 gate answered before the auth service ran.
 */
const ADMITTED = { status: 401, code: 'UNAUTHENTICATED' };
const REFUSED = { status: 403, code: 'IP_NOT_ALLOWED' };

/** Status + the error code the body carries (ADR-0112 nests it under `error`). */
async function verdict(res: Response): Promise<{ status: number; code?: string }> {
  const text = await res.text();
  let code: string | undefined;
  try {
    const parsed = JSON.parse(text);
    code = parsed?.error?.code ?? parsed?.code;
  } catch {
    /* non-JSON body → no code */
  }
  return { status: res.status, code };
}

interface Deployment {
  allowedIpRanges?: string[];
  trustProxy?: boolean;
}

/** One deployment, served through the REAL mount chain. */
async function serve(deployment: Deployment) {
  const engine = createMemoryEngine();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    ...deployment,
  } as any);

  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  const app = new Hono();
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);

  /** A request through the mounts. `peer` is the transport's own peer address, or none. */
  const send = (
    path: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
    peer?: string,
  ) =>
    app.request(
      `${ORIGIN}${BASE}${path}`,
      init,
      peer ? { incoming: { socket: { remoteAddress: peer } } } : {},
    );

  /** The cheapest auth request: a session read with no credential ({@link ADMITTED} when let through). */
  const probe = (peer: string | undefined, headers: Record<string, string> = {}) =>
    send('/get-session', { method: 'GET', headers }, peer);

  /** Create the fixture user directly (no mount), so only the sign-in crosses the gate. */
  const signUp = async () => {
    await inviteForAudienceGate(manager, EMAIL);
    const res = await manager.handleRequest(
      new Request(`${ORIGIN}${BASE}/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: 'Allow-list Member' }),
      }),
    );
    expect(res.status, `sign-up: ${await res.clone().text()}`).toBe(200);
  };

  /** Sign in THROUGH the mounts, as the transport delivers it. */
  const signIn = (peer: string | undefined, headers: Record<string, string> = {}) =>
    send(
      '/sign-in/email',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      },
      peer,
    );

  const userRow = () =>
    ((engine.tables.get('sys_user') ?? []) as any[]).find((r) => r.email === EMAIL);

  return { ctx, probe, signUp, signIn, userRow };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ADR-0069 D5 — the allow-list judges the client address the server established', () => {
  it('behind a declared trusted proxy, the allow-list judges the forwarded client address', async () => {
    const { probe } = await serve({ allowedIpRanges: [RANGE], trustProxy: true });

    // The proxy hop is outside the ranges; the forwarded client is inside.
    expect(await verdict(await probe(PROXY_HOP, { 'x-forwarded-for': `${INSIDE}, ${PROXY_HOP}` })))
      .toEqual(ADMITTED);
    // …and the converse: the forwarded client decides, not the hop.
    expect(await verdict(await probe(INSIDE, { 'x-forwarded-for': OUTSIDE })))
      .toEqual(REFUSED);
  });

  it('without a declared trusted proxy, the allow-list judges the connection peer and a forwarded header changes nothing', async () => {
    const { probe } = await serve({ allowedIpRanges: [RANGE] });

    expect(await verdict(await probe(OUTSIDE, { 'x-forwarded-for': INSIDE, 'x-real-ip': INSIDE })))
      .toEqual(REFUSED);
    expect(await verdict(await probe(INSIDE, { 'x-forwarded-for': OUTSIDE })))
      .toEqual(ADMITTED);
  });

  it('an address the server could not establish is refused while ranges are set, and the operator is told why once', async () => {
    const untrusted = await serve({ allowedIpRanges: [RANGE] });
    // No transport peer, and a forwarded header that is not believed.
    expect(await verdict(await untrusted.probe(undefined, { 'x-forwarded-for': INSIDE })))
      .toEqual(REFUSED);
    expect(await verdict(await untrusted.probe(undefined)))
      .toEqual(REFUSED);

    const undetermined = untrusted.ctx.logger.warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('allowed_ip_ranges') && line.includes('server.trustProxy'));
    expect(undetermined, 'one operator line, naming the setting and server.trustProxy').toHaveLength(1);

    // A trusted proxy that forwarded nothing, on a transport with no peer.
    const trusted = await serve({ allowedIpRanges: [RANGE], trustProxy: true });
    expect(await verdict(await trusted.probe(undefined)))
      .toEqual(REFUSED);
  });

  it('with no ranges configured nothing is judged, whatever the address', async () => {
    const { probe } = await serve({});

    expect(await verdict(await probe(undefined))).toEqual(ADMITTED);
    expect(await verdict(await probe(OUTSIDE, { 'x-forwarded-for': OUTSIDE })))
      .toEqual(ADMITTED);

    const empty = await serve({ allowedIpRanges: [] });
    expect(await verdict(await empty.probe(undefined))).toEqual(ADMITTED);
  });

  it('an IPv4 peer reported in IPv4-mapped form is judged as its IPv4 address', async () => {
    const { probe } = await serve({ allowedIpRanges: [RANGE] });

    expect(await verdict(await probe(`::ffff:${INSIDE}`))).toEqual(ADMITTED);
    expect(await verdict(await probe(`::ffff:${OUTSIDE}`)))
      .toEqual(REFUSED);
  });
});

describe('ADR-0069 D7 — the login audit records the address the allow-list judged', () => {
  it('records the connection peer, not a forwarded header, when no proxy is trusted', async () => {
    const d = await serve({});
    await d.signUp();

    const res = await d.signIn(INSIDE, { 'x-forwarded-for': OUTSIDE });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(d.userRow()?.last_login_at instanceof Date).toBe(true);
    expect(d.userRow()?.last_login_ip).toBe(INSIDE);
  });

  it('records the forwarded client address the gate admitted when the proxy is declared trusted', async () => {
    const d = await serve({ allowedIpRanges: [RANGE], trustProxy: true });
    await d.signUp();

    const res = await d.signIn(PROXY_HOP, { 'x-forwarded-for': `${INSIDE}, ${PROXY_HOP}` });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(d.userRow()?.last_login_ip).toBe(INSIDE);
  });

  it('records no address when none could be established', async () => {
    const d = await serve({});
    await d.signUp();

    const res = await d.signIn(undefined, { 'x-forwarded-for': OUTSIDE });
    expect(res.status, await res.clone().text()).toBe(200);
    // The stamp ran (last_login_at), and it carried no address.
    expect(d.userRow()?.last_login_at instanceof Date).toBe(true);
    expect(d.userRow()?.last_login_ip).toBeUndefined();
  });
});
