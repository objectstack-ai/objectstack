// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `validateEmailTemplateDefaultArguments`: a `default` argument that reads
 * like a variable path is literal text, and the rule says so (ruling record
 * 6845318122, letter B). The renderer half — that the argument really prints
 * literally — is pinned beside the trap in `@objectstack/formula`'s
 * `template-hole-grammar.test.ts` (`default:currency_code` judges nothing) and
 * here once, end to end, through the shared `default` formatter.
 */
import { describe, expect, it } from 'vitest';

import { formatValue } from '@objectstack/formula';

import { AUTHORING_COMMANDS, AUTHORING_RULES, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import {
  EMAIL_TEMPLATE_DEFAULT_READS_AS_PATH,
  validateEmailTemplateDefaultArguments,
} from './validate-email-template-default-arguments.js';

const template = (over: Record<string, unknown> = {}) => ({
  name: 'crm.welcome',
  label: 'Welcome',
  locale: 'en-US',
  subject: 'Welcome, {{ person_name | default:\'Customer\' }}',
  bodyText: 'Hello {{ first_name }}, your number is {{ count | default:0 }}.',
  ...over,
});

const run = (over: Record<string, unknown> = {}) =>
  validateEmailTemplateDefaultArguments({ emailTemplates: [template(over)] });

describe('the trap the rule names', () => {
  it('the `default` formatter prints its argument as written — it never reads a variable of that name', () => {
    expect(formatValue('default', '', 'first_name')).toBe('first_name');
    expect(formatValue('default', 'Ada', 'first_name')).toBe('Ada');
  });
});

describe('the rule, on the stack', () => {
  it('quoted literals, plain words and numbers draw nothing', () => {
    expect(run()).toEqual([]);
    expect(run({ bodyText: '{{ person_name | default:Customer }} {{ n | default:none }} {{ x | default:N/A }}' })).toEqual([]);
    expect(run({ bodyText: '{{ person_name | default:\'first_name\' }} {{ x | default:"contact.name" }}' })).toEqual([]);
  });

  it.each([
    ['a snake_case name', '{{ person_name | default:first_name }}', 'first_name', 'snake_case'],
    ['a dotted path', '{{ person_name | default:contact.name }}', 'contact.name', 'dotted variable path'],
    ['an @-marked path', '{{ person_name | default:@first_name }}', '@first_name', '`@`-marked path'],
    ['a name another hole of the template uses', '{{ nickname | default:name }} / {{ name }}', 'name', 'a variable this template uses'],
  ])('⭐ warns on %s, naming the hole, the literal and the flow remedy', (_label, bodyText, arg, shape) => {
    const findings = run({ bodyText });
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.severity).toBe('warning');
    expect(f.rule).toBe(EMAIL_TEMPLATE_DEFAULT_READS_AS_PATH);
    expect(f.path).toBe('emailTemplates[0].bodyText');
    expect(f.where).toBe('email template "crm.welcome" [en-US]');
    expect(f.message).toContain(`'${arg}'`);
    expect(f.message).toContain(shape);
    expect(f.hint).toContain('A default is literal text; to read another variable, compute it in the flow');
  });

  it('a plain word the template declares as a variable warns too', () => {
    const findings = run({ bodyText: '{{ nickname | default:name }}', variables: [{ name: 'name' }] });
    expect(findings.map((f) => f.rule)).toEqual([EMAIL_TEMPLATE_DEFAULT_READS_AS_PATH]);
  });

  it('judges every face, in face order', () => {
    const hole = '{{ person_name | default:first_name }}';
    const findings = run({ subject: hole, bodyText: hole, bodyHtml: `<p>${hole}</p>` });
    expect(findings.map((f) => f.path)).toEqual([
      'emailTemplates[0].subject',
      'emailTemplates[0].bodyText',
      'emailTemplates[0].bodyHtml',
    ]);
  });

  it('leaves a hole the grammar refuses to `email-template-hole-grammar`', () => {
    expect(run({ bodyText: '{{ x | default:first_name | upper }}' })).toEqual([]);
  });

  it('is silent on a stack with no email templates, and on malformed entries', () => {
    expect(validateEmailTemplateDefaultArguments({})).toEqual([]);
    expect(validateEmailTemplateDefaultArguments({ emailTemplates: [null, 3, { bodyText: 7 }] as never })).toEqual([]);
  });
});

describe('the doors', () => {
  const stack = { emailTemplates: [template({ bodyText: '{{ person_name | default:first_name }}' })] };

  it('is an advisory entry on every command and on the publish door for email_template', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateEmailTemplateDefaultArguments');
    expect(entry?.tier).toBe('advisory');
    expect(entry?.surfaces).toEqual(['cli', 'runtime-publish']);
    expect(entry?.runtimeTypes).toEqual(['email_template']);
  });

  it.each(AUTHORING_COMMANDS)('`os %s` advises it as a warning', (command) => {
    const findings = runAuthoringRules(command, { normalized: stack, parsed: stack })
      .filter((f) => f.rule === EMAIL_TEMPLATE_DEFAULT_READS_AS_PATH);
    expect(findings.map((f) => [f.severity, f.path])).toEqual([['warning', 'emailTemplates[0].bodyText']]);
  });

  it('the publish door carries it as an advisory and refuses nothing', () => {
    const result = runRuntimeAuthoringRules({
      type: 'email_template',
      item: template({ bodyText: '{{ person_name | default:first_name }}' }),
    });
    expect(result.rulesRun).toContain('validateEmailTemplateDefaultArguments');
    expect(result.errors).toEqual([]);
    expect(result.advisories.filter((f) => f.rule === EMAIL_TEMPLATE_DEFAULT_READS_AS_PATH).map((f) => f.severity))
      .toEqual(['warning']);
  });
});
