// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The first sign-up's seed ownership claim dispatches no automation — and
// still writes its audit rows and runs the sharing projection.
//
// On a freshly seeded database the first human to sign up is promoted to
// platform admin, and `claimSeedOwnership` (plugin-security) re-owns every
// seeded row to them INSIDE that sign-up request. That re-own is attribution —
// the step that completes the seed — not a user event. It used to run under a
// bare `{ isSystem: true }`, so every claimed row went through the full write
// pipeline: app hooks bound from metadata fired, record-change flows ran,
// approvals opened on seeded records and notifications were sent to the new
// admin. Measured on hotcrm `56d98f7e` (17.7.0, a 354-row seed): a ~45 s first
// sign-up, 1 254 app hooks, 8 flow runs, 2 approvals opened, 8 emails.
//
// The claim's write now carries `skipAutomations` beside `isSystem` — the
// seed's own principle (seed loads end-state data, not user events) carried to
// the write that completes it. This pins, on a booted app with the real
// automation + record-change trigger + approvals + messaging + audit + sharing
// chain, and over the real REST sign-up door:
//
//   ⭐ the claim fires no metadata-bound hook, runs no record-change flow, opens
//      no approval and emits no notification, and every seeded row's
//      `owner_id` is the admin;
//   ⭐ the claim still writes one audit row per claimed record, and plugin-
//      sharing's rule projection still materialises the grants the owner
//      change earns — code-registered hooks always run, so the opt-out
//      bypasses neither audit nor sharing (#2922).
//
// Every negative is armed by the fixture itself rather than assumed: the
// flow carries no start condition, so ANY update of a deal runs it; the hook
// has no condition either. The positive control at the end is an ordinary
// update by the admin over the same door, which fires both — so "zero during
// the claim" cannot be a hook or a flow that was never bound.
//
// The real-engine half (the flag reaching the hook filter, the per-row path
// and the trigger's reading point; the per-row hook ceiling and the paged
// fallback) is `plugin-security/src/claim-seed-ownership-dispatch.pin.test.ts`.

import { describe, it, expect } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field, defineSeed } from '@objectstack/spec/data';
import { defineSharingRule } from '@objectstack/spec/security';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { MessagingServicePlugin, NOTIFICATION_EVENT_OBJECT } from '@objectstack/service-messaging';

const OBJECT = 'scd_deal';
const FLOW = 'scd_deal_updated';
const ADMIN_EMAIL = 'scd-first-admin@example.com';
const ADMIN_PASSWORD = 'First-Admin-Pass-123';
const SYS = { isSystem: true } as const;

/** Every dispatch the metadata-bound hook received, by event. */
const appHookFires: string[] = [];

const ScdDeal = ObjectSchema.create({
  name: OBJECT,
  label: 'Seed Claim Deal',
  pluralLabel: 'Seed Claim Deals',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    stage: Field.text({ label: 'Stage' }),
  },
});

const SEEDED = ['Acme renewal', 'Globex rollout', 'Initech expansion', 'Umbrella pilot'];

const ScdSeed = defineSeed(ScdDeal, {
  mode: 'upsert',
  externalId: 'name',
  // No `owner_id`: an author leaves it unset, and the claim hands the rows to
  // the first admin.
  records: SEEDED.map((name) => ({ name, stage: 'open' })),
});

/**
 * An app hook bound FROM METADATA, with no condition — before and after every
 * update of a deal. It records each dispatch and changes nothing.
 */
const ScdAppHook = {
  name: 'scd_count_updates',
  label: 'Count deal updates',
  object: OBJECT,
  events: ['beforeUpdate', 'afterUpdate'] as ('beforeUpdate' | 'afterUpdate')[],
  handler: async (ctx: any) => {
    appHookFires.push(String(ctx?.event));
  },
};

/**
 * A record-change flow with NO start condition — every update of a deal runs
 * it — that notifies the deal's owner and then opens an approval for the
 * admin: the hotcrm shape (a notification and an approval per claimed row).
 */
const ScdFlow = defineFlow({
  name: FLOW,
  label: 'Deal updated',
  description: 'Fires on every deal update: notifies the owner, then asks the admin to review.',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On Deal Update',
      config: { objectName: OBJECT, triggerType: 'record-after-update' },
    },
    {
      id: 'notify',
      type: 'notify',
      label: 'Notify the owner',
      config: {
        topic: 'scd.deal_updated',
        recipients: '{record.owner_id}',
        title: 'Deal updated: {record.name}',
        message: '{record.name} was updated.',
        channels: ['inbox'],
        sourceObject: OBJECT,
        sourceId: '{record.id}',
      },
    },
    {
      id: 'review',
      type: 'approval',
      label: 'Review',
      config: { approvers: [{ type: 'user', value: ADMIN_EMAIL }], behavior: 'first_response' },
    },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'notify' },
    { id: 'e2', source: 'notify', target: 'review' },
    { id: 'e3', source: 'review', target: 'approved', label: 'approve' },
    { id: 'e4', source: 'review', target: 'rejected', label: 'reject' },
  ],
});

/**
 * A sharing rule whose grants exist only once a deal HAS an owner: each owned
 * deal is shared with the user its `owner_id` names. Before the claim every
 * seeded deal is ownerless and the rule grants nothing; the claim's owner
 * change is what earns the grants, so they appear only if plugin-sharing's
 * code-registered projection ran on the claim's write.
 */
const ScdOwnedRule = defineSharingRule({
  type: 'criteria',
  name: 'scd_owned_deals',
  label: 'Owned deals → their owner',
  description: 'Share each owned deal with the user its owner_id names.',
  object: OBJECT,
  condition: 'record.owner_id != null',
  accessLevel: 'read',
  sharedWith: { type: 'field', value: 'owner_id' },
  active: true,
});

const scdStack = defineStack({
  manifest: {
    id: 'com.dogfood.seed-ownership-claim-dispatch',
    namespace: 'scd',
    version: '0.0.0',
    type: 'app',
    name: 'Seed Ownership Claim Dispatch Fixture',
    description: 'Seeded deals with an app hook, a record-change flow and an owner-keyed sharing rule.',
  },
  requires: ['automation', 'triggers'],
  objects: [ScdDeal],
  hooks: [ScdAppHook],
  flows: [ScdFlow],
  sharingRules: [ScdOwnedRule],
  data: [ScdSeed],
});

interface Window {
  appHooks: number;
  flowRuns: number;
  approvals: number;
  notifications: number;
  auditUpdates: number;
  ruleGrants: number;
}

async function readWindow(stack: VerifyStack, ql: any): Promise<Window> {
  const automation = await stack.kernel.getServiceAsync<any>('automation');
  const runs = await automation.listRuns(FLOW, { limit: 1000 });
  const rows = async (object: string, where: Record<string, unknown> = {}) =>
    ((await ql.find(object, { where, limit: 5000 }, { context: SYS })) ?? []) as any[];
  return {
    appHooks: appHookFires.length,
    flowRuns: runs.length,
    approvals: (await rows('sys_approval_request')).length,
    notifications: (await rows(NOTIFICATION_EVENT_OBJECT)).length,
    auditUpdates: (await rows('sys_audit_log', { object_name: OBJECT, action: 'update' })).length,
    ruleGrants: (await rows('sys_record_share', { object_name: OBJECT, source: 'rule' })).length,
  };
}

const minus = (a: Window, b: Window): Window => ({
  appHooks: a.appHooks - b.appHooks,
  flowRuns: a.flowRuns - b.flowRuns,
  approvals: a.approvals - b.approvals,
  notifications: a.notifications - b.notifications,
  auditUpdates: a.auditUpdates - b.auditUpdates,
  ruleGrants: a.ruleGrants - b.ruleGrants,
});

describe('the first sign-up claims the seed without dispatching automation', () => {
  it(
    'no app hook, flow, approval or notification during the claim — audit rows and sharing grants still land',
    async () => {
      // The first human must arrive through the REST sign-up door, not the
      // harness's in-process dev-admin seed, so the claim runs inside the
      // request it slows down in production.
      const prevSeedAdmin = process.env.OS_SEED_ADMIN;
      process.env.OS_SEED_ADMIN = '0';
      let stack: VerifyStack | undefined;
      try {
        stack = await bootStack(scdStack as unknown as Parameters<typeof bootStack>[0], {
          automation: true,
          extraPlugins: [
            new AuditPlugin(),
            new MessagingServicePlugin({ reliableDelivery: false }),
            new RecordChangeTriggerPlugin(),
            new ApprovalsServicePlugin(),
          ],
        });
        const ql = await stack.kernel.getServiceAsync<any>('objectql');

        // The seed is in, and nobody owns it yet.
        const seeded = (await ql.find(OBJECT, { where: {} }, { context: SYS })) as any[];
        expect(seeded.map((r) => r.name).sort()).toEqual([...SEEDED].sort());
        for (const row of seeded) expect(row.owner_id ?? null).toBeNull();

        const before = await readWindow(stack, ql);
        expect(before.ruleGrants, 'an ownerless deal earns no grant').toBe(0);

        const signUp = await stack.api('/auth/sign-up/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: 'First Admin' }),
        });
        expect(signUp.status, await signUp.clone().text()).toBe(200);
        const body = (await signUp.json()) as { token?: string; user?: { id?: string } };
        const adminId = String(body.user?.id ?? '');
        expect(adminId).not.toBe('');
        expect(body.token).toBeTruthy();

        const claim = minus(await readWindow(stack, ql), before);

        // Every seeded row now belongs to the admin.
        const owned = (await ql.find(OBJECT, { where: {} }, { context: SYS })) as any[];
        expect(owned).toHaveLength(SEEDED.length);
        for (const row of owned) expect(row.owner_id, `${row.name} owner`).toBe(adminId);

        // ⭐ The claim dispatched no automation. One assertion over all four,
        // so a failure reports every count at once rather than the first.
        expect(
          {
            appHooks: claim.appHooks,
            flowRuns: claim.flowRuns,
            approvals: claim.approvals,
            notifications: claim.notifications,
          },
          'automation the claim dispatched (metadata hooks, flow runs, approvals opened, notifications emitted)',
        ).toEqual({ appHooks: 0, flowRuns: 0, approvals: 0, notifications: 0 });

        // ⭐ …and still ran the code-registered hooks: one audit row per
        // claimed record, and the grants the owner change earns.
        expect(claim.auditUpdates, 'audit rows written for the claim').toBe(SEEDED.length);
        const auditRows = (await ql.find(
          'sys_audit_log',
          { where: { object_name: OBJECT, action: 'update' } },
          { context: SYS },
        )) as any[];
        expect(new Set(auditRows.map((r) => r.record_id))).toEqual(new Set(owned.map((r) => r.id)));
        for (const row of auditRows) {
          expect(row.created_at, 'an audit row carries its timestamp').toBeTruthy();
          expect(String(row.new_value), 'the audit row records the new owner').toContain(adminId);
        }
        expect(claim.ruleGrants, 'sharing grants materialised by the claim').toBe(SEEDED.length);
        const grants = (await ql.find(
          'sys_record_share',
          { where: { object_name: OBJECT, source: 'rule' } },
          { context: SYS },
        )) as any[];
        expect(new Set(grants.map((g) => g.record_id))).toEqual(new Set(owned.map((r) => r.id)));

        // Positive control: an ordinary update of one deal by the admin, over
        // the same REST door, fires the hook (before + after) and runs the
        // flow — notification and approval included.
        const target = owned[0];
        const edited = await stack.apiAs(body.token!, 'PATCH', `/data/${OBJECT}/${target.id}`, { stage: 'won' });
        expect(edited.status, await edited.clone().text()).toBe(200);
        const control = minus(await readWindow(stack, ql), before);
        expect(control.appHooks - claim.appHooks, 'the hook is bound and fires on a user update').toBe(2);
        expect(control.flowRuns - claim.flowRuns, 'the flow is bound and runs on a user update').toBe(1);
        expect(control.approvals - claim.approvals, 'the flow opens its approval').toBe(1);
        expect(control.notifications - claim.notifications, 'the flow emits notifications').toBeGreaterThan(0);
      } finally {
        await stack?.stop();
        if (prevSeedAdmin === undefined) delete process.env.OS_SEED_ADMIN;
        else process.env.OS_SEED_ADMIN = prevSeedAdmin;
      }
    },
    180_000,
  );
});
