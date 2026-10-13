// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6/D10, ruling C] The pin of `emailTemplateDefinitionFromRow` — the
 * mapping the upgrade ceremony applies to promote a customized
 * `sys_email_template` row to an environment `email_template` item through the
 * metadata door. The expected bodies are the outputs the module doc states,
 * written out by hand; the schema is read only to hold the body to it.
 */

import { describe, expect, it } from 'vitest';
import { EmailTemplateDefinitionSchema } from '@objectstack/spec/system';
import { emailTemplateDefinitionFromRow } from './email-template-row-definition.js';

/** A row as `sys_email_template` stores it, its state and provenance riding along. */
const storedRow = {
  id: 'tpl_01',
  name: 'crm.welcome',
  label: 'Welcome',
  category: 'notification',
  locale: 'zh-CN',
  description: 'Sent on sign-up',
  subject: 'Welcome, {{user.name}}',
  body_html: '<p>Hello {{user.name}}</p>',
  body_text: 'Hello {{user.name}}',
  from_name: 'Acme Support',
  from_address: 'support@acme.test',
  reply_to: 'help@acme.test',
  active: 0,
  is_system: 1,
  variables_json: '[{"name":"user.name","type":"string","required":true}]',
  managed_by: 'package',
  customized: 1,
  organization_id: 'org_1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
};

const schemaKeys = (): Set<string> =>
  new Set(Object.keys((EmailTemplateDefinitionSchema as unknown as { shape: Record<string, unknown> }).shape));

describe('emailTemplateDefinitionFromRow', () => {
  it('answers the definition the row carries, in order, with no state or provenance column', () => {
    expect(emailTemplateDefinitionFromRow(storedRow)).toStrictEqual({
      name: 'crm.welcome',
      label: 'Welcome',
      locale: 'zh-CN',
      subject: 'Welcome, {{user.name}}',
      bodyHtml: '<p>Hello {{user.name}}</p>',
      bodyText: 'Hello {{user.name}}',
      variables: [{ name: 'user.name', type: 'string', required: true }],
      fromOverride: { name: 'Acme Support', address: 'support@acme.test' },
      replyTo: 'help@acme.test',
      active: false,
      description: 'Sent on sign-up',
    });
  });

  it('answers a body the email_template schema accepts whole, with no key the schema does not declare', () => {
    const body = emailTemplateDefinitionFromRow(storedRow);
    const keys = schemaKeys();
    expect(Object.keys(body).filter((k) => !keys.has(k))).toEqual([]);
    expect(EmailTemplateDefinitionSchema.safeParse(body).success).toBe(true);
  });

  it('falls back for the sparse row: label to name, locale to en-US, bodies to empty, active to true', () => {
    const body = emailTemplateDefinitionFromRow({
      name: 'auth.reset',
      label: '',
      locale: null,
      subject: null,
      body_html: null,
      body_text: '',
      from_name: 'Nobody',
      from_address: '',
      reply_to: null,
      variables_json: 'not json',
      description: null,
    });
    expect(body).toStrictEqual({
      name: 'auth.reset',
      label: 'auth.reset',
      locale: 'en-US',
      subject: '',
      bodyHtml: '',
      variables: [],
      active: true,
    });
    expect(EmailTemplateDefinitionSchema.safeParse(body).success).toBe(true);
  });

  it('reads active the way the stored spellings mean it, and variables already parsed', () => {
    for (const off of [false, 0, '0', 'false']) {
      expect(emailTemplateDefinitionFromRow({ name: 'a', active: off }).active).toBe(false);
    }
    for (const on of [true, 1, '1', 'true', undefined, null]) {
      expect(emailTemplateDefinitionFromRow({ name: 'a', active: on }).active).toBe(true);
    }
    expect(emailTemplateDefinitionFromRow({ name: 'a', variables_json: [{ name: 'x' }] }).variables).toEqual([{ name: 'x' }]);
    expect(emailTemplateDefinitionFromRow({ name: 'a', variables_json: '{"name":"x"}' }).variables).toEqual([]);
  });

  it('is deterministic: the same row answers the same serialization', () => {
    expect(JSON.stringify(emailTemplateDefinitionFromRow({ ...storedRow }))).toBe(
      JSON.stringify(emailTemplateDefinitionFromRow(storedRow)),
    );
  });
});
