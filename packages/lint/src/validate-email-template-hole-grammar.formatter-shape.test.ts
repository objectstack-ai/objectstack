// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `email-template-hole-grammar` refuses a hole whose text after the `|` is not
 * a formatter name (`{{ due | date-long }}`, `{{ x | two words }}`), on every
 * authoring door: the three CLI commands and the runtime publish gate for an
 * `email_template` write. Which formatter parts are accepted is
 * `@objectstack/formula`'s to decide, the same for both template dialects
 * (pinned in its `template-formatter-shape.test.ts`); this file holds the
 * rule's reading.
 */
import { describe, expect, it } from 'vitest';

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
  subject: 'Due {{ amount | currency :EUR }}',
  bodyHtml: '<p>{{ amount | currency:EUR }} by {{ due | date:long }}</p>',
  bodyText: "Due {{ due | date :long }}, {{ note | default:it's }}",
  ...over,
});

const MISSHAPEN = '{{ due | date-long }}';

describe('the rule, on the stack', () => {
  it.each(['subject', 'bodyText', 'bodyHtml'])('⭐ refuses a formatter part that is not a formatter name in %s, naming the hole and the shape', (face) => {
    const findings = validateEmailTemplateHoleGrammar({ emailTemplates: [template({ [face]: `Due ${MISSHAPEN}` })] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'error', rule: EMAIL_TEMPLATE_HOLE_GRAMMAR, path: `emailTemplates[0].${face}` });
    expect(findings[0].where).toContain('invoice.due');
    expect(findings[0].message).toContain(MISSHAPEN);
    expect(findings[0].message).toContain('a formatter is one word, optionally followed by `:` and its argument');
  });

  it('a template whose every formatter part the in-app dialect accepts draws nothing', () => {
    expect(validateEmailTemplateHoleGrammar({ emailTemplates: [template()] })).toEqual([]);
  });

  it('brace text whose part before any `|` is not a path is the template\'s own text, and draws nothing', () => {
    expect(validateEmailTemplateHoleGrammar({ emailTemplates: [template({ bodyText: '{{ not a path }} {{ | upper }} {{}}' })] }))
      .toEqual([]);
  });

  it.each([...AUTHORING_COMMANDS])('os %s refuses it at error', (command) => {
    const stack = { emailTemplates: [template({ bodyText: 'Due {{ x | two words }}' })] };
    const errors = runAuthoringRules(command, { normalized: stack, parsed: stack })
      .filter((f) => f.severity === 'error' && f.rule === EMAIL_TEMPLATE_HOLE_GRAMMAR);
    expect(errors.map((f) => f.path)).toEqual(['emailTemplates[0].bodyText']);
  });
});

describe('the runtime publish gate, for an email_template write', () => {
  it('⭐ refuses the written template, located on the written template itself', () => {
    const result = runRuntimeAuthoringRules({ type: 'email_template', item: template({ subject: MISSHAPEN }) });
    expect(result.rulesRun).toContain('validateEmailTemplateHoleGrammar');
    expect(result.errors.map((f) => [f.rule, f.path])).toEqual([[EMAIL_TEMPLATE_HOLE_GRAMMAR, 'emailTemplates[0].subject']]);
  });
});
