// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { boundCallerMail } from './caller-mail-bounds.js';

const SENDER = { getDefaultFrom: () => ({ name: 'Acme', address: 'noreply@acme.test' }) };
const CALLER = { userId: 'usr_ann', organizationId: 'org_acme' };
const message = { to: 'pat@example.test', subject: 'Quote', text: 'Attached.' };

describe('a caller-sent message is sent by the caller, from the configured sender, under the caller\'s organization', () => {
  it('stamps the sending user and the organization', () => {
    const out = boundCallerMail({ ...message }, CALLER, SENDER);
    expect(out).toEqual({ ok: true, input: { ...message, sentBy: 'usr_ann', organizationId: 'org_acme' } });
  });

  it('refuses a message naming another user, another organization, another sender, or identity mail', () => {
    expect(boundCallerMail({ ...message, sentBy: 'usr_other' }, CALLER, SENDER).ok).toBe(false);
    expect(boundCallerMail({ ...message, organizationId: 'org_other' }, CALLER, SENDER).ok).toBe(false);
    expect(boundCallerMail({ ...message, from: 'ceo@acme.test' }, CALLER, SENDER).ok).toBe(false);
    expect(boundCallerMail({ ...message, headers: { Sender: 'ceo@acme.test' } }, CALLER, SENDER).ok).toBe(false);
    expect(boundCallerMail({ ...message, identityMail: true }, CALLER, SENDER).ok).toBe(false);
  });

  it('replaces a `from` restating the configured address with the configured value', () => {
    const out = boundCallerMail({ ...message, from: 'Someone <NOREPLY@acme.test>' }, CALLER, SENDER);
    expect(out).toEqual({
      ok: true,
      input: { ...message, sentBy: 'usr_ann', organizationId: 'org_acme', from: SENDER.getDefaultFrom() },
    });
  });

  it('records no sending user for a call that has none, and refuses a message naming one', () => {
    const none = { userId: undefined, organizationId: 'org_acme' };
    expect(boundCallerMail({ ...message }, none, SENDER)).toEqual({
      ok: true,
      input: { ...message, organizationId: 'org_acme' },
    });
    const named = boundCallerMail({ ...message, sentBy: 'usr_ann' }, none, SENDER);
    expect(named.ok).toBe(false);
    expect((named as { reason: string }).reason).toMatch(/no calling user/);
  });
});
