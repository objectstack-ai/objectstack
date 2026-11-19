// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// `SendTemplateInput.deliverOnlyData`: values delivered with the message and never
// written to the stored mail row.

import { describe, it, expect } from 'vitest';
import type { IQueueService, NormalizedEmailMessage, TransportSendResult } from '@objectstack/spec/contracts';
import { EmailService, type EmailTemplateRow, type TemplateLoader } from './email-service.js';

const TEMPLATE: EmailTemplateRow = {
  name: 'auth.invitation',
  locale: 'en-US',
  subject: 'Join {{orgName}}',
  body_html: '<p>Join {{orgName}}: <a href="{{acceptUrl}}">accept</a></p>',
  body_text: 'Join {{orgName}}: {{acceptUrl}}',
  active: true,
  variables_json: JSON.stringify([{ name: 'acceptUrl', required: true }]),
};

const PLAIN_URL = 'https://app.example.com/accept-invitation/inv_1';
const DELIVERED_URL = `${PLAIN_URL}#proof=DELIVERONLYVALUE`;

function loader(): TemplateLoader {
  return { async load(name) { return name === TEMPLATE.name ? TEMPLATE : null; } };
}

function setup(withQueue = false) {
  const sent: NormalizedEmailMessage[] = [];
  const rows = new Map<string, Record<string, any>>();
  const published: unknown[] = [];
  const queue = {
    async publish(_q: string, data: unknown) { published.push(data); return 'job-1'; },
    async subscribe() {},
    async unsubscribe() {},
  } as unknown as IQueueService;
  const svc = new EmailService({
    transport: {
      async send(message: NormalizedEmailMessage): Promise<TransportSendResult> {
        sent.push(message);
        return { messageId: `m-${sent.length}` };
      },
    },
    defaultFrom: { address: 'no-reply@example.com' },
    templateLoader: loader(),
    persistence: {
      async insert(row) { rows.set(row.id, { ...row }); return { id: row.id }; },
      async update(id, patch) { const cur = rows.get(id); if (cur) rows.set(id, { ...cur, ...patch }); },
    },
    ...(withQueue
      ? { queueDelivery: { resolve: () => queue, maxAttempts: 1, backoff: { type: 'exponential' as const, delayMs: 1000, maxDelayMs: 1000 } } }
      : {}),
  });
  return { svc, sent, rows, published };
}

const storedText = (row: Record<string, any> | undefined) =>
  JSON.stringify({ subject: row?.subject, body_text: row?.body_text, body_html: row?.body_html });

describe('deliver-only template values (#34257)', () => {
  it('the recipient receives the deliver-only values and the stored mail row never holds them', async () => {
    const { svc, sent, rows } = setup();
    const res = await svc.sendTemplate({
      template: 'auth.invitation',
      to: 'invitee@example.com',
      data: { orgName: 'Acme', acceptUrl: PLAIN_URL },
      deliverOnlyData: { acceptUrl: DELIVERED_URL },
    });

    expect(res.status).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain(DELIVERED_URL);
    expect(sent[0]!.html).toContain(DELIVERED_URL);

    const row = rows.get(res.id);
    expect(row?.status).toBe('sent');
    expect(row?.body_text).toContain(PLAIN_URL);
    expect(storedText(row)).not.toContain('DELIVERONLYVALUE');
  });

  it('a send carrying deliver-only values is delivered inline even when queue delivery is wired', async () => {
    const { svc, sent, rows, published } = setup(true);
    const res = await svc.sendTemplate({
      template: 'auth.invitation',
      to: 'invitee@example.com',
      data: { orgName: 'Acme', acceptUrl: PLAIN_URL },
      deliverOnlyData: { acceptUrl: DELIVERED_URL },
    });

    expect(res.status).toBe('sent');
    expect(published).toHaveLength(0);
    expect(sent[0]!.text).toContain(DELIVERED_URL);
    expect(storedText(rows.get(res.id))).not.toContain('DELIVERONLYVALUE');
  });

  it('a send without deliver-only values keeps its delivery mode and records what it delivered', async () => {
    const { svc, rows, published } = setup(true);
    const res = await svc.sendTemplate({
      template: 'auth.invitation',
      to: 'invitee@example.com',
      data: { orgName: 'Acme', acceptUrl: PLAIN_URL },
    });

    expect(res.status).toBe('queued');
    expect(published).toHaveLength(1);
    expect(rows.get(res.id)?.body_text).toContain(PLAIN_URL);
  });
});
