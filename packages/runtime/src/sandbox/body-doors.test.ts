// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ctx.email.send` and `ctx.activity.append`: a body's mail and timeline
 * entries carry the caller the platform resolved, never one the body names.
 *
 * Each door is driven through {@link buildBodyDoors} with a recording mail
 * service, a recording activity writer and a data layer that answers only the
 * records the caller can read.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  BODY_ACTIVITY_METADATA_LIMIT,
  BODY_MAIL_ADDRESS_LIMIT,
  BODY_MAIL_ADDRESS_LIST_LIMIT,
  BODY_MAIL_RECIPIENT_LIMIT,
} from '@objectstack/spec/data';
import { buildBodyDoors, appMailHourlyLimit, callerScopeOf, DEFAULT_APP_MAIL_HOURLY_LIMIT, type BodyDoorCaller } from './body-doors.js';
import { APP_AUTOMATION_ELEVATION } from '@objectstack/core';

const ANN: BodyDoorCaller = { userId: 'usr_ann', organizationId: 'org_acme', readContext: { userId: 'usr_ann', tenantId: 'org_acme' } };

function world(opts: { readable?: string[]; sentLastHour?: number; from?: unknown; noEmail?: boolean; noAudit?: boolean } = {}) {
  const readable = new Set(opts.readable ?? ['crm_contact/c1', 'sys_email/e1']);
  const reads: Array<{ object: string; context: unknown }> = [];
  const counts: Array<{ where: unknown }> = [];
  const sent: any[] = [];
  const appended: Array<{ entry: any; stamp: any }> = [];
  const ql = {
    async findOne(object: string, query: any, options: any) {
      const id = query?.where?.id;
      if (object === 'sys_user' && id === 'usr_ann') return { id, name: 'Ann "The" Lee' };
      if (object === 'sys_organization' && id === 'org_acme') return { id, name: 'Acme <Corp>' };
      reads.push({ object, context: options?.context });
      return readable.has(`${object}/${id}`) ? { id } : null;
    },
    async count(_object: string, query: any) {
      counts.push({ where: query?.where });
      return opts.sentLastHour ?? 0;
    },
  };
  const email = {
    getDefaultFrom: () => ('from' in opts ? opts.from : { name: 'Acme CRM', address: 'noreply@acme.test' }),
    async send(input: any) {
      sent.push(input);
      return { id: 'em_1', status: 'queued' };
    },
  };
  const audit = {
    async appendAppActivity(entry: any, stamp: any) {
      appended.push({ entry, stamp });
      return { id: 'act_1' };
    },
  };
  const getService = (name: string) => {
    if (name === 'email') return opts.noEmail ? undefined : email;
    if (name === 'audit') return opts.noAudit ? undefined : audit;
    throw new Error(`no service '${name}'`);
  };
  return { ql, getService, reads, counts, sent, appended };
}

function doors(w: ReturnType<typeof world>, caller: BodyDoorCaller = ANN) {
  return buildBodyDoors({
    ql: w.ql,
    getService: w.getService,
    packageId: 'com.acme.crm',
    origin: { kind: 'action', name: 'send_quote' },
    caller,
  });
}

const message = { to: 'pat@example.test', subject: 'Quote', text: 'Attached.' };
const entry = { object: 'crm_contact', recordId: 'c1', type: 'completed', summary: 'Email: Quote' };

describe('ctx.email.send sends as the calling user, under the caller\'s organization, from the configured sender', () => {
  it('stamps the sending user and organization, and names the user beside the organization in the sender', async () => {
    const w = world();
    const out = await doors(w).email.send({ ...message, related: { object: 'crm_contact', id: 'c1' } });
    expect(out).toEqual({ id: 'em_1', status: 'queued' });
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toMatchObject({
      ...message,
      sentBy: 'usr_ann',
      organizationId: 'org_acme',
      relatedObject: 'crm_contact',
      relatedId: 'c1',
      from: { name: 'Ann The Lee via Acme Corp', address: 'noreply@acme.test' },
    });
  });

  it('reads the related record in the caller\'s own scope, and refuses one the caller cannot read without sending', async () => {
    const w = world({ readable: [] });
    await expect(doors(w).email.send({ ...message, related: { object: 'crm_contact', id: 'c1' } })).rejects.toMatchObject({
      code: 'RECORD_NOT_FOUND',
      statusCode: 404,
    });
    expect(w.reads).toEqual([{ object: 'crm_contact', context: ANN.readContext }]);
    expect(w.sent).toHaveLength(0);
  });

  for (const key of ['from', 'sentBy', 'organizationId', 'headers', 'identityMail']) {
    it(`refuses a message naming \`${key}\` and sends nothing`, async () => {
      const w = world();
      await expect(doors(w).email.send({ ...message, [key]: 'x' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
      expect(w.sent).toHaveLength(0);
    });
  }

  it(`refuses more than ${BODY_MAIL_RECIPIENT_LIMIT} recipients across to, cc and bcc`, async () => {
    const w = world();
    const list = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}@example.test`);
    await expect(
      doors(w).email.send({ ...message, to: list(30, 't'), cc: list(15, 'c'), bcc: list(6, 'b') }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(w.sent).toHaveLength(0);
  });

  it(`refuses a slot that takes more than ${BODY_MAIL_ADDRESS_LIST_LIMIT} characters as the mail log records it`, async () => {
    const w = world();
    const long = (i: number) => ({ name: 'N'.repeat(150), address: `r${i}@example.test` });
    await expect(
      doors(w).email.send({ ...message, cc: Array.from({ length: 30 }, (_, i) => long(i)) }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(w.sent).toHaveLength(0);
  });

  it(`refuses a replyTo that takes more than ${BODY_MAIL_ADDRESS_LIMIT} characters as recorded`, async () => {
    const w = world();
    await expect(
      doors(w).email.send({ ...message, replyTo: { name: '"'.repeat(150), address: 'desk@example.test' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(w.sent).toHaveLength(0);
  });

  it('asks the mail service to send only what its log records', async () => {
    const w = world();
    await doors(w).email.send(message);
    expect(w.sent[0]).toMatchObject({ requireLogRow: true });
  });

  it('cuts the sender\'s display name so the sender fits the mail log', async () => {
    const address = `${'a'.repeat(200)}@acme.test`;
    const w = world({ from: { name: 'Acme CRM', address } });
    await doors(w).email.send(message);
    const from = w.sent[0].from as { name?: string; address: string };
    expect(from.address).toBe(address);
    expect((from.name ?? '').length + 5 + address.length).toBeLessThanOrEqual(BODY_MAIL_ADDRESS_LIMIT);
  });

  it('refuses a send once the organization\'s mail log records the hourly limit, counted for that organization', async () => {
    const w = world({ sentLastHour: DEFAULT_APP_MAIL_HOURLY_LIMIT });
    await expect(doors(w).email.send(message)).rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED', statusCode: 429 });
    expect(w.sent).toHaveLength(0);
    expect(w.counts[0].where).toMatchObject({ organization_id: 'org_acme' });
  });

  it('says the whole log was counted for a caller with no organization', async () => {
    const w = world({ sentLastHour: DEFAULT_APP_MAIL_HOURLY_LIMIT });
    const job: BodyDoorCaller = { userId: undefined, organizationId: undefined, readContext: {} };
    await expect(doors(w, job).email.send(message)).rejects.toThrow(/with no organization to count by, the whole mail log records/);
    expect(w.counts[0].where).not.toHaveProperty('organization_id');
  });

  it('sends with no user recorded for a body with no calling user', async () => {
    const w = world();
    const job: BodyDoorCaller = { userId: undefined, organizationId: 'org_acme', readContext: { isSystem: true, tenantId: 'org_acme' } };
    await doors(w, job).email.send(message);
    expect(w.sent[0]).not.toHaveProperty('sentBy');
    expect(w.sent[0]).toMatchObject({ organizationId: 'org_acme', from: { name: 'Acme CRM', address: 'noreply@acme.test' } });
  });

  it('answers NOT_IMPLEMENTED where the deployment has no mail service', async () => {
    await expect(doors(world({ noEmail: true })).email.send(message)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', statusCode: 501 });
  });
});

describe('ctx.activity.append adds an entry stamped with the caller and the body that wrote it', () => {
  it('hands the writer the stamped actor, organization and origin', async () => {
    const w = world();
    const out = await doors(w).activity.append({ ...entry, source: { object: 'sys_email', id: 'e1' } });
    expect(out).toEqual({ id: 'act_1' });
    expect(w.appended).toEqual([
      {
        entry: { ...entry, source: { object: 'sys_email', id: 'e1' } },
        stamp: { actorId: 'usr_ann', organizationId: 'org_acme', origin: 'com.acme.crm/action:send_quote' },
      },
    ]);
  });

  for (const key of ['actor_id', 'organization_id', 'origin']) {
    it(`refuses an entry naming \`${key}\` and writes nothing`, async () => {
      const w = world();
      await expect(doors(w).activity.append({ ...entry, [key]: 'x' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(w.appended).toHaveLength(0);
    });
  }

  it('refuses an entry about a record, or pointing at a source, the caller cannot read, and writes nothing', async () => {
    const w1 = world({ readable: [] });
    await expect(doors(w1).activity.append(entry)).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    const w2 = world({ readable: ['crm_contact/c1'] });
    await expect(doors(w2).activity.append({ ...entry, source: { object: 'sys_email', id: 'e9' } })).rejects.toMatchObject({
      code: 'RECORD_NOT_FOUND',
    });
    expect([...w1.appended, ...w2.appended]).toHaveLength(0);
  });

  it(`refuses metadata that takes more than ${BODY_ACTIVITY_METADATA_LIMIT} characters as JSON, and writes nothing`, async () => {
    const w = world();
    await expect(
      doors(w).activity.append({ ...entry, metadata: { note: 'x'.repeat(BODY_ACTIVITY_METADATA_LIMIT) } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(w.appended).toHaveLength(0);
  });

  it('answers NOT_IMPLEMENTED where the deployment has no activity feed', async () => {
    await expect(doors(world({ noAudit: true })).activity.append(entry)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });
});

describe('the caller\'s scope and the hourly limit', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('takes the body\'s elevation off the caller\'s envelope', () => {
    const elevated = { userId: 'usr_ann', tenantId: 'org_acme', isSystem: true, [APP_AUTOMATION_ELEVATION]: 'action' };
    expect(callerScopeOf(elevated)).toEqual({ userId: 'usr_ann', tenantId: 'org_acme' });
    expect(callerScopeOf({ isSystem: true })).toEqual({ isSystem: true });
  });

  it('answers a scope with no principal for no context', () => {
    expect(callerScopeOf(undefined)).toEqual({});
  });

  it('reads OS_EMAIL_APP_SEND_HOURLY_LIMIT, and refuses a value that is not a whole number', () => {
    expect(appMailHourlyLimit({})).toBe(DEFAULT_APP_MAIL_HOURLY_LIMIT);
    expect(appMailHourlyLimit({ OS_EMAIL_APP_SEND_HOURLY_LIMIT: '25' })).toBe(25);
    expect(() => appMailHourlyLimit({ OS_EMAIL_APP_SEND_HOURLY_LIMIT: 'lots' })).toThrow(/whole number/);
  });
});
