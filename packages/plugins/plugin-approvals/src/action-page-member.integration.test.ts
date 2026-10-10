// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22578] `ApprovalService.handleActionPage` — the ADR-0043 action page from
 * a web-standard `Request`, for a host with no raw app (segment 4 of ruling A
 * on #22438). The member's one caller is the runtime HTTP dispatcher's
 * `/approvals/act` domain; the plugin's self-hosted raw-app mount stays as it
 * is and is not a caller.
 *
 * Driven on a real `ObjectKernel` — `ObjectQLPlugin`, the real
 * `ApprovalsServicePlugin`, and `@objectstack/driver-sql` over in-memory
 * better-sqlite3 — so the member is read off the STARTED `approvals` slot and
 * the mount is the plugin's own `mountActionPages`, registered on a real Hono
 * app at `kernel:ready`. Both doors therefore sit on one token store.
 *
 * What this pins:
 *  1. the member renders (`GET`) and redeems (`POST`) from a `Request`: a live
 *     token's confirm page; a redemption that decides as the bound approver;
 *     a dead link told on the page with `200`; and `GET` never decides;
 *  2. parity: for the same token and method the member answers the mount's
 *     status, headers and body, byte for byte;
 *  3. one token store: a token one door consumed is dead at the other, and
 *     consumed is consumed through the member twice over;
 *  4. the token is the only credential: no cookie or `Authorization` read;
 *  5. the composition: the member is on the started service, the mount is
 *     registered once where a raw app exists, and its absence is logged.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { ObjectKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import type { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import type { ApprovalService } from './approval-service.js';
import { renderResultPage } from './action-link-pages.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const SUBMITTER = { userId: 'u_submitter', positions: [], permissions: [] } as any;
const APPROVER = 'u_approver';
const ACT_PATH = '/api/v1/approvals/act';
const ORIGIN = 'http://approvals.test';

const leaveRequest = {
  name: 'crm_leave_request',
  label: 'Leave Request',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
  },
};

/**
 * The host half a self-hosted stack gets from `plugin-hono-server`: an
 * `http.server` whose `getRawApp()` is a real Hono app (omitted for a hosted
 * tenant kernel), plus the automation surface a decision resumes through.
 */
class TestHostPlugin implements Plugin {
  name = 'test.approvals-host';
  version = '1.0.0';
  type = 'standard' as const;
  readonly resumed: Array<{ runId: string; branchLabel?: string }> = [];

  constructor(private readonly rawApp: Hono | null) {}

  async init(ctx: PluginContext): Promise<void> {
    const app = this.rawApp;
    if (app) ctx.registerService('http.server', { getRawApp: () => app });
    const resumed = this.resumed;
    ctx.registerService('automation', {
      registerNodeExecutor: () => {},
      resume: async (runId: string, signal?: { branchLabel?: string }) => {
        resumed.push({ runId, branchLabel: signal?.branchLabel });
        return { status: 'completed' };
      },
    });
  }
}

/** The real plugin, with its boot-time `info` lines observed. */
class ObservedApprovalsPlugin extends ApprovalsServicePlugin {
  infos: string[] = [];

  override async start(ctx: PluginContext): Promise<void> {
    const infos = this.infos;
    vi.spyOn(ctx.logger, 'info').mockImplementation((message: string) => {
      infos.push(String(message));
    });
    await super.start(ctx);
  }
}

const openKernels: ObjectKernel[] = [];
const openDrivers: SqlDriver[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (openKernels.length) {
    try { await openKernels.pop()?.shutdown(); } catch { /* already stopped */ }
  }
  while (openDrivers.length) {
    try { await openDrivers.pop()?.disconnect(); } catch { /* noop */ }
  }
});

async function bootStack(options: { rawApp: boolean }) {
  const app = options.rawApp ? new Hono() : null;
  const host = new TestHostPlugin(app);
  const plugin = new ObservedApprovalsPlugin();
  const kernel = new ObjectKernel({ logger: { level: 'silent' } });
  openKernels.push(kernel);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(host);
  await kernel.use(plugin);
  await kernel.bootstrap();

  // The engine's own init ran during bootstrap, before this driver existed.
  const objectql = kernel.getService<ObjectQL>('objectql');
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await driver.connect();
  openDrivers.push(driver);
  (objectql as any).registerDriver(driver, true);
  objectql.registry.registerObject(leaveRequest as any, 'approvals-test', 'approvals-test');
  await (objectql as any).syncSchemas();

  const svc = kernel.getService<ApprovalService>('approvals');
  let n = 0;
  /** A pending request on its own record; twins share a title, so their pages match. */
  const openRequest = async (title = 'Annual leave') => {
    n += 1;
    const recordId = `LR${n}`;
    await objectql.insert('crm_leave_request', { id: recordId, title }, { context: SYSTEM } as any);
    const opened: any = await svc.openNodeRequest({
      object: 'crm_leave_request', recordId, runId: `run_${n}`, nodeId: 'manager_review',
      flowName: 'leave_approval',
      config: { approvers: [{ type: 'user', value: APPROVER }], behavior: 'first_response' },
      submitterId: 'u_submitter', record: { id: recordId, title },
    } as any, SUBMITTER);
    return String(opened.id);
  };
  const statusOf = async (requestId: string) => (await svc.getRequest(requestId, SYSTEM))?.status;
  const decisionsOf = async (requestId: string) =>
    (await svc.listActions(requestId, SYSTEM)).filter((a) => a.action === 'approve' || a.action === 'reject');

  return { app, svc, plugin, host, objectql, openRequest, statusOf, decisionsOf };
}

const getRequest = (token: string) =>
  new Request(`${ORIGIN}${ACT_PATH}?token=${encodeURIComponent(token)}`, { method: 'GET' });
const postRequest = (body: string, contentType = 'application/x-www-form-urlencoded', headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${ACT_PATH}`, { method: 'POST', headers: { 'Content-Type': contentType, ...headers }, body });
const tokenForm = (token: string) => new URLSearchParams({ token }).toString();

/** Everything a response says, the body as bytes. */
async function snapshot(res: Response) {
  return {
    status: res.status,
    headers: [...res.headers.entries()],
    body: new Uint8Array(await res.arrayBuffer()),
  };
}
const text = (s: { body: Uint8Array }) => new TextDecoder().decode(s.body);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('[#22578] handleActionPage — the ADR-0043 action page from a Request', () => {
  it('GET renders the confirm page for a live token, and never decides however often it is fetched', async () => {
    const { svc, openRequest, statusOf, decisionsOf } = await bootStack({ rawApp: false });
    const requestId = await openRequest();
    const { approve } = await svc.issueActionTokens(requestId, APPROVER);

    const page = await snapshot(await svc.handleActionPage(getRequest(approve)));
    expect(page.status).toBe(200);
    expect(page.headers).toEqual([['content-type', 'text/html; charset=utf-8']]);
    // The confirm page posts the token back to the one action path.
    expect(text(page)).toContain(`action="${ACT_PATH}"`);
    expect(text(page)).toContain('name="token"');

    for (let i = 0; i < 5; i += 1) await svc.handleActionPage(getRequest(approve));
    expect(await statusOf(requestId)).toBe('pending');
    expect(await decisionsOf(requestId)).toEqual([]);

    // Control: the token was live all along — the first POST decides.
    const decided = await snapshot(await svc.handleActionPage(postRequest(tokenForm(approve))));
    expect(text(decided)).toBe(renderResultPage('approved', (await svc.getRequest(requestId, SYSTEM))!));
    expect(await statusOf(requestId)).toBe('approved');
  });

  it('POST redeems as the bound approver — the audit row names that approver, not a system actor', async () => {
    const { svc, host, openRequest, statusOf, decisionsOf } = await bootStack({ rawApp: false });
    const approved = await openRequest();
    const rejected = await openRequest();
    const approveTokens = await svc.issueActionTokens(approved, APPROVER);
    const rejectTokens = await svc.issueActionTokens(rejected, APPROVER);

    const a = await snapshot(await svc.handleActionPage(postRequest(tokenForm(approveTokens.approve))));
    const r = await snapshot(await svc.handleActionPage(postRequest(tokenForm(rejectTokens.reject))));
    expect([a.status, r.status]).toEqual([200, 200]);
    expect(text(a)).toBe(renderResultPage('approved', (await svc.getRequest(approved, SYSTEM))!));
    expect(text(r)).toBe(renderResultPage('rejected', (await svc.getRequest(rejected, SYSTEM))!));

    expect(await statusOf(approved)).toBe('approved');
    expect(await statusOf(rejected)).toBe('rejected');
    for (const [requestId, action] of [[approved, 'approve'], [rejected, 'reject']] as const) {
      const decisions = await decisionsOf(requestId);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({ action, actor_id: APPROVER, acted_as: APPROVER });
    }
    expect(host.resumed.map((x) => x.branchLabel)).toEqual(['approve', 'reject']);
  });

  it('a dead link — unknown, expired, consumed — is told on the page with 200, through GET and POST alike', async () => {
    const { svc, openRequest, statusOf } = await bootStack({ rawApp: false });
    const expiredOn = await openRequest();
    const expired = await svc.issueActionTokens(expiredOn, APPROVER, { ttlMs: 1 });
    await sleep(10);
    const consumedOn = await openRequest();
    const consumed = await svc.issueActionTokens(consumedOn, APPROVER);
    await svc.handleActionPage(postRequest(tokenForm(consumed.reject)));
    const consumedRow = (await svc.getRequest(consumedOn, SYSTEM))!;

    const cases: Array<[string, string, string]> = [
      ['unknown', 'not-a-token', renderResultPage('invalid')],
      ['expired', expired.approve, renderResultPage('expired')],
      ['consumed', consumed.reject, renderResultPage('consumed')],
    ];
    for (const [label, token, expected] of cases) {
      for (const request of [getRequest(token), postRequest(tokenForm(token))]) {
        const page = await snapshot(await svc.handleActionPage(request));
        expect(page.status, `${label} ${request.method}`).toBe(200);
        expect(page.headers).toEqual([['content-type', 'text/html; charset=utf-8']]);
        expect(text(page), `${label} ${request.method}`).toBe(expected);
      }
    }
    // The consumed token's request was decided once, and the expired one never.
    expect(consumedRow.status).toBe('rejected');
    expect(await statusOf(expiredOn)).toBe('pending');
  });

  it('a POST body that is not a form carries no token, and any other method is 405 with Allow', async () => {
    const { svc, openRequest, statusOf } = await bootStack({ rawApp: false });
    const requestId = await openRequest();
    const { approve } = await svc.issueActionTokens(requestId, APPROVER);

    const json = await snapshot(await svc.handleActionPage(postRequest(JSON.stringify({ token: approve }), 'application/json')));
    expect(json.status).toBe(200);
    expect(text(json)).toBe(renderResultPage('invalid'));

    for (const method of ['PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
      const res = await svc.handleActionPage(new Request(`${ORIGIN}${ACT_PATH}?token=${encodeURIComponent(approve)}`, { method }));
      expect(res.status, method).toBe(405);
      expect(res.headers.get('allow'), method).toBe('GET, POST');
    }
    expect(await statusOf(requestId)).toBe('pending');
  });

  it('the token is the only credential: a cookie or Authorization header is never read, and changes nothing', async () => {
    const { svc, openRequest, decisionsOf } = await bootStack({ rawApp: false });
    const requestId = await openRequest();
    const { approve } = await svc.issueActionTokens(requestId, APPROVER);

    const request = postRequest(tokenForm(approve), 'application/x-www-form-urlencoded', {
      Authorization: 'Bearer someone-else',
      Cookie: 'os_session=someone-else',
    });
    const read: string[] = [];
    const real = request.headers;
    const observed = new Proxy(real, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          if (typeof args[0] === 'string') read.push(args[0].toLowerCase());
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    Object.defineProperty(request, 'headers', { value: observed });

    const page = await snapshot(await svc.handleActionPage(request));
    expect(text(page)).toBe(renderResultPage('approved', (await svc.getRequest(requestId, SYSTEM))!));
    expect(read.filter((name) => name === 'authorization' || name === 'cookie')).toEqual([]);
    const [decision] = await decisionsOf(requestId);
    expect(decision).toMatchObject({ action: 'approve', actor_id: APPROVER });
  });
});

describe('[#22578] parity — the member answers what the self-hosted mount answers', () => {
  /** Ask both doors the same question; the member goes first, so it is never the one that sees a fresher store. */
  async function bothDoors(app: Hono, svc: ApprovalService, make: () => Request) {
    const member = await snapshot(await svc.handleActionPage(make()));
    const mount = await snapshot(await app.fetch(make()));
    return { member, mount };
  }

  it('GET: a live token, and an unknown, expired and consumed one — status, headers and bytes equal', async () => {
    const { app, svc, openRequest } = await bootStack({ rawApp: true });
    const live = await svc.issueActionTokens(await openRequest(), APPROVER);
    const expired = await svc.issueActionTokens(await openRequest(), APPROVER, { ttlMs: 1 });
    await sleep(10);
    const consumed = await svc.issueActionTokens(await openRequest(), APPROVER);
    await svc.redeemActionToken(consumed.approve);

    for (const token of [live.approve, live.reject, 'not-a-token', expired.approve, consumed.approve]) {
      const { member, mount } = await bothDoors(app!, svc, () => getRequest(token));
      expect(mount.status).toBe(200);
      expect(member).toEqual(mount);
    }
  });

  it('POST: dead links, a non-form body and a repeated token field — status, headers and bytes equal', async () => {
    const { app, svc, openRequest, statusOf } = await bootStack({ rawApp: true });
    const expired = await svc.issueActionTokens(await openRequest(), APPROVER, { ttlMs: 1 });
    await sleep(10);
    const consumed = await svc.issueActionTokens(await openRequest(), APPROVER);
    await svc.redeemActionToken(consumed.reject);
    const liveOn = await openRequest();
    const live = await svc.issueActionTokens(liveOn, APPROVER);

    const bodies: Array<[string, string]> = [
      [tokenForm('not-a-token'), 'application/x-www-form-urlencoded'],
      [tokenForm(expired.approve), 'application/x-www-form-urlencoded'],
      [tokenForm(consumed.reject), 'application/x-www-form-urlencoded'],
      [JSON.stringify({ token: live.approve }), 'application/json'],
      [`token=${encodeURIComponent(live.approve)}`, 'text/plain'],
      // A repeated field: the mount's parser keeps the LAST value, so a dead
      // last token leaves the live first one untouched at both doors.
      [`token=${encodeURIComponent(live.approve)}&token=not-a-token`, 'application/x-www-form-urlencoded'],
    ];
    for (const [body, contentType] of bodies) {
      const { member, mount } = await bothDoors(app!, svc, () => postRequest(body, contentType));
      expect(mount.status).toBe(200);
      expect(member, `${contentType} ${body.slice(0, 12)}`).toEqual(mount);
    }
    expect(await statusOf(liveOn)).toBe('pending');
  });

  it('POST: a live token decides, through either door, with the same page — twin requests, one token each', async () => {
    const { app, svc, openRequest, statusOf, decisionsOf } = await bootStack({ rawApp: true });
    const viaMember = await openRequest('Twin leave');
    const viaMount = await openRequest('Twin leave');
    const memberTokens = await svc.issueActionTokens(viaMember, APPROVER);
    const mountTokens = await svc.issueActionTokens(viaMount, APPROVER);

    const member = await snapshot(await svc.handleActionPage(postRequest(tokenForm(memberTokens.approve))));
    const mount = await snapshot(await app!.fetch(postRequest(tokenForm(mountTokens.approve))));
    expect(mount.status).toBe(200);
    expect(member).toEqual(mount);
    expect(text(member)).toBe(renderResultPage('approved', (await svc.getRequest(viaMember, SYSTEM))!));

    for (const requestId of [viaMember, viaMount]) {
      expect(await statusOf(requestId)).toBe('approved');
      expect(await decisionsOf(requestId)).toEqual([
        expect.objectContaining({ action: 'approve', actor_id: APPROVER, acted_as: APPROVER }),
      ]);
    }
  });
});

describe('[#22578] one token store — the two doors cannot both redeem a token', () => {
  it('a token consumed through the member cannot be redeemed through it again', async () => {
    const { svc, openRequest, decisionsOf } = await bootStack({ rawApp: false });
    const requestId = await openRequest();
    const { approve } = await svc.issueActionTokens(requestId, APPROVER);

    const first = await snapshot(await svc.handleActionPage(postRequest(tokenForm(approve))));
    const second = await snapshot(await svc.handleActionPage(postRequest(tokenForm(approve))));
    expect(text(first)).toBe(renderResultPage('approved', (await svc.getRequest(requestId, SYSTEM))!));
    expect(text(second)).toBe(renderResultPage('consumed'));
    expect(await decisionsOf(requestId)).toHaveLength(1);
  });

  it('redeemed through the mount ⇒ dead through the member, and the other way round', async () => {
    const { app, svc, openRequest, decisionsOf } = await bootStack({ rawApp: true });
    const mountFirst = await openRequest();
    const memberFirst = await openRequest();
    const mountTokens = await svc.issueActionTokens(mountFirst, APPROVER);
    const memberTokens = await svc.issueActionTokens(memberFirst, APPROVER);

    const viaMount = await snapshot(await app!.fetch(postRequest(tokenForm(mountTokens.approve))));
    expect(text(viaMount)).toBe(renderResultPage('approved', (await svc.getRequest(mountFirst, SYSTEM))!));
    for (const request of [getRequest(mountTokens.approve), postRequest(tokenForm(mountTokens.approve))]) {
      expect(text(await snapshot(await svc.handleActionPage(request))), request.method).toBe(renderResultPage('consumed'));
    }

    const viaMember = await snapshot(await svc.handleActionPage(postRequest(tokenForm(memberTokens.approve))));
    expect(text(viaMember)).toBe(renderResultPage('approved', (await svc.getRequest(memberFirst, SYSTEM))!));
    for (const request of [getRequest(memberTokens.approve), postRequest(tokenForm(memberTokens.approve))]) {
      expect(text(await snapshot(await app!.fetch(request))), request.method).toBe(renderResultPage('consumed'));
    }

    expect(await decisionsOf(mountFirst)).toHaveLength(1);
    expect(await decisionsOf(memberFirst)).toHaveLength(1);
  });
});

describe('[#22578] the composition — one mount where a raw app exists, the member everywhere', () => {
  it('with a raw app: the pages are mounted once (GET + POST), and the member is on the started service', async () => {
    const { app, svc, plugin } = await bootStack({ rawApp: true });
    const routes = app!.routes.filter((r) => r.path === ACT_PATH).map((r) => r.method).sort();
    expect(routes).toEqual(['GET', 'POST']);
    expect(typeof svc.handleActionPage).toBe('function');
    expect(plugin.infos.filter((line) => line.includes(ACT_PATH))).toHaveLength(1);
    expect(plugin.infos.filter((line) => line.includes('/approvals/act domain'))).toEqual([]);
  });

  it('with no raw app: nothing is mounted, the absence is logged once, and the member is on the started service', async () => {
    const { svc, plugin } = await bootStack({ rawApp: false });
    expect(typeof svc.handleActionPage).toBe('function');
    expect(plugin.infos.filter((line) => line.includes(ACT_PATH))).toEqual([]);
    expect(plugin.infos.filter((line) => line.includes('/approvals/act domain'))).toHaveLength(1);
  });
});
