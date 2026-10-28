// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `validateEmailTemplateHoleGrammar` and `currency:@path`, the mail form that
 * reads the ISO 4217 code from the send's data: accepted on every authoring
 * door when the path is well-formed, refused when the template declares
 * `variables` and none of them declares the path. Everything the rule refused
 * before stays refused (`validate-email-template-hole-grammar.test.ts`).
 */
import { CURRENCY_ARGUMENT_RULE } from '@objectstack/formula';
import { describe, expect, it } from 'vitest';

import { AUTHORING_COMMANDS, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import {
  EMAIL_TEMPLATE_HOLE_GRAMMAR,
  validateEmailTemplateHoleGrammar,
} from './validate-email-template-hole-grammar.js';

const MARKED = '{{ planned_amount | currency:@contract.currency_code }}';

const template = (over: Record<string, unknown> = {}) => ({
  name: 'contract.overdue',
  label: 'Instalment overdue',
  locale: 'en-US',
  subject: `Due ${MARKED}`,
  bodyHtml: `<p>${MARKED} for <b>{{ contract.name }}</b></p>`,
  bodyText: 'Due {{ planned_amount | currency:@currency_code }}',
  ...over,
});

describe('the marked path form', () => {
  it('⭐ a template that declares no variables publishes it in every face', () => {
    expect(validateEmailTemplateHoleGrammar({ emailTemplates: [template()] })).toEqual([]);
  });

  it('a template whose variables declare the path, or a root it lies under, publishes it', () => {
    const variables = [{ name: 'planned_amount' }, { name: 'contract' }, { name: 'currency_code' }];
    expect(validateEmailTemplateHoleGrammar({ emailTemplates: [template({ variables })] })).toEqual([]);
  });

  it.each(['subject', 'bodyText', 'bodyHtml'])('⭐ refuses in %s a path the declared variables do not declare, naming the hole and the rule', (face) => {
    const stack = {
      emailTemplates: [template({
        subject: 'Notice',
        bodyHtml: '<p>Notice</p>',
        bodyText: 'Notice',
        [face]: `Due ${MARKED}`,
        variables: [{ name: 'planned_amount' }, { name: 'currency_code' }],
      })],
    };
    const findings = validateEmailTemplateHoleGrammar(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'error', rule: EMAIL_TEMPLATE_HOLE_GRAMMAR, path: `emailTemplates[0].${face}` });
    expect(findings[0].message).toContain(MARKED);
    expect(findings[0].message).toContain('do not declare');
    expect(findings[0].message).toContain('`contract.currency_code`');
  });

  it.each([
    ['a mark with no path', '{{ amount | currency:@ }}'],
    ['a quoted marked path', "{{ amount | currency:'@currency_code' }}"],
    ['an empty segment', '{{ amount | currency:@a..b }}'],
  ])('refuses %s as before', (_label, hole) => {
    const findings = validateEmailTemplateHoleGrammar({ emailTemplates: [template({ subject: hole })] });
    expect(findings.map((f) => f.path)).toEqual(['emailTemplates[0].subject']);
    expect(findings[0].message).toContain(hole);
  });

  it('the finding\'s hint quotes the argument rule', () => {
    const [finding] = validateEmailTemplateHoleGrammar({ emailTemplates: [template({ subject: '{{ a | currency:currency_code }}' })] });
    expect(finding.hint).toContain(CURRENCY_ARGUMENT_RULE);
  });

  it.each([...AUTHORING_COMMANDS])('os %s accepts the form, and refuses the undeclared path at error', (command) => {
    const accepted = { emailTemplates: [template()] };
    expect(runAuthoringRules(command, { normalized: accepted, parsed: accepted })
      .filter((f) => f.rule === EMAIL_TEMPLATE_HOLE_GRAMMAR)).toEqual([]);
    const refused = { emailTemplates: [template({ variables: [{ name: 'planned_amount' }] })] };
    expect(runAuthoringRules(command, { normalized: refused, parsed: refused })
      .filter((f) => f.severity === 'error' && f.rule === EMAIL_TEMPLATE_HOLE_GRAMMAR)
      .map((f) => f.path)).toEqual(['emailTemplates[0].subject', 'emailTemplates[0].bodyText', 'emailTemplates[0].bodyHtml']);
  });
});

describe('the runtime publish gate, for an email_template write', () => {
  it('⭐ publishes the marked form, and refuses an undeclared path on the written template', () => {
    expect(runRuntimeAuthoringRules({ type: 'email_template', item: template() }).errors).toEqual([]);
    const result = runRuntimeAuthoringRules({
      type: 'email_template',
      item: template({ subject: 'Notice', bodyHtml: '<p>Notice</p>', variables: [{ name: 'planned_amount' }] }),
    });
    expect(result.errors.map((f) => [f.rule, f.path])).toEqual([[EMAIL_TEMPLATE_HOLE_GRAMMAR, 'emailTemplates[0].bodyText']]);
  });
});
