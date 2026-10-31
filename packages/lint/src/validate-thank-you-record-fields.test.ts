// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Ruling B on #28005: a form's thank-you panel may name, as
// `{{record.field_name}}`, only a field the engine generates on insert
// (`RUNTIME_OWNED_FIELD_TYPES`). Pins the stack rule the three CLI commands run,
// the runtime publish gate on `view` and `page` writes, and that the admitted
// set is the spec's one set and no list of this rule's own.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { RUNTIME_OWNED_FIELD_TYPES } from '@objectstack/spec/data';

import { AUTHORING_RULES } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { THANK_YOU_RECORD_FIELD, validateThankYouRecordFields } from './validate-thank-you-record-fields.js';

const support = {
  name: 'support_case',
  label: 'Support case',
  fields: {
    case_number: { type: 'autonumber', label: 'Case number', autonumberFormat: 'CASE-{0000}' },
    subject: { type: 'text', label: 'Subject' },
    priority_score: { type: 'formula', label: 'Priority score', expression: '1' },
  },
};

const panel = (message: string) => ({ kind: 'thank-you', title: 'Thank you', message });

const formOf = (message: string) => ({
  type: 'simple',
  data: { provider: 'object', object: 'support_case' },
  sections: [{ name: 'about', fields: ['subject'] }],
  submitBehavior: panel(message),
});

const stackOf = (view: Record<string, unknown>, objects: unknown = [support]) => ({ objects, views: [view] });

describe('validateThankYouRecordFields — the stack rule the CLI commands run', () => {
  it('admits an autonumber field', () => {
    expect(validateThankYouRecordFields(stackOf({
      name: 'case_views',
      form: formOf('Your case number is {{record.case_number}}.'),
    }))).toEqual([]);
  });

  it('refuses a text field, naming the field, its type and the reason', () => {
    const findings = validateThankYouRecordFields(stackOf({
      name: 'case_views',
      formViews: { intake: formOf('We got {{record.subject}} as {{record.case_number}}') },
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: THANK_YOU_RECORD_FIELD,
      where: 'view "case_views" · formViews.intake',
      path: 'views[0].formViews.intake.submitBehavior',
    });
    expect(findings[0].message).toContain('{{record.subject}}');
    expect(findings[0].message).toContain('a text field');
    expect(findings[0].message).toContain('hook');
  });

  it('refuses a formula field the same way', () => {
    const findings = validateThankYouRecordFields(stackOf({ name: 'v', form: formOf('{{record.priority_score}}') }));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('{{record.priority_score}}');
    expect(findings[0].message).toContain('a formula field');
  });

  it('refuses a name the object does not declare, and an injected system column', () => {
    const findings = validateThankYouRecordFields(stackOf({
      name: 'v',
      form: formOf('{{record.no_such_field}} {{record.created_at}} {{record.id}}'),
    }));
    expect(findings.map((f) => f.message.match(/is (.*?)\. A thank-you/)?.[1])).toEqual([
      'not a field the object declares',
      expect.stringContaining('a system column'),
      expect.stringContaining('a system column'),
    ]);
  });

  it('reads the title as well as the message, each name once', () => {
    const form = formOf('{{record.subject}}');
    (form.submitBehavior as Record<string, unknown>).title = 'Re: {{record.subject}}';
    expect(validateThankYouRecordFields(stackOf({ name: 'v', form }))).toHaveLength(1);
  });

  it('judges every form shape a view carries, public or not', () => {
    const bad = formOf('{{record.subject}}');
    expect(validateThankYouRecordFields(stackOf({ name: 'v', viewKind: 'form', config: bad })).map((f) => f.path))
      .toEqual(['views[0].config.submitBehavior']);
    expect(validateThankYouRecordFields(stackOf({ name: 'v', ...bad })).map((f) => f.path))
      .toEqual(['views[0].submitBehavior']);
    const open = { ...bad, sharing: { enabled: true, allowAnonymous: true, publicLink: '/forms/case' } };
    expect(validateThankYouRecordFields(stackOf({ name: 'v', form: open }))).toHaveLength(1);
  });

  it('resolves the object from the view when the form names none', () => {
    const form: Record<string, unknown> = formOf('{{record.subject}}');
    delete form.data;
    expect(validateThankYouRecordFields(stackOf({ name: 'v', object: 'support_case', form }))).toHaveLength(1);
  });

  it('reads an object whose fields are a list', () => {
    const object = { name: 'support_case', fields: [{ name: 'subject', type: 'text' }] };
    expect(validateThankYouRecordFields(stackOf({ name: 'v', form: formOf('{{record.subject}}') }, [object])))
      .toHaveLength(1);
  });

  it('does not judge a panel with no token, another kind, or an object outside the stack', () => {
    expect(validateThankYouRecordFields(stackOf({ name: 'v', form: formOf('Thanks!') }))).toEqual([]);
    const redirect = { ...formOf(''), submitBehavior: { kind: 'redirect', url: '/t/{{record.subject}}' } };
    expect(validateThankYouRecordFields(stackOf({ name: 'v', form: redirect }))).toEqual([]);
    expect(validateThankYouRecordFields(stackOf({ name: 'v', form: formOf('{{record.subject}}') }, []))).toEqual([]);
  });

  it('judges a page object-form panel against its objectName', () => {
    const page = {
      name: 'case_page',
      type: 'app',
      regions: [{
        name: 'main',
        components: [{
          id: 'intake',
          type: 'object-form',
          properties: { objectName: 'support_case', mode: 'create', submitBehavior: panel('{{record.subject}}') },
        }],
      }],
    };
    const findings = validateThankYouRecordFields({ objects: [support], pages: [page] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      where: 'page "case_page" · object-form "intake"',
      path: 'pages[0].regions[0].components[0].properties.submitBehavior',
    });
    const ok = structuredClone(page);
    ok.regions[0].components[0].properties.submitBehavior = panel('{{record.case_number}}');
    expect(validateThankYouRecordFields({ objects: [support], pages: [ok] })).toEqual([]);
  });

  it('is registered gating, on all three commands and on the publish gate for view and page writes', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateThankYouRecordFields');
    expect(entry).toMatchObject({
      tier: 'gating',
      commands: ['validate', 'build', 'lint'],
      surfaces: ['cli', 'runtime-publish'],
      runtimeTypes: ['view', 'page'],
    });
  });
});

describe('the admitted set is RUNTIME_OWNED_FIELD_TYPES, the one source', () => {
  it('in production it is the spec set itself', () => {
    expect([...RUNTIME_OWNED_FIELD_TYPES]).toContain('autonumber');
    const stack = stackOf({ name: 'v', form: formOf('{{record.case_number}}') });
    expect(validateThankYouRecordFields(stack)).toEqual(validateThankYouRecordFields(stack, RUNTIME_OWNED_FIELD_TYPES));
  });

  it('widening the set (a test double) admits the new type with no other edit', () => {
    const stack = stackOf({ name: 'v', form: formOf('{{record.priority_score}}') });
    expect(validateThankYouRecordFields(stack)).toHaveLength(1);
    const widened = new Set([...RUNTIME_OWNED_FIELD_TYPES, 'formula']);
    expect(validateThankYouRecordFields(stack, widened)).toEqual([]);
  });

  it('the rule source spells no field type of its own', () => {
    const source = readFileSync(new URL('./validate-thank-you-record-fields.ts', import.meta.url), 'utf8');
    expect(source).toContain("import { RUNTIME_OWNED_FIELD_TYPES } from '@objectstack/spec/data';");
    expect(source).toMatch(/thankYouRecordFieldNames \} from '@objectstack\/spec\/ui'/);
    expect(source).not.toMatch(/'autonumber'|"autonumber"/);
  });
});

describe('the runtime publish gate', () => {
  it('refuses a view write naming a text field, resolving the type from the objects context', () => {
    const { errors } = runRuntimeAuthoringRules({
      type: 'view',
      item: { name: 'case_views', form: formOf('{{record.subject}}') },
      context: { objects: [support] },
    });
    const finding = errors.find((e) => e.rule === THANK_YOU_RECORD_FIELD);
    expect(finding, JSON.stringify(errors)).toBeDefined();
    expect(finding!.path).toContain('form.submitBehavior');
  });

  it('admits the same view naming the autonumber field', () => {
    const { errors } = runRuntimeAuthoringRules({
      type: 'view',
      item: { name: 'case_views', form: formOf('{{record.case_number}}') },
      context: { objects: [support] },
    });
    expect(errors.filter((e) => e.rule === THANK_YOU_RECORD_FIELD)).toEqual([]);
  });
});
