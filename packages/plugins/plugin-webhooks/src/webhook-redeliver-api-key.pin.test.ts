// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23287 — ruling C′ item 3] The webhook-redeliver door, measured for the
 * API-key arm of the ruling: it admits NO API key at all.
 *
 * The door (`WebhookOutboxPlugin.serveRedeliver`, both faces) authenticates by
 * the better-auth SESSION alone and never runs the key-admission seam, so a
 * key whose owner holds an `account`-scope posture cannot pass it: the key is
 * not a credential here, and the request is anonymous. That is the answer this
 * pin holds, on both faces, whatever the owner's standing — so the ruling's
 * "a held user's key is refused at every seam" is true at this door by
 * construction, with no posture to consult.
 *
 * ⚠️ For the same reason, removing the key-admission seam's judgment
 * (`resolveApiKeyAdmission`'s `held` arm) leaves this file GREEN: the door
 * never asks that seam. The pin that turns red under that removal lives on
 * every face that DOES admit keys.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { IWebhookService } from '@objectstack/spec/contracts';
import { MemoryHttpOutbox, MessagingService } from '@objectstack/service-messaging';
import { WebhookOutboxPlugin } from './webhook-outbox-plugin.js';

const PATH = '/api/v1/webhooks/redeliver';
const ORIGIN = 'http://webhooks.test';
const KEY = 'osk_webhook_redeliver_key_pin';
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as any;

const MFA_REQUIRED = {
    code: 'MFA_REQUIRED',
    message: 'Multi-factor authentication is required. Please set up an authenticator app to continue.',
};

class FixturePlugin implements Plugin {
    name = 'com.objectstack.service.messaging';
    type = 'standard' as const;
    version = '1.0.0';
    readonly outbox = new MemoryHttpOutbox();
    readonly messaging = new MessagingService({ logger: silentLogger });
    readonly app = new Hono();

    constructor() {
        this.messaging.setHttpOutbox(this.outbox);
    }

    init(ctx: PluginContext): void {
        ctx.registerService('manifest', { register: () => {}, list: () => [] });
        ctx.registerService('objectql', {
            registry: { listItems: () => [], getObject: () => undefined },
            async find() { return []; },
            registerHook() {},
            unregisterHooksByPackage() { return 0; },
            async resolveSecretField() { return null; },
        });
        ctx.registerService('messaging', this.messaging);
        // A session read that knows no session for a key-only request, and a
        // posture computation that WOULD hold the key's owner if anyone asked.
        ctx.registerService('auth', {
            isAuthGateActive: () => true,
            api: { async getSession() { return null; } },
            async resolveUserAuthGates() { return [MFA_REQUIRED]; },
        });
        const app = this.app;
        ctx.registerService('http.server', { getRawApp: () => app });
    }
}

const openKernels: LiteKernel[] = [];
afterEach(async () => {
    while (openKernels.length) {
        try { await openKernels.pop()?.shutdown(); } catch { /* already stopped */ }
    }
});

async function boot() {
    const fixture = new FixturePlugin();
    const kernel = new LiteKernel({ logger: { level: 'silent' } as any });
    openKernels.push(kernel);
    kernel.use(fixture);
    kernel.use(new WebhookOutboxPlugin());
    await kernel.bootstrap();
    return {
        mount: async (request: Request) => fixture.app.fetch(request),
        member: (request: Request) => kernel.getService<IWebhookService>('webhooks').handleRedeliver!(request),
    };
}

const keyRequest = () => new Request(`${ORIGIN}${PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify({ deliveryId: 'del_1' }),
});

describe('webhook redeliver — an API key is no credential at this door (#23287, ruling C′)', () => {
    for (const face of ['mount', 'member'] as const) {
        it(`${face} · a key alone, its owner held by MFA_REQUIRED → 401 UNAUTHENTICATED, never served`, async () => {
            const faces = await boot();
            const res = await faces[face](keyRequest());
            expect(res.status).toBe(401);
            const body = (await res.json()) as { error?: { code?: string } };
            expect(body?.error?.code).toBe('UNAUTHENTICATED');
        });
    }
});
