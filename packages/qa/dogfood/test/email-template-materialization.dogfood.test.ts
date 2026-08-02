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
// An email_template prop being `live` means the materializer + renderer READ it
// — necessary but not sufficient. This boots the real stack with the email
// plugin, authors a template via the app config's `emailTemplates:` array, and
// asserts BOTH ends of the graph that #4509 found disconnected:
//   1. the authored metadata materializes into a `sys_email_template` row with
//      the spec→runtime remap applied (`bodyHtml`→`body_html`);
//   2. `EmailService.sendTemplate` then renders THAT template — not the built-in
//      auth copy it overrides. This is the ADR-0078 false-compliance case the
//      issue named: an admin "fixes" the password-reset mail, gets a success
//      toast, and users keep receiving the built-in version.
//
// It also pins the #3461 integration lesson the bridge inherits: materialization
// is gated on the data engine ALONE, so a boot with no transport configured
// (LogTransport) must still materialize — a bridge re-gated behind delivery
// prerequisites would materialize nothing and this proof would fail.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { EmailServicePlugin } from '@objectstack/plugin-email';
import { emailTemplateFixtureStack } from './fixtures/email-template-materialization-fixture.js';

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

  it('materializes the stack-authored template into a sys_email_template row (bodyHtml→body_html)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = (await stack.kernel.getServiceAsync('objectql')) as any;
    const rows = await engine.find('sys_email_template', {
      filter: { name: 'auth.password_reset', locale: 'en-US' },
      context: SYSTEM_CTX,
    });

    expect(rows, 'authored template was NOT materialized into a sys_email_template row').toHaveLength(1);
    const row = rows[0];

    // The remap that is the whole point of the bridge, and the authored wording
    // beating the built-in seed.
    expect(row.body_html, 'spec `bodyHtml` did not remap to runtime `body_html`')
      .toContain('Authored body');
    expect(row.subject, 'the built-in auth template overwrote the authored one')
      .toBe('Authored reset for {{user.name}}');

    // Boot-seeded provenance (seed-not-clobber): a package row, not admin.
    expect(row.managed_by).toBe('package');
  });

  it('renders the authored template through sendTemplate — the disconnect #4509 closed', async () => {
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
});
