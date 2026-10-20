// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D2/D6, ruling A on the walled shape of a declared webhook] Under
// `group` and `isolated` a declared webhook is the DEPLOYMENT's, as it is under
// `single`: switched on, it receives every organization's events, and each
// `sys_http_delivery` row is stamped with its event's organization, so delivery
// history is walled like any other organization-stamped row. The switch is the
// deployment-level activation-ledger row, and it is the platform operator's
// under a wall.
//
// Before the ruling a declared webhook under a wall was organization-less, and
// the dispatcher refused every organization-walled event it matched (one
// warning, nothing delivered). This boots a real walled posture with two
// organizations and pins the three halves of the ruling:
//
//  1. one delivery per event, stamped with that event's organization;
//  2. each organization reads only its own deliveries;
//  3. an organization administrator is refused at the activation door, and
//     the platform operator is not.
//
// The realtime service is an in-test hand bus registered as `realtime`, so the
// engine's own record events reach the plugin's real dispatcher.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MessagingServicePlugin } from '@objectstack/service-messaging';
import { WebhookOutboxPlugin } from '@objectstack/plugin-webhooks';
import { webhookFixtureStack } from './fixtures/webhook-materialization-fixture.js';

const SYS = { isSystem: true, positions: [], permissions: [] };
const DECLARED_REF = 'declared:wm_task_changed';
const DELIVERY_READER = 'dw_delivery_reader';

/** The realtime surface the engine publishes to and the dispatcher subscribes through. */
function handRealtime() {
  const subs = new Map<string, { handler: (e: any) => unknown; opts?: { object?: string } }>();
  let n = 0;
  return {
    async publish(event: any) {
      for (const s of subs.values()) {
        if (s.opts?.object && s.opts.object !== event.object) continue;
        await s.handler(event);
      }
    },
    async subscribe(_channel: string, handler: (e: any) => unknown, opts?: { object?: string }) {
      const id = `s-${++n}`;
      subs.set(id, { handler, opts });
      return id;
    },
    async unsubscribe(id: string) {
      subs.delete(id);
    },
  };
}

function realtimePlugin() {
  const bus = handRealtime();
  return {
    name: 'dogfood.hand-realtime',
    version: '0.0.0',
    init: async (ctx: any) => {
      ctx.registerService('realtime', bus);
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10));
}

for (const posture of ['isolated', 'group'] as const) {
  describe(`[ruling A] ${posture}: a declared webhook is deployment-wide`, () => {
    let stack: VerifyStack;
    let ql: any;
    let operator: string;
    let tokA: string;
    let tokB: string;
    let orgA: string;
    let orgB: string;
    const previous = process.env.OS_TENANCY_POSTURE;

    const deliveries = async () =>
      ((await ql.find('sys_http_delivery', { where: { ref_id: DECLARED_REF }, limit: 100, context: SYS })) as any[]);

    beforeAll(async () => {
      process.env.OS_TENANCY_POSTURE = posture;
      stack = await bootStack(webhookFixtureStack as never, {
        multiTenant: 'posture-only',
        extraPlugins: [realtimePlugin(), new MessagingServicePlugin(), new WebhookOutboxPlugin()],
      });
      ql = await stack.kernel.getServiceAsync('objectql');
      operator = await stack.signIn();
      tokA = await stack.signUp(`dw-a-${posture}@wall.test`);
      tokB = await stack.signUp(`dw-b-${posture}@wall.test`);
      for (const [tok, slug] of [[tokA, `dw-a-${posture}`], [tokB, `dw-b-${posture}`]] as const) {
        const created = await stack.apiAs(tok, 'POST', '/auth/organization/create', { name: slug, slug });
        expect(created.status, await created.clone().text()).toBe(200);
        const id = ((await created.json()) as { id: string }).id;
        if (tok === tokA) orgA = id; else orgB = id;
        const active = await stack.apiAs(tok, 'POST', '/auth/organization/set-active', { organizationSlug: slug });
        expect(active.status, await active.clone().text()).toBe(200);
      }
      // Each organization's member holds, inside their own organization only
      // (an organization-scoped grant), read on the delivery table and
      // `manage_metadata`: the read below is judged by the wall, not refused by
      // object permission, and the activation door's `manage_metadata` gate
      // admits them, so only the walled posture rule can refuse them there.
      const saved = await stack.apiAs(operator, 'PUT', `/meta/permission/${DELIVERY_READER}`, {
        name: DELIVERY_READER, label: 'Delivery reader', systemPermissions: ['manage_metadata'],
        objects: { sys_http_delivery: { allowRead: true } },
      });
      expect(saved.status, await saved.clone().text()).toBe(200);
      for (const [email, organization] of [[`dw-a-${posture}@wall.test`, orgA], [`dw-b-${posture}@wall.test`, orgB]] as const) {
        const user = String((await ql.find('sys_user', { where: { email }, limit: 1, context: SYS }))[0]?.id);
        await ql.insert('sys_user_permission_set', { user_id: user, permission_set: DELIVERY_READER, organization_id: organization },
          { context: { ...SYS, tenantId: organization } });
      }
    }, 180_000);

    afterAll(async () => {
      await stack?.stop?.();
      if (previous === undefined) delete process.env.OS_TENANCY_POSTURE;
      else process.env.OS_TENANCY_POSTURE = previous;
    });

    it('guard the guard: a real walled posture with two organizations', async () => {
      const tenancy = await stack.kernel.getServiceAsync<{ posture: string; degraded: boolean }>('tenancy');
      expect(tenancy.posture).toBe(posture);
      expect(tenancy.degraded).toBe(false);
      expect(orgA).toBeTruthy();
      expect(orgB).toBeTruthy();
      expect(orgA).not.toBe(orgB);
    });

    it('an organization administrator is refused at the activation door; the platform operator switches it on', async () => {
      const refused = await stack.apiAs(tokA, 'POST', '/security/_activation/webhook/wm_task_changed', { enabled: false });
      expect(refused.status, await refused.clone().text()).toBe(403);
      expect(((await refused.json()) as any)?.error?.code).toBe('PERMISSION_DENIED');
      const ledger = await ql.find('sys_metadata_activation', { where: { metadata_type: 'webhook' }, context: SYS });
      expect(ledger).toEqual([]);

      const on = await stack.apiAs(operator, 'POST', '/security/_activation/webhook/wm_task_changed', { enabled: true });
      expect(on.status, await on.clone().text()).toBe(200);
    });

    it("one delivery per event, each stamped with that event's organization", async () => {
      expect(await deliveries()).toEqual([]);
      await ql.insert('wm_task', { name: 'task in A' }, { context: { ...SYS, tenantId: orgA } });
      await ql.insert('wm_task', { name: 'task in B' }, { context: { ...SYS, tenantId: orgB } });
      await settle();

      const rows = await deliveries();
      expect(rows.map((r) => r.organization_id).sort()).toEqual([orgA, orgB].sort());
    });

    it('each organization reads only its own deliveries', async () => {
      const read = async (token: string) => {
        const res = await stack.apiAs(token, 'GET', `/data/sys_http_delivery?filter=${encodeURIComponent(JSON.stringify({ ref_id: DECLARED_REF }))}`);
        expect(res.status, await res.clone().text()).toBe(200);
        const body = (await res.json()) as any;
        const rows = (body?.data?.records ?? body?.records ?? body?.data ?? []) as any[];
        return rows.map((r) => r.organization_id);
      };
      expect(await read(tokA)).toEqual([orgA]);
      expect(await read(tokB)).toEqual([orgB]);
    });
  });
}
