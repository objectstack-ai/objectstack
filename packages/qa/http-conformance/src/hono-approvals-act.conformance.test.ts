// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22576] The ADR-0043 action page through BOTH doors, on the REAL approvals
 * plugin — segment 2 of ruling A on #22438, with segment 4's member behind it.
 *
 *  - THE SELF-HOSTED DOOR: a kernel with a real `HonoServerPlugin` (port 0), on
 *    whose raw app `ApprovalsServicePlugin` mounts `GET` / `POST
 *    /api/v1/approvals/act` itself, driven over a real socket.
 *  - THE HOSTED DOOR: a kernel with NO `http.server` — a tenant kernel owns no
 *    socket — under the real `createHonoApp` (this checkout's source, via the
 *    package alias), whose `${prefix}/*` catch-all hands the request to the
 *    real `HttpDispatcher` and its `/approvals/act` domain, which forwards it to
 *    the real `ApprovalService.handleActionPage`.
 *
 * Both kernels run the real plugin over a real store (`ObjectQLPlugin` +
 * in-memory SQLite), so every page below is the member's or the mount's own.
 *
 * What this pins:
 *  1. the hosted door reaches the member: `GET` renders the confirm page for a
 *     live token, and a form `POST` REDEEMS it — the decision lands in the
 *     store. The form body therefore crossed the catch-all unread, or the member
 *     would have found no token and answered "invalid";
 *  2. `HEAD` — one pin holding both doors equal: the same status, the same
 *     headers and no body at either door, which is what the self-hosted mount
 *     answers (Hono runs its `GET` route and drops the body), measured first;
 *  3. absence across the segment boundary: with the member removed from the
 *     real service, or the `approvals` slot absent, the hosted door answers
 *     `501 NOT_IMPLEMENTED` — ⛔ never `ROUTE_NOT_FOUND`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import type { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import type { ApprovalService } from '@objectstack/plugin-approvals';
import { createHonoApp } from '@objectstack/hono';
import type { IHttpServer } from '@objectstack/spec/contracts';

const PREFIX = '/api/v1';
const ACT_PATH = `${PREFIX}/approvals/act`;
const APPROVER = 'u_approver';
const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const SUBMITTER = { userId: 'u_submitter', positions: [], permissions: [] } as any;

const leaveRequest = {
    name: 'crm_leave_request',
    label: 'Leave Request',
    fields: {
        id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
        title: { name: 'title', label: 'Title', type: 'text' as const },
    },
};

/** The automation surface a decision resumes through — all the plugin asks of it here. */
class AutomationStub implements Plugin {
    name = 'test.approvals-automation';
    version = '1.0.0';
    type = 'standard' as const;
    async init(ctx: PluginContext): Promise<void> {
        ctx.registerService('automation', {
            registerNodeExecutor: () => {},
            resume: async () => ({ status: 'completed' }),
        });
    }
}

const liveKernels: ObjectKernel[] = [];
const liveDrivers: SqliteWasmDriver[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    while (liveKernels.length) {
        const kernel = liveKernels.pop();
        await Promise.race([kernel?.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
    }
    while (liveDrivers.length) {
        try { await liveDrivers.pop()?.disconnect(); } catch { /* already closed */ }
    }
});

/**
 * One kernel. `selfHosted` gives it the real Hono server (and so a raw app the
 * plugin mounts its pages on); without it the kernel has no `http.server`, the
 * hosted shape. `approvals: false` leaves the slot empty.
 */
async function bootKernel(opts: { selfHosted: boolean; approvals?: boolean }) {
    const kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
    liveKernels.push(kernel);
    await kernel.use(new ObjectQLPlugin());
    if (opts.selfHosted) await kernel.use(new HonoServerPlugin({ port: 0 }));
    await kernel.use(new AutomationStub());
    if (opts.approvals !== false) await kernel.use(new ApprovalsServicePlugin());
    await kernel.bootstrap();

    const objectql = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    liveDrivers.push(driver);
    (objectql as any).registerDriver(driver, true);
    objectql.registry.registerObject(leaveRequest as any, 'approvals-act-test', 'approvals-act-test');
    await (objectql as any).syncSchemas();

    let n = 0;
    /** A pending request with live action tokens for {@link APPROVER}. */
    const openWithTokens = async () => {
        const svc = kernel.getService<ApprovalService>('approvals');
        n += 1;
        const recordId = `LR${n}`;
        await objectql.insert('crm_leave_request', { id: recordId, title: 'Annual leave' }, { context: SYSTEM } as any);
        const opened: any = await svc.openNodeRequest({
            object: 'crm_leave_request', recordId, runId: `run_${n}`, nodeId: 'manager_review',
            flowName: 'leave_approval',
            config: { approvers: [{ type: 'user', value: APPROVER }], behavior: 'first_response' },
            submitterId: 'u_submitter', record: { id: recordId, title: 'Annual leave' },
        } as any, SUBMITTER);
        const requestId = String(opened.id);
        const tokens = await svc.issueActionTokens(requestId, APPROVER);
        const status = async () => (await svc.getRequest(requestId, SYSTEM))?.status;
        return { requestId, tokens, status };
    };
    return { kernel, openWithTokens };
}

/** The self-hosted door: the plugin's own raw-app mount, over a real socket. */
async function selfHostedDoor() {
    const { kernel, openWithTokens } = await bootKernel({ selfHosted: true });
    const server = kernel.getService<IHttpServer>('http.server');
    const base = `http://127.0.0.1:${server.getPort!()}`;
    return { openWithTokens, send: (path: string, init?: RequestInit) => fetch(`${base}${path}`, init) };
}

/** The hosted door: `createHonoApp` over a kernel with no `http.server`. */
async function hostedDoor(opts: { approvals?: boolean } = {}) {
    const { kernel, openWithTokens } = await bootKernel({ selfHosted: false, approvals: opts.approvals });
    let server: unknown;
    try { server = kernel.getService<unknown>('http.server'); } catch { server = undefined; }
    expect(server, 'the hosted shape owns no socket').toBeUndefined();
    const app = createHonoApp({ kernel: kernel as any, prefix: PREFIX });
    return {
        kernel,
        openWithTokens,
        send: (path: string, init?: RequestInit) => app.request(`http://tenant.example${path}`, init),
    };
}

const formPost = (token: string): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
});

/** Headers a transport adds or drops on its own, independent of the route. */
const TRANSPORT_HEADERS = new Set(['date', 'connection', 'keep-alive', 'content-length', 'transfer-encoding']);
async function snapshot(res: Response) {
    return {
        status: res.status,
        headers: [...res.headers.entries()].filter(([k]) => !TRANSPORT_HEADERS.has(k)),
        body: await res.text(),
    };
}

describe('[#22576] the hosted door reaches the real approvals member through createHonoApp', () => {
    it('GET renders the confirm page for a live token; a form POST redeems it — the body crossed the catch-all unread', async () => {
        const door = await hostedDoor();
        const { tokens, status } = await door.openWithTokens();

        const page = await snapshot(await door.send(`${ACT_PATH}?token=${encodeURIComponent(tokens.approve)}`));
        expect(page.status).toBe(200);
        expect(page.headers).toContainEqual(['content-type', 'text/html; charset=utf-8']);
        expect(page.body).toContain(`action="${ACT_PATH}"`);
        expect(page.body).toContain('name="token"');
        expect(await status(), 'a GET never decides').toBe('pending');

        const redeemed = await snapshot(await door.send(ACT_PATH, formPost(tokens.approve)));
        expect(redeemed.status).toBe(200);
        expect(redeemed.headers).toContainEqual(['content-type', 'text/html; charset=utf-8']);
        expect(await status(), 'the form token reached the member: the decision is in the store').toBe('approved');

        // …and it was single-use, through the same door.
        const again = await snapshot(await door.send(ACT_PATH, formPost(tokens.approve)));
        expect(again.status).toBe(200);
        expect(again.body).not.toBe(redeemed.body);
    }, 60_000);
});

describe('[#22576] HEAD — one pin holding both doors equal', () => {
    it('both doors answer HEAD with the GET page\'s status and headers and no body, for a live and a dead link', async () => {
        const selfHosted = await selfHostedDoor();
        const hosted = await hostedDoor();
        const s = await selfHosted.openWithTokens();
        const h = await hosted.openWithTokens();

        for (const [label, sToken, hToken] of [['live', s.tokens.approve, h.tokens.approve], ['dead', 'not-a-token', 'not-a-token']] as const) {
            const sHead = await snapshot(await selfHosted.send(`${ACT_PATH}?token=${encodeURIComponent(sToken)}`, { method: 'HEAD' }));
            const hHead = await snapshot(await hosted.send(`${ACT_PATH}?token=${encodeURIComponent(hToken)}`, { method: 'HEAD' }));
            const sGet = await snapshot(await selfHosted.send(`${ACT_PATH}?token=${encodeURIComponent(sToken)}`));

            // The self-hosted answer, as measured: the GET's status and headers, no body.
            expect(sHead.status, label).toBe(200);
            expect(sHead.headers, label).toEqual(sGet.headers);
            expect(sHead.body, label).toBe('');
            // The hosted door answers exactly that.
            expect(hHead, label).toEqual(sHead);
        }
        // HEAD rendered and never decided, at either door.
        expect(await s.status()).toBe('pending');
        expect(await h.status()).toBe('pending');
    }, 60_000);
});

describe('[#22576] absence across the segment boundary is a typed 501, never ROUTE_NOT_FOUND', () => {
    it('the real service with its handleActionPage member removed: 501 NOT_IMPLEMENTED on GET, HEAD and POST', async () => {
        const door = await hostedDoor();
        const { tokens, status } = await door.openWithTokens();
        const svc = door.kernel.getService<ApprovalService>('approvals');
        (svc as any).handleActionPage = undefined;

        for (const [method, init] of [['GET', undefined], ['HEAD', { method: 'HEAD' }], ['POST', formPost(tokens.approve)]] as const) {
            const res = await door.send(method === 'POST' ? ACT_PATH : `${ACT_PATH}?token=${encodeURIComponent(tokens.approve)}`, init);
            expect(res.status, method).toBe(501);
            if (method !== 'HEAD') {
                const body = JSON.parse(await res.text()) as { error?: { code?: string } };
                expect(body.error?.code, method).toBe('NOT_IMPLEMENTED');
            }
        }
        expect(await status()).toBe('pending');
    }, 60_000);

    it('no approvals slot on the kernel: 501 NOT_IMPLEMENTED, and the miss is not a route miss', async () => {
        const door = await hostedDoor({ approvals: false });
        const res = await door.send(`${ACT_PATH}?token=anything`);
        expect(res.status).toBe(501);
        const body = JSON.parse(await res.text()) as { error?: { code?: string } };
        expect(body.error?.code).toBe('NOT_IMPLEMENTED');

        // Control, same door: a path no domain claims IS the route miss.
        const miss = await door.send(`${PREFIX}/approvals/actx`);
        expect(miss.status).toBe(404);
        expect((JSON.parse(await miss.text()) as { error?: { code?: string } }).error?.code).toBe('ROUTE_NOT_FOUND');
    }, 60_000);
});
