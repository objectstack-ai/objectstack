// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// An approval notification reaches its recipient WITH its text.
//
// Every approval notification arrived as a title over an empty body. The
// approvals service put its text in `payload.message`, and the messaging
// service builds the delivered notification from `payload.title` and
// `payload.body` only — the field its `EmitInput` documents — so the comment,
// the request-info question and every escalation line were dropped on the way
// to the inbox: `GET /api/v1/notifications` answered `body: ""` under a
// correct title. The flow `notify` node and the @mention producer already send
// `body`; approvals was the one producer speaking another dialect.
//
// The fix is at the producer, with no alias in messaging: one field, as
// documented. This pins it at the door a recipient actually reads, on a booted
// app with the real approvals + messaging + REST chain:
//
//   ⭐ a submitter's comment is read back as the BODY of the approver's
//      `approval.comment` notification;
//   ⭐ an approver's request-info question is read back as the BODY of the
//      submitter's `approval.request_info` notification;
//   ⭐ each is the ONE notification of its topic in that inbox and carries its
//      title — so an empty body is a body that lost its text, never a
//      notification that never arrived (the control the defect needed: its
//      title was always there).
//
// The fixture is owned by this pin and kept inline: one object whose create
// opens a request routed to a `user` approver authored as an EMAIL, so the
// approver is a real account reached through the address an author writes.
// Messaging runs its inline fan-out (`reliableDelivery: false`) so the inbox
// row exists when the thread call returns; the outbox path builds the same
// notification from the same `payload.body` (`messaging-service.ts` /
// `dispatcher.ts`), and the producer-side pin across the service's call sites
// is `plugin-approvals/src/approval-notification-body.integration.test.ts`.

import { describe, it, expect } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { defineStack, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { MessagingServicePlugin } from '@objectstack/service-messaging';

const OBJECT = 'anb_request';
const SUBMITTER = 'anb-submitter@example.com';
const REVIEWER = 'anb-reviewer@example.com';

/** The text each side writes — distinct, so neither can pass for the other. */
const COMMENT = 'The signed contract is attached to the record now.';
const QUESTION = 'Which cost centre should this be booked against?';

const AnbRequest = ObjectSchema.create({
  name: OBJECT,
  label: 'Notification Body Request',
  pluralLabel: 'Notification Body Requests',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

const AnbFlow = defineFlow({
  name: 'anb_flow',
  label: 'Notification Body Flow',
  description: 'Fires on insert and routes to one user approver, authored as an email.',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'On Create', config: { objectName: OBJECT, triggerType: 'record-after-create' } },
    {
      id: 'review',
      type: 'approval',
      label: 'Review',
      config: { approvers: [{ type: 'user', value: REVIEWER }], behavior: 'first_response' },
    },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'review' },
    { id: 'e2', source: 'review', target: 'approved', label: 'approve' },
    { id: 'e3', source: 'review', target: 'rejected', label: 'reject' },
  ],
});

const anbStack = defineStack({
  manifest: {
    id: 'com.dogfood.approval-notification-body',
    namespace: 'anb',
    version: '0.0.0',
    type: 'app',
    name: 'Approval Notification Body Fixture',
    description: 'One object, one flow routed to an email-authored user approver.',
  },
  // ADR-0097: the `record-after-create` start node needs the trigger pair
  // declared; the pin mounts both explicitly.
  requires: ['automation', 'triggers'],
  objects: [AnbRequest],
  flows: [AnbFlow],
});

/** Every fresh member resolves to create + read on the request object only. */
const anbMemberSet = PermissionSetSchema.parse({
  name: 'anb_member',
  label: 'Notification Body Member — create + read on anb_request only',
  objects: {
    [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false },
  },
});

interface InboxRow {
  id: string;
  type: string;
  title: string;
  body: string;
}

describe('an approval notification reaches its recipient with its text in the body', () => {
  it(
    "a comment and a request-info question are read back from the recipient's GET /api/v1/notifications",
    async () => {
      const stack = await bootStack(anbStack as unknown as Parameters<typeof bootStack>[0], {
        automation: true,
        security: new SecurityPlugin({
          defaultPermissionSets: [...securityDefaultPermissionSets, anbMemberSet],
          fallbackPermissionSet: anbMemberSet.name,
        }),
        extraPlugins: [
          new MessagingServicePlugin({ reliableDelivery: false }),
          new RecordChangeTriggerPlugin(),
          new ApprovalsServicePlugin(),
        ],
      });
      try {
        const submitterToken = await stack.signUp(SUBMITTER);
        const reviewerToken = await stack.signUp(REVIEWER);

        const created = await stack.apiAs(submitterToken, 'POST', `/data/${OBJECT}`, { name: 'contract' });
        expect(created.status).toBe(201);

        // The request opened, on the email slot — a missing request would
        // otherwise read below as "no notification", not as the defect.
        const pending = await stack.apiAs(reviewerToken, 'GET', `/approvals/requests?${new URLSearchParams({
          status: 'pending', approverId: REVIEWER,
        })}`);
        expect(pending.status).toBe(200);
        const rows = ((await pending.json()) as { data: Array<{ id: string; pending_approvers?: string[] }> }).data;
        expect(rows.map((r) => r.pending_approvers)).toEqual([[REVIEWER]]);
        const requestId = rows[0].id;

        const inboxOf = async (token: string, topic: string): Promise<InboxRow[]> => {
          const res = await stack.apiAs(token, 'GET', `/notifications?${new URLSearchParams({ type: topic })}`);
          expect(res.status, `GET /notifications?type=${topic}`).toBe(200);
          const json = (await res.json()) as { data: { notifications: InboxRow[] } };
          return json.data.notifications;
        };

        // ⭐ The submitter comments; the approver's notification carries it.
        const commented = await stack.apiAs(submitterToken, 'POST', `/approvals/requests/${requestId}/comment`, {
          comment: COMMENT,
        });
        expect(commented.status).toBe(200);
        const toReviewer = await inboxOf(reviewerToken, 'approval.comment');
        expect(toReviewer.length, "the approver's inbox holds the one comment notification").toBe(1);
        expect(toReviewer[0].title).not.toBe('');
        expect(toReviewer[0].body, "the comment is the notification's body").toBe(COMMENT);

        // ⭐ The approver asks; the submitter's notification carries the question.
        const asked = await stack.apiAs(reviewerToken, 'POST', `/approvals/requests/${requestId}/request-info`, {
          comment: QUESTION,
        });
        expect(asked.status).toBe(200);
        const toSubmitter = await inboxOf(submitterToken, 'approval.request_info');
        expect(toSubmitter.length, "the submitter's inbox holds the one request-info notification").toBe(1);
        expect(toSubmitter[0].title).not.toBe('');
        expect(toSubmitter[0].body, "the question is the notification's body").toBe(QUESTION);

        // Each side reads only what was addressed to it: the submitter wrote
        // the comment and is not its recipient, and the reverse.
        expect(await inboxOf(submitterToken, 'approval.comment')).toEqual([]);
        expect(await inboxOf(reviewerToken, 'approval.request_info')).toEqual([]);
      } finally {
        await stack.stop();
      }
    },
    120_000,
  );
});
