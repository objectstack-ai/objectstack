// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// EMAIL TEMPLATE MATERIALIZATION proof (ADR-0054), exercised end-to-end through
// the real in-process stack.
//
// @proof: email-template-materialization
// ADR-0054 runtime proof for the email-template-materialization high-risk class.
// Referenced by the liveness ledger entry `email_template.subject`
// (packages/spec/liveness/email_template.json); the spec liveness gate fails if
// this tag is removed. See proof-registry.mts.
//
// An email_template prop being `live` means the loader + renderer READ it —
// necessary but not sufficient. This boots the real stack with the email
// plugin, authors a template via the app config's `emailTemplates:` array, and
// asserts that the AUTHORED wording is what reaches the transport — not the
// built-in auth copy it overrides. That is the ADR-0078 false-compliance case
// #4509 named: an admin "fixes" the password-reset mail, gets a success toast,
// and users keep receiving the built-in version.
//
// ADR-0131 D6/D10 (ruling C on §6 Q1) moved the seam this proof crosses. The
// authored template used to be materialized into a `sys_email_template` row
// that `sendTemplate` read; it is now read from the registry by `(name,
// locale)`, where the built-in auth templates are code-declared too. So the
// proof asserts both ends of the new graph:
//   1. no row is materialized at all, and the registry serves the authored
//      item beside the built-in one it overrides;
//   2. `EmailService.sendTemplate` renders THAT item — and still renders the
//      built-in where the app declares no member (the zh-CN send);
//   3. a Studio save over the authored template sends on the very next mail,
//      with no restart.
//
// It also pins the #3461 integration lesson: templates resolve on the data
// engine alone, so a boot with no real transport configured must still serve
// them.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { EmailServicePlugin } from '@objectstack/plugin-email';
import { emailTemplateFixtureStack, etPasswordReset } from './fixtures/email-template-materialization-fixture.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

/**
 * Capturing transport — `sendTemplate` returns a delivery result, not the
 * rendered message, so the only way to prove WHICH template was rendered is to
 * look at what reached the wire.
 */
const sent: Array<{ subject?: string; html?: string }> = [];
const captureTransport = {
  async send(message: { subject?: string; html?: string }) {
    sent.push({ subject: message.subject, html: message.html });
    return { messageId: `captured-${sent.length}` };
  },
};

describe('objectstack verify EMAIL TEMPLATE: authored template materializes and renders (#email-template-materialization)', () => {
  let stack: VerifyStack;

  beforeAll(async () => {
    // A capturing transport stands in for delivery. The bridge must run on the
    // data engine alone, independent of what (if anything) delivers.
    stack = await bootStack(emailTemplateFixtureStack, {
      extraPlugins: [new EmailServicePlugin({
        transport: captureTransport as never,
        defaultFrom: { address: 'no-reply@example.test', name: 'ET Fixture' },
      })],
    });
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('materializes no row: the registry serves the authored item beside the built-in it overrides', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = (await stack.kernel.getServiceAsync('objectql')) as any;
    expect(await engine.find('sys_email_template', { context: SYSTEM_CTX })).toEqual([]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const protocol = (await stack.kernel.getServiceAsync('protocol')) as any;
    const listed = await protocol.getMetaItemsForExecution({ type: 'email_template' });
    const slot = (listed.items as Array<Record<string, unknown>>)
      .filter((i) => i.name === 'auth.password_reset' && (i.locale ?? 'en-US') === 'en-US')
      .map((i) => ({ packageId: i._packageId, subject: i.subject }));
    expect(slot).toEqual(expect.arrayContaining([
      { packageId: 'com.dogfood.email-template-fixture', subject: 'Authored reset for {{user.name}}' },
      { packageId: 'com.objectstack.service.email', subject: 'Reset your {{appName}} password' },
    ]));
  });

  it('renders the authored template through sendTemplate — the built-in copy does not reach the wire', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const email = (await stack.kernel.getServiceAsync('email')) as any;

    const result = await email.sendTemplate({
      to: 'someone@example.com',
      template: 'auth.password_reset',
      data: { url: 'https://example.test/reset', user: { name: 'Ada' } },
    });

    expect(result.status, `sendTemplate failed: ${result.error ?? ''}`).not.toBe('failed');
    // The rendered message proves the authored row — not the built-in copy —
    // reached the execution point, with placeholders interpolated.
    const delivered = sent.at(-1);
    expect(delivered?.subject, 'the built-in copy was rendered instead of the authored template')
      .toBe('Authored reset for Ada');
    expect(delivered?.html).toContain('Authored body');
  });

  it('still renders the built-in member where the app declares none (the zh-CN send)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const email = (await stack.kernel.getServiceAsync('email')) as any;

    const result = await email.sendTemplate({
      to: 'someone@example.com',
      template: 'auth.password_reset',
      locale: 'zh-CN',
      data: { appName: 'Acme', resetUrl: 'https://example.test/reset', expiresInMinutes: 30, user: { name: 'Ada', email: 'ada@example.test' } },
    });

    expect(result.status, `sendTemplate failed: ${result.error ?? ''}`).not.toBe('failed');
    expect(sent.at(-1)?.subject).toBe('重置您的 Acme 密码');
  });

  it('a Studio save over the authored template sends on the very next mail, with no restart', async () => {
    const token = await stack.signIn();
    const put = await stack.apiAs(token, 'PUT', '/meta/email_template/auth.password_reset', {
      ...etPasswordReset,
      subject: 'Studio reset for {{user.name}}',
    });
    expect(put.status, await put.clone().text()).toBe(200);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const email = (await stack.kernel.getServiceAsync('email')) as any;
    const result = await email.sendTemplate({
      to: 'someone@example.com',
      template: 'auth.password_reset',
      data: { url: 'https://example.test/reset', user: { name: 'Ada' } },
    });

    expect(result.status, `sendTemplate failed: ${result.error ?? ''}`).not.toBe('failed');
    expect(sent.at(-1)?.subject).toBe('Studio reset for Ada');
  });
});
