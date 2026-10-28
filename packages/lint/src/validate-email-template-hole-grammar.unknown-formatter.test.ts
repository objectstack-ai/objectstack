// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `email-template-hole-grammar` refuses a hole whose formatter the whitelist
 * (`TEMPLATE_FORMATTERS`) does not name, on every authoring door: the three
 * CLI commands and the runtime publish gate for an `email_template` write.
 * Which names are known is `@objectstack/formula`'s to decide (pinned in its
 * `template-unknown-formatter.test.ts`); this file holds the rule's reading.
 */
import { describe, expect, it } from 'vitest';

import { TEMPLATE_FORMATTERS } from '@objectstack/formula';

import { AUTHORING_COMMANDS, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import {
  EMAIL_TEMPLATE_HOLE_GRAMMAR,
  validateEmailTemplateHoleGrammar,
} from './validate-email-template-hole-grammar.js';

const template = (over: Record<string, unknown> = {}) => ({
  name: 'invoice.due',
  label: 'Invoice due',
  locale: 'en-US',
  subject: 'Due {{ amount | currency:EUR }}',
  bodyHtml: '<p>{{ amount | currency:EUR }} by {{ due | date:long }}</p>',
  bodyText: 'Due {{ due | date:long }}',
  ...over,
});

const MISSPELLED = '{{ amount | curency:EUR }}';

describe('the rule, on the stack', () => {
  it.each(['subject', 'bodyText', 'bodyHtml'])('⭐ refuses a misspelled formatter in %s, naming the hole and the known formatters', (face) => {
    const findings = validateEmailTemplateHoleGrammar({ emailTemplates: [template({ [face]: `Due ${MISSPELLED}` })] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'error', rule: EMAIL_TEMPLATE_HOLE_GRAMMAR, path: `emailTemplates[0].${face}` });
    expect(findings[0].where).toContain('invoice.due');
    expect(findings[0].message).toContain(MISSPELLED);
    expect(findings[0].message).toContain(`Known formatters: ${TEMPLATE_FORMATTERS.join(', ')}.`);
  });

  it('a template whose every formatter is known draws nothing', () => {
    expect(validateEmailTemplateHoleGrammar({ emailTemplates: [template()] })).toEqual([]);
  });

  it.each([...AUTHORING_COMMANDS])('os %s refuses it at error', (command) => {
    const stack = { emailTemplates: [template({ bodyText: 'Due {{ due | dat:long }}' })] };
    const errors = runAuthoringRules(command, { normalized: stack, parsed: stack })
      .filter((f) => f.severity === 'error' && f.rule === EMAIL_TEMPLATE_HOLE_GRAMMAR);
    expect(errors.map((f) => f.path)).toEqual(['emailTemplates[0].bodyText']);
  });
});

describe('the runtime publish gate, for an email_template write', () => {
  it('⭐ refuses the written template, located on the written template itself', () => {
    const result = runRuntimeAuthoringRules({ type: 'email_template', item: template({ subject: MISSPELLED }) });
    expect(result.rulesRun).toContain('validateEmailTemplateHoleGrammar');
    expect(result.errors.map((f) => [f.rule, f.path])).toEqual([[EMAIL_TEMPLATE_HOLE_GRAMMAR, 'emailTemplates[0].subject']]);
  });
});
