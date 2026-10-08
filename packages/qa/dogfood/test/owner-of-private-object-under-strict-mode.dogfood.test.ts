// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// An `owner_of:` audience on a PRIVATE object reaches the record's owner, end
// to end, with ADR-0096 D5 strict mode in force (#21908, maintainer ruling Q2).
//
// The recipient resolver reads the referenced record for its owner fields and
// nothing else. That read used to reach the engine with no principal: the
// security middleware handed it through, and the sharing middleware answered
// a principal-less read of a `private` object with deny-all, so an `owner_of:`
// audience on one silently resolved to nobody. The ruling gave the read the
// explicit system opt-in its sibling `resolveEmail` carries, and strict mode
// now refuses the principal-less spelling outright — so this pin is the proof
// that the owner is found by the declared route and not by a hand-off:
//
//   ⭐ the composition refuses a principal-less read of the object (strict
//      mode is in force here, not merely compiled in);
//   ⭐ an `owner_of:` notification on a record of that private object lands
//      in its owner's inbox, read back over `GET /api/v1/notifications`;
//   ⭐ it lands in nobody else's: another member, who cannot read the record,
//      is not a recipient.
//
// The fixture is owned by this pin and kept inline. Messaging runs its inline
// fan-out (`reliableDelivery: false`) so the inbox row exists when `emit`
// returns, the shape `approval-notification-body.dogfood.test.ts` uses.

import { describe, it, expect } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { MessagingServicePlugin } from '@objectstack/service-messaging';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';

const OBJECT = 'plq2_case';
const OWNER = 'plq2-owner@example.com';
const OTHER = 'plq2-other@example.com';
const TOPIC = 'plq2.owner_ping';

const Plq2Case = ObjectSchema.create({
  name: OBJECT,
  label: 'Owner Resolution Case',
  pluralLabel: 'Owner Resolution Cases',
  // The point of the pin: a record only its owner may read.
  sharingModel: 'private',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

const plq2Stack = defineStack({
  manifest: {
    id: 'com.dogfood.owner-of-private-strict-mode',
    namespace: 'plq2',
    version: '0.0.0',
    type: 'app',
    name: 'Owner Resolution Under Strict Mode Fixture',
    description: 'One private object whose record owner an owner_of audience must reach.',
  },
  objects: [Plq2Case],
});

/** Every fresh member may create and read the object; the private model keeps each to their own rows. */
const plq2MemberSet = PermissionSetSchema.parse({
  name: 'plq2_member',
  label: 'Owner Resolution Member — create + read on plq2_case',
  objects: {
    [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
  },
});

interface InboxRow {
  id: string;
  type: string;
  title: string;
}

describe('[#21908] an owner_of audience on a private object reaches the owner under ADR-0096 D5 strict mode', () => {
  it(
    'the owner receives the notification and nobody else does; a principal-less read of the object is refused',
    async () => {
      const stack = await bootStack(plq2Stack as unknown as Parameters<typeof bootStack>[0], {
        security: new SecurityPlugin({
          defaultPermissionSets: [...securityDefaultPermissionSets, plq2MemberSet],
          fallbackPermissionSet: plq2MemberSet.name,
        }),
        extraPlugins: [new MessagingServicePlugin({ reliableDelivery: false })],
      });
      try {
        const ownerToken = await stack.signUp(OWNER);
        const otherToken = await stack.signUp(OTHER);

        const created = await stack.apiAs(ownerToken, 'POST', `/data/${OBJECT}`, { name: 'owned record' });
        expect(created.status, await created.clone().text()).toBe(201);
        const recordId = ((await created.json()) as { id: string }).id;

        // The record is private to its owner: the other member cannot read it.
        const otherRead = await stack.apiAs(otherToken, 'GET', `/data/${OBJECT}/${recordId}`);
        expect(otherRead.status).not.toBe(200);

        // Strict mode is in force in this composition: a principal-less read is refused.
        const ql = stack.kernel.getService<IObjectQLEngine>('objectql');
        const refused = await ql.find(OBJECT, {}).then(
          () => null,
          (e: { code?: string; status?: number }) => ({ code: e.code, status: e.status }),
        );
        expect(refused).toEqual({ code: 'PERMISSION_DENIED', status: 403 });

        const messaging = stack.kernel.getService<{
          emit(input: Record<string, unknown>): Promise<{ deliveries: Array<{ recipient: string; ok: boolean }> }>;
        }>('notification');
        const emitted = await messaging.emit({
          topic: TOPIC,
          audience: `owner_of:${OBJECT}:${recordId}`,
          payload: { title: 'A note for the owner', body: 'Owner resolution under strict mode.' },
        });
        expect(emitted.deliveries.length, 'the owner_of audience resolved a recipient').toBeGreaterThan(0);

        const inboxOf = async (token: string): Promise<InboxRow[]> => {
          const res = await stack.apiAs(token, 'GET', `/notifications?${new URLSearchParams({ type: TOPIC })}`);
          expect(res.status, 'GET /notifications').toBe(200);
          return ((await res.json()) as { data: { notifications: InboxRow[] } }).data.notifications;
        };
        const ownerInbox = await inboxOf(ownerToken);
        expect(ownerInbox.length, "the owner's inbox holds the one notification").toBe(1);
        expect(ownerInbox[0].title).toBe('A note for the owner');
        expect(await inboxOf(otherToken), 'nobody but the owner is a recipient').toEqual([]);
      } finally {
        await stack.stop();
      }
    },
    120_000,
  );
});
