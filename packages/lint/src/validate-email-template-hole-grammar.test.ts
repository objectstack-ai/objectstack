// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `validateEmailTemplateHoleGrammar` on every authoring door: the three CLI
 * commands, and the runtime publish gate for an `email_template` write.
 *
 * Which holes the grammar refuses is `@objectstack/formula`'s to decide
 * (`judgeMailHoleGrammar`, pinned in its own `template-hole-grammar.test.ts`);
 * this file holds the rule: it reads all three faces of every template,
 * refuses at `error` on every door, names the hole and the rule, and judges a
 * written template on its own.
 */
import { describe, expect, it } from 'vitest';

import { AUTHORING_COMMANDS, AUTHORING_RULES, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import {
  EMAIL_TEMPLATE_HOLE_GRAMMAR,
  validateEmailTemplateHoleGrammar,
} from './validate-email-template-hole-grammar.js';

const template = (over: Record<string, unknown> = {}) => ({
  name: 'contract.overdue',
  label: 'Instalment overdue',
  locale: 'en-US',
  subject: 'Due {{ planned_amount | currency:EUR }}',
  bodyHtml: '<p>{{ planned_amount | currency:EUR }} for <b>{{ contract.name }}</b></p>',
  bodyText: 'Due {{ planned_amount | currency }}',
  ...over,
});

const CURRENCY_PATH = '{{ planned_amount | currency:currency_code }}';
const CHAINED = '{{ actual_amount | default:0 | number:2 }}';

describe('the rule, on the stack', () => {
  it('a template whose every hole is within the grammar draws nothing', () => {
    expect(validateEmailTemplateHoleGrammar({ emailTemplates: [template()] })).toEqual([]);
  });

  it.each(['subject', 'bodyText', 'bodyHtml'])('⭐ refuses a currency path argument in %s, naming the hole and the literal-only rule', (face) => {
    const findings = validateEmailTemplateHoleGrammar({ emailTemplates: [template({ [face]: `Due ${CURRENCY_PATH}` })] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'error', rule: EMAIL_TEMPLATE_HOLE_GRAMMAR, path: `emailTemplates[0].${face}` });
    expect(findings[0].where).toContain('contract.overdue');
    expect(findings[0].message).toContain(CURRENCY_PATH);
    expect(findings[0].message).toContain('ISO 4217');
    expect(findings[0].message).toContain('never read as a path');
  });

  it.each(['subject', 'bodyText', 'bodyHtml'])('⭐ refuses a chained hole in %s, naming the one-formatter rule and the caller remedy', (face) => {
    const findings = validateEmailTemplateHoleGrammar({ emailTemplates: [template({ [face]: `Paid ${CHAINED}` })] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'error', rule: EMAIL_TEMPLATE_HOLE_GRAMMAR, path: `emailTemplates[0].${face}` });
    expect(findings[0].message).toContain(CHAINED);
    expect(findings[0].message).toContain('a hole takes one formatter');
    expect(findings[0].message).toContain('in the caller that supplies the data');
  });

  it('one finding per refused hole, located on its own template and face', () => {
    const findings = validateEmailTemplateHoleGrammar({
      emailTemplates: [
        template(),
        template({ name: 'contract.digest', subject: CURRENCY_PATH, bodyHtml: `<p>${CURRENCY_PATH} ${CURRENCY_PATH}</p>` }),
      ],
    });
    expect(findings.map((f) => f.path)).toEqual([
      'emailTemplates[1].subject',
      'emailTemplates[1].bodyHtml',
      'emailTemplates[1].bodyHtml',
    ]);
  });

  it('a name-keyed collection is located by name; no templates draws nothing', () => {
    const { name: _name, ...rest } = template({ subject: CURRENCY_PATH });
    expect(validateEmailTemplateHoleGrammar({ emailTemplates: { 'contract.overdue': rest } }).map((f) => f.path))
      .toEqual(['emailTemplates.contract.overdue.subject']);
    expect(validateEmailTemplateHoleGrammar({})).toEqual([]);
  });
});

describe('the registry entry', () => {
  const entry = AUTHORING_RULES.find((r) => r.name === 'validateEmailTemplateHoleGrammar');

  it('is gating, on all three commands and the runtime publish gate for email_template writes', () => {
    expect(entry).toMatchObject({
      tier: 'gating',
      commands: [...AUTHORING_COMMANDS],
      surfaces: ['cli', 'runtime-publish'],
      runtimeTypes: ['email_template'],
    });
  });

  it.each([...AUTHORING_COMMANDS])('os %s refuses both holes at error', (command) => {
    const stack = { emailTemplates: [template({ subject: CURRENCY_PATH, bodyText: CHAINED })] };
    const errors = runAuthoringRules(command, { normalized: stack, parsed: stack })
      .filter((f) => f.severity === 'error' && f.rule === EMAIL_TEMPLATE_HOLE_GRAMMAR);
    expect(errors.map((f) => f.path)).toEqual(['emailTemplates[0].subject', 'emailTemplates[0].bodyText']);
  });
});

describe('the runtime publish gate, for an email_template write', () => {
  it('⭐ refuses the written template, located on the written template itself', () => {
    const result = runRuntimeAuthoringRules({ type: 'email_template', item: template({ bodyText: CURRENCY_PATH }) });
    expect(result.rulesRun).toContain('validateEmailTemplateHoleGrammar');
    expect(result.errors.map((f) => [f.rule, f.path])).toEqual([[EMAIL_TEMPLATE_HOLE_GRAMMAR, 'emailTemplates[0].bodyText']]);
  });

  it('publishes a template whose every hole is within the grammar', () => {
    expect(runRuntimeAuthoringRules({ type: 'email_template', item: template() }).errors).toEqual([]);
  });
});
