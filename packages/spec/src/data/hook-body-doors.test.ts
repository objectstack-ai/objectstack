// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  BODY_ACTIVITY_METADATA_LIMIT,
  BODY_MAIL_ADDRESS_LIST_LIMIT,
  BODY_MAIL_RECIPIENT_LIMIT,
  BodyActivityAppendInputSchema,
  BodyMailSendInputSchema,
} from './hook-body-doors.zod';
import { SYS_ACTIVITY_BUILTIN_TYPES, SYS_ACTIVITY_PLATFORM_TYPES } from './feed.zod';

describe('ctx.email.send input: what the platform says about a message is not an input', () => {
  const message = { to: 'pat@example.test', subject: 'Quote', text: 'Attached.' };

  it('takes a message with recipients, a subject and a body', () => {
    expect(BodyMailSendInputSchema.safeParse(message).success).toBe(true);
    expect(
      BodyMailSendInputSchema.safeParse({
        ...message,
        cc: [{ name: 'Lee', address: 'lee@example.test' }],
        replyTo: 'rep@example.test',
        related: { object: 'crm_contact', id: 'c1' },
      }).success,
    ).toBe(true);
  });

  for (const key of ['from', 'sentBy', 'organizationId', 'identityMail', 'headers', 'attachments']) {
    it(`refuses \`${key}\`: the door stamps it, or does not take it`, () => {
      expect(BodyMailSendInputSchema.safeParse({ ...message, [key]: 'x' }).success).toBe(false);
    });
  }

  it('refuses a message with no body', () => {
    expect(BodyMailSendInputSchema.safeParse({ to: 'pat@example.test', subject: 'Quote' }).success).toBe(false);
  });

  it(`names at most ${BODY_MAIL_RECIPIENT_LIMIT} recipients in one slot`, () => {
    const addresses = (n: number) => Array.from({ length: n }, (_, i) => `t${i}@example.test`);
    expect(BodyMailSendInputSchema.safeParse({ ...message, to: addresses(BODY_MAIL_RECIPIENT_LIMIT) }).success).toBe(true);
    expect(BodyMailSendInputSchema.safeParse({ ...message, bcc: addresses(BODY_MAIL_RECIPIENT_LIMIT + 1) }).success).toBe(false);
  });
});

describe('every string a door input takes has an upper bound', () => {
  const message = { to: 'pat@example.test', subject: 'Quote', text: 'Attached.' };
  const entry = { object: 'crm_contact', recordId: 'c1', type: 'completed', summary: 'Email: Quote' };

  it('bounds a message\'s subject, addresses, display names, bodies and related record', () => {
    for (const over of [
      { subject: 'x'.repeat(999) },
      { to: `${'a'.repeat(320)}@x.test` },
      { to: { name: 'n'.repeat(201), address: 'pat@example.test' } },
      { replyTo: `${'a'.repeat(320)}@x.test` },
      { text: 'x'.repeat(1_000_001) },
      { html: 'x'.repeat(1_000_001) },
      { related: { object: 'o'.repeat(101), id: 'c1' } },
      { related: { object: 'crm_contact', id: 'i'.repeat(101) } },
    ]) {
      expect(BodyMailSendInputSchema.safeParse({ ...message, ...over }).success, JSON.stringify(Object.keys(over))).toBe(false);
    }
  });

  it('bounds an entry\'s object, record, type and label', () => {
    for (const over of [
      { object: 'o'.repeat(256) },
      { recordId: 'i'.repeat(256) },
      { type: 't'.repeat(101) },
      { recordLabel: 'l'.repeat(256) },
    ]) {
      expect(BodyActivityAppendInputSchema.safeParse({ ...entry, ...over }).success, JSON.stringify(Object.keys(over))).toBe(false);
    }
  });

  it('states the limits it cannot spell as a rule in the published description', () => {
    const mail = BodyMailSendInputSchema.description ?? '';
    expect(mail).toContain(`At most ${BODY_MAIL_RECIPIENT_LIMIT} recipients across to, cc and bcc together`);
    expect(mail).toContain(`at most ${BODY_MAIL_ADDRESS_LIST_LIMIT} characters`);
    expect(BodyActivityAppendInputSchema.description ?? '').toContain(`at most ${BODY_ACTIVITY_METADATA_LIMIT} characters as JSON`);
  });
});

describe('ctx.activity.append input: the actor, organization and origin are not inputs', () => {
  const entry = { object: 'crm_contact', recordId: 'c1', type: 'completed', summary: 'Email: Quote' };

  it('takes an entry with a record, a type and a summary', () => {
    expect(BodyActivityAppendInputSchema.safeParse(entry).success).toBe(true);
    expect(
      BodyActivityAppendInputSchema.safeParse({
        ...entry,
        recordLabel: 'Pat Doe',
        source: { object: 'sys_email', id: 'e1' },
        metadata: { kind: 'email' },
      }).success,
    ).toBe(true);
  });

  for (const key of ['actor_id', 'actorId', 'actor_name', 'organization_id', 'origin', 'timestamp']) {
    it(`refuses \`${key}\`: the door stamps it`, () => {
      expect(BodyActivityAppendInputSchema.safeParse({ ...entry, [key]: 'x' }).success).toBe(false);
    });
  }
});

describe('the platform-only activity types', () => {
  it('are built-in types, and leave completed and scheduled open to apps', () => {
    for (const type of SYS_ACTIVITY_PLATFORM_TYPES) expect(SYS_ACTIVITY_BUILTIN_TYPES).toContain(type);
    expect(SYS_ACTIVITY_PLATFORM_TYPES).not.toContain('completed');
    expect(SYS_ACTIVITY_PLATFORM_TYPES).not.toContain('scheduled');
  });
});
