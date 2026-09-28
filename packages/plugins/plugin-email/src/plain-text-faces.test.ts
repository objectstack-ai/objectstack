// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The plain-text faces of a template render WITHOUT HTML escaping (#20374).
 *
 * A template has three faces and only one of them is markup: `body_html`.
 * The subject (a mail header, an inbox title) and `body_text` (the text/plain
 * part, an inbox body) are plain text. Rendering them through the HTML
 * escaper put `&amp;` into every link carrying a query string, so a
 * plain-text client — or a user copying the text link — received
 * `…?token=…&amp;callbackURL=%2F`: the token still parsed, the redirect
 * parameter arrived as `amp;callbackURL`, and a verified invitee landed on
 * `/` instead of the accept page.
 *
 * The switch lives in the engine (`renderPlainTextTemplate`), not in the
 * templates, so these pins run the REAL `EmailService` over the REAL seeded
 * built-in rows AND over an authored row nobody hand-braced — a per-template
 * `{{{…}}}` patch would pass the first half and fail the second.
 *
 * ⚠️ Every expectation is an independent literal: nothing is derived from the
 * template constants or from the renderer under test, so an edit that
 * reintroduces escaping cannot quietly agree with itself.
 */

import { describe, it, expect } from 'vitest';
import { EmailService, type EmailTemplateRow, type TemplateLoader } from './email-service.js';
import { BUILTIN_AUTH_TEMPLATES } from './templates/auth-templates.js';
import type {
  IEmailTransport,
  NormalizedEmailMessage,
  TransportSendResult,
} from '@objectstack/spec/contracts';

const LOCALES = ['en-US', 'zh-CN', 'ja-JP', 'es-ES'] as const;

/** A link whose second query parameter is the one the defect dropped. */
const LINK = 'https://acme.test/api/v1/auth/verify-email?token=TOK123&callbackURL=%2Faccept-invitation%2Finv_1';
/** The same link as HTML markup spells it — correct inside `body_html` only. */
const LINK_AS_MARKUP = 'https://acme.test/api/v1/auth/verify-email?token=TOK123&amp;callbackURL=%2Faccept-invitation%2Finv_1';

class CaptureTransport implements IEmailTransport {
  public sent: NormalizedEmailMessage[] = [];
  async send(message: NormalizedEmailMessage): Promise<TransportSendResult> {
    this.sent.push(message);
    return { messageId: `msg-${this.sent.length}` };
  }
}

/** Exactly what `EmailServicePlugin` seeds, matched on `(name, locale)` with no fallback of its own. */
function seededRow(name: string, locale: string): EmailTemplateRow | null {
  const hit = BUILTIN_AUTH_TEMPLATES.find((t) => t.name === name && t.locale === locale);
  if (!hit) return null;
  return {
    name: hit.name,
    locale: hit.locale ?? 'en-US',
    subject: hit.subject,
    body_html: hit.bodyHtml ?? '',
    body_text: hit.bodyText ?? null,
    active: hit.active !== false,
    variables_json: JSON.stringify(hit.variables ?? []),
  };
}

function harness(extraRows: EmailTemplateRow[] = []) {
  const transport = new CaptureTransport();
  const rows: Array<Record<string, any>> = [];
  const loader: TemplateLoader = {
    async load(name, locale) {
      const authored = extraRows.find((r) => r.name === name && (locale === undefined || r.locale === locale));
      if (authored) return authored;
      return locale === undefined ? null : seededRow(name, locale);
    },
  };
  const svc = new EmailService({
    transport,
    defaultFrom: { address: 'no-reply@acme.test' },
    templateLoader: loader,
    persistence: {
      async insert(row) { rows.push(row); return { id: row.id }; },
      async update() { /* noop */ },
    },
  });
  return { svc, transport, rows };
}

const USER = { name: 'Alice', email: 'alice@acme.test', id: 'usr_1' };

/** The three link-carrying sends the card names, plus the magic link that shares the shape. */
const LINK_SENDS = [
  { template: 'auth.verify_email', data: { user: USER, verificationUrl: LINK, appName: 'Acme' } },
  { template: 'auth.password_reset', data: { user: USER, resetUrl: LINK, expiresInMinutes: 30, appName: 'Acme' } },
  {
    template: 'auth.invitation',
    data: {
      inviter: { name: 'Bob', email: 'bob@acme.test' },
      organization: { name: 'Acme' },
      role: 'member',
      acceptUrl: LINK,
      appName: 'Acme',
    },
  },
  { template: 'auth.magic_link', data: { magicLinkUrl: LINK, expiresInMinutes: 10, appName: 'Acme' } },
] as const;

describe('auth mail: the plain-text part carries the link verbatim', () => {
  for (const { template, data } of LINK_SENDS) {
    for (const locale of LOCALES) {
      it(`${template} [${locale}]: sys_email.body_text and the text part keep a literal &`, async () => {
        const { svc, transport, rows } = harness();

        await svc.sendTemplate({ template, to: 'alice@acme.test', locale, data: data as Record<string, unknown> });

        expect(rows).toHaveLength(1);
        const bodyText = String(rows[0].body_text);
        // The persisted audit row and the delivered text/plain part are the
        // same string, and both carry the link a user can actually follow.
        expect(bodyText).toContain(LINK);
        expect(bodyText).not.toContain('&amp;');
        expect(transport.sent[0].text).toBe(bodyText);
      });

      it(`${template} [${locale}]: the HTML part is unchanged — href verbatim, visible copy still escaped markup`, async () => {
        const { svc, transport } = harness();

        await svc.sendTemplate({ template, to: 'alice@acme.test', locale, data: data as Record<string, unknown> });

        const html = String(transport.sent[0].html);
        // `{{{url}}}` in the href was never escaped …
        expect(html).toContain(`href="${LINK}"`);
        // … and the copy-paste `{{url}}` span is still HTML-escaped, which is
        // correct in markup: a mail client decodes it back to `&` on display.
        expect(html).toContain(LINK_AS_MARKUP);
      });
    }
  }
});

describe('control: a value carrying markup characters, per face', () => {
  it('a built-in template: < and & are escaped in body_html and literal in body_text and the subject', async () => {
    const { svc, transport, rows } = harness();

    await svc.sendTemplate({
      template: 'auth.invitation',
      to: 'alice@acme.test',
      locale: 'en-US',
      data: {
        inviter: { name: "O'Brien", email: 'ob@acme.test' },
        organization: { name: 'R&D <Lab>' },
        role: 'member',
        acceptUrl: LINK,
        appName: 'Acme',
      },
    });

    const sent = transport.sent[0];
    expect(sent.html).toContain('<strong>R&amp;D &lt;Lab&gt;</strong>');
    expect(sent.html).toContain('<strong>O&#39;Brien</strong>');
    expect(sent.text).toBe(
      "O'Brien (ob@acme.test) invited you to join R&D <Lab> on Acme.\n\n" + `Accept: ${LINK}`,
    );
    expect(sent.subject).toBe("O'Brien invited you to R&D <Lab>");
    expect(rows[0].subject).toBe("O'Brien invited you to R&D <Lab>");
  });

  const AUTHORED: EmailTemplateRow = {
    name: 'crm.deal_won',
    locale: 'en-US',
    subject: 'Won: {{deal.name}}',
    body_html: '<p>Deal <b>{{deal.name}}</b> closed. <a href="{{{deal.url}}}">Open</a> {{deal.url}}</p>',
    body_text: 'Deal {{deal.name}} closed. Open: {{deal.url}}',
    active: true,
  };
  const DEAL = { deal: { name: 'Q3 <Renewal> & more', url: 'https://acme.test/deal?id=7&tab=notes' } };

  it('an authored template (no per-template braces): escaped in body_html, literal in body_text and the subject', async () => {
    const { svc, transport, rows } = harness([AUTHORED]);

    await svc.sendTemplate({ template: 'crm.deal_won', to: 'alice@acme.test', data: DEAL });

    const sent = transport.sent[0];
    expect(sent.html).toBe(
      '<p>Deal <b>Q3 &lt;Renewal&gt; &amp; more</b> closed. '
        + '<a href="https://acme.test/deal?id=7&tab=notes">Open</a> https://acme.test/deal?id=7&amp;tab=notes</p>',
    );
    expect(sent.text).toBe('Deal Q3 <Renewal> & more closed. Open: https://acme.test/deal?id=7&tab=notes');
    expect(sent.subject).toBe('Won: Q3 <Renewal> & more');
    expect(rows[0].body_text).toBe(sent.text);
  });

  it('renderTemplate (the render-only face the inbox channel reads) answers the same text and subject', async () => {
    const { svc } = harness([AUTHORED]);

    const out = await svc.renderTemplate({ template: 'crm.deal_won', data: DEAL });

    expect(out.text).toBe('Deal Q3 <Renewal> & more closed. Open: https://acme.test/deal?id=7&tab=notes');
    expect(out.subject).toBe('Won: Q3 <Renewal> & more');
    expect(out.html).toContain('<b>Q3 &lt;Renewal&gt; &amp; more</b>');
  });

  it('a row with NO body_text still derives its text part with the entities decoded', async () => {
    const { svc, transport } = harness([{ ...AUTHORED, body_text: null }]);

    await svc.sendTemplate({ template: 'crm.deal_won', to: 'alice@acme.test', data: DEAL });

    expect(transport.sent[0].text).toBe('Deal Q3 <Renewal> & more closed. Open https://acme.test/deal?id=7&tab=notes');
  });
});
