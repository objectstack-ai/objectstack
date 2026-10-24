// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `notify` email-field recipient (ruling 6377731715 on #25496, letter B;
 * #25610): `recipients: { emailField }` names an `email`-typed field of the
 * triggering record, and the address it holds is the recipient. ⛔ Never a
 * free string, never an expression that builds an address.
 *
 * Pinned here: the form parses; a string and an envelope never parse AS it;
 * every malformed spelling of it is refused with its own reason; it is the
 * whole value, never a list entry; and the node names `email` as its only
 * channel. Whether the named field exists and is `email`-typed is the
 * reference-integrity rule's question (`@objectstack/lint`,
 * `validateNotifyEmailFieldRecipients`) and is pinned there.
 */

import { describe, expect, it } from 'vitest';

import { NotifyConfigSchema, NotifyEmailFieldRecipientSchema } from './io-node-config.zod.js';
import { FlowSchema } from './flow.zod.js';

const BASE = { title: 'Your application was received', channels: 'email' } as const;

/** Every issue message of a refused config, or `[]` when it parsed. */
function messages(value: unknown): string[] {
  const result = NotifyConfigSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe('notify email-field recipient — the form', () => {
  it('parses as the whole `recipients` value and keeps its shape', () => {
    const result = NotifyConfigSchema.safeParse({ ...BASE, recipients: { emailField: 'applicant_email' } });
    expect(result.success).toBe(true);
    expect(result.success && result.data.recipients).toEqual({ emailField: 'applicant_email' });
  });

  it('parses through a whole flow, in a notify node', () => {
    const result = FlowSchema.safeParse({
      name: 'application_received',
      label: 'Application received',
      type: 'record_change',
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { objectName: 'supplier_application', triggerType: 'record-after-create' } },
        { id: 'tell_applicant', type: 'notify', label: 'Tell the applicant', config: { ...BASE, recipients: { emailField: 'contact_email' } } },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'tell_applicant' }],
    });
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('accepts `channels` written as a one-entry list too', () => {
    expect(messages({ ...BASE, channels: ['email'], recipients: { emailField: 'applicant_email' } })).toEqual([]);
  });
});

describe('notify email-field recipient — a free string or an expression never parses as it', () => {
  it.each([
    ['an address written out', 'applicant@example.com'],
    ['a field name written bare', 'applicant_email'],
    ['a CEL value envelope', { dialect: 'cel', source: 'record.applicant_email' }],
  ])('%s is not an email-field recipient', (_label, value) => {
    expect(NotifyEmailFieldRecipientSchema.safeParse(value).success).toBe(false);
  });

  it('a string in `recipients` stays a string recipient (a user id or audience selector), not this form', () => {
    const result = NotifyConfigSchema.safeParse({ title: 't', recipients: 'applicant_email' });
    expect(result.success && result.data.recipients).toBe('applicant_email');
  });

  it('an envelope in `recipients` stays a CEL value, not this form', () => {
    const result = NotifyConfigSchema.safeParse({ title: 't', recipients: { dialect: 'cel', source: 'record.owner' } });
    expect(result.success && result.data.recipients).toEqual({ dialect: 'cel', source: 'record.owner' });
  });

  it('refuses an expression written as the field name — `emailField` holds a name, never a value', () => {
    const issues = messages({ ...BASE, recipients: { emailField: { dialect: 'cel', source: 'record.a + \'@x.com\'' } } });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^An email-field recipient, /);
    expect(issues[0]).toContain('`emailField` is a field name, as a string.');
  });

  it('refuses an address written as the field name', () => {
    const issues = messages({ ...BASE, recipients: { emailField: 'applicant@example.com' } });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^An email-field recipient, /);
    expect(issues[0]).toContain('is not a field\'s machine name');
  });

  it('refuses a key beside `emailField`, naming it', () => {
    const result = NotifyConfigSchema.safeParse({ ...BASE, recipients: { emailField: 'applicant_email', fallback: 'ops@example.com' } });
    expect(result.success).toBe(false);
    const message = result.success ? '' : result.error.issues[0].message;
    expect(message).toMatch(/^An email-field recipient, /);
    expect(message).toContain('fallback');
  });
});

describe('notify email-field recipient — the whole value, delivered by email', () => {
  it('refuses it as a list entry', () => {
    const issues = messages({ ...BASE, recipients: ['team:ops', { emailField: 'applicant_email' }] });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('The entry at `[1]` is one, and an email-field recipient is the whole `recipients` value');
  });

  it('refuses a node with no `channels` — the default inbox has no address to deliver to', () => {
    const result = NotifyConfigSchema.safeParse({ title: 't', recipients: { emailField: 'applicant_email' } });
    expect(result.success).toBe(false);
    const issue = result.success ? undefined : result.error.issues[0];
    expect(issue?.code).toBe('custom');
    expect(issue?.path).toEqual(['channels']);
    expect(issue?.message).toMatch(/^`recipients` is an email-field recipient/);
  });

  it.each([
    ['inbox', 'inbox'],
    ['email beside another channel', ['email', 'inbox']],
    ['an empty list', []],
  ])('refuses `channels` naming %s', (_label, channels) => {
    const result = NotifyConfigSchema.safeParse({ title: 't', channels, recipients: { emailField: 'applicant_email' } });
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((i) => i.path.join('.'))).toEqual(['channels']);
  });

  it('leaves `channels` free for every other recipient form', () => {
    expect(messages({ title: 't', recipients: 'u1', channels: ['inbox', 'email'] })).toEqual([]);
    expect(messages({ title: 't', recipients: 'u1' })).toEqual([]);
  });
});
