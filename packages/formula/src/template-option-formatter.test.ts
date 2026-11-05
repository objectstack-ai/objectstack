// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `option:object.field` — a mail template prints a select value as its
 * option's label in the recipient's language (`OPTION_ARGUMENT_RULE`). The
 * argument is the bare `object.field` the value belongs to; the mail renderer
 * builds the label table for it per send and hands it to `formatValue`.
 *
 * The mail dialect admits the formatter; the in-app dialect (flow notice
 * `title` / `message`, action and bulk-action `confirmText`) refuses it as a
 * formatter it does not know (`known-formatter`), as it refuses
 * `currency:@path` by name: an in-app slot has no label table.
 */
import { EmailTemplateDefinitionSchema } from '@objectstack/spec/system';
import { describe, expect, it } from 'vitest';

import { judgeMailHoleGrammar, parseMailHole } from './mail-hole-grammar';
import {
  formatValue,
  judgeHoleFormatter,
  MAIL_TEMPLATE_FORMATTERS,
  OPTION_ARGUMENT_RULE,
  optionFieldReference,
  TEMPLATE_FORMATTERS,
  templateEngine,
} from './template-engine';
import { validateExpression } from './validate';

const HOLE = '{{ stage | option:opportunity.stage }}';

describe('the formatter lists', () => {
  it('⭐ a mail template names every in-app formatter and `option`; an in-app slot does not name `option`', () => {
    expect(MAIL_TEMPLATE_FORMATTERS).toEqual([...TEMPLATE_FORMATTERS, 'option']);
    expect(TEMPLATE_FORMATTERS).not.toContain('option');
  });
});

describe('the argument', () => {
  it.each([
    ['option:opportunity.stage', { object: 'opportunity', field: 'stage' }],
    ['option: crm_opportunity.stage_2', { object: 'crm_opportunity', field: 'stage_2' }],
  ])('reads %s as an object and a field', (part, ref) => {
    expect(optionFieldReference(part)).toEqual(ref);
  });

  it.each([
    ['no argument', 'option'],
    ['an empty argument', 'option:'],
    ['a field with no object', 'option:stage'],
    ['a quoted reference', "option:'opportunity.stage'"],
    ['a double-quoted reference', 'option:"opportunity.stage"'],
    ['a marked path', 'option:@stage_ref'],
    ['a marked reference', 'option:@opportunity.stage'],
    ['a second dot', 'option:crm.opportunity.stage'],
    ['an empty object', 'option:.stage'],
    ['an empty field', 'option:opportunity.'],
    ['a space inside', 'option:opportunity. stage'],
    ['another formatter', 'default:opportunity.stage'],
  ])('reads %s as no reference', (_label, part) => {
    expect(optionFieldReference(part)).toBeUndefined();
  });
});

describe('the mail dialect', () => {
  it('⭐ admits option:object.field and parses the reference the renderer labels with', () => {
    expect(judgeHoleFormatter(HOLE, 'option:opportunity.stage', 'option', 'opportunity.stage', 'mail')).toBeNull();
    expect(parseMailHole(' stage | option:opportunity.stage ')).toEqual({
      path: 'stage',
      formatter: 'option',
      arg: 'opportunity.stage',
      optionField: { object: 'opportunity', field: 'stage' },
    });
    expect(judgeMailHoleGrammar(`Stalled at ${HOLE}`)).toEqual([]);
    expect(judgeMailHoleGrammar(`Stalled at {{{ deal.stage | option:opportunity.stage }}}`)).toEqual([]);
  });

  it.each([
    ['no argument', '{{ stage | option }}', 'names no object and field after `option`'],
    ['an empty argument', '{{ stage | option: }}', 'names no object and field after `option`'],
    ['a field with no object', '{{ stage | option:stage }}', "the argument 'stage'"],
    ['a quoted reference', "{{ stage | option:'opportunity.stage' }}", "the argument ''opportunity.stage''"],
    ['a marked path', '{{ stage | option:@stage_ref }}', "the argument '@stage_ref'"],
    ['a second dot', '{{ stage | option:crm.opportunity.stage }}', "the argument 'crm.opportunity.stage'"],
  ])('⭐ refuses %s, naming the hole, the argument and the rule', (_label, hole, says) => {
    const findings = judgeMailHoleGrammar(`Stalled at ${hole}`);
    expect(findings).toHaveLength(1);
    expect(findings[0].text).toBe(hole);
    expect(findings[0].refusal.rule).toBe('option-field-shape');
    expect(findings[0].refusal.message).toContain(hole);
    expect(findings[0].refusal.message).toContain(says);
    expect(findings[0].refusal.message).toContain(OPTION_ARGUMENT_RULE);
    expect(parseMailHole(hole.slice(2, -2), hole)?.optionField).toBeUndefined();
  });

  it('lists `option` among the known formatters when it refuses a misspelled one', () => {
    const refusal = judgeHoleFormatter('{{ x | optoin }}', 'optoin', 'optoin', undefined, 'mail');
    expect(refusal?.rule).toBe('known-formatter');
    expect(refusal?.message).toContain(`Known formatters: ${MAIL_TEMPLATE_FORMATTERS.join(', ')}.`);
  });
});

describe('the object and field, judged against the app\'s objects', () => {
  const objects = new Map([
    ['opportunity', new Map([['stage', true], ['name', false]])],
  ]);

  it('⭐ admits a field that declares options', () => {
    expect(judgeMailHoleGrammar(`At ${HOLE}`, { objects })).toEqual([]);
  });

  it.each([
    ['an object the app does not have', '{{ stage | option:deal.stage }}', 'option-object-unknown', 'the object `deal`'],
    ['a field the object does not have', '{{ stage | option:opportunity.phase }}', 'option-field-unknown', 'the field `phase`'],
    ['a field with no options', '{{ stage | option:opportunity.name }}', 'option-field-no-options', '`opportunity.name`, which declares no options'],
  ])('⭐ refuses %s, naming the hole and what to fix', (_label, hole, rule, says) => {
    const findings = judgeMailHoleGrammar(`At ${hole}`, { objects });
    expect(findings.map((f) => [f.text, f.start, f.refusal.rule])).toEqual([[hole, 3, rule]]);
    expect(findings[0].refusal.message).toContain(hole);
    expect(findings[0].refusal.message).toContain(says);
    expect(findings[0].refusal.message).toContain(OPTION_ARGUMENT_RULE);
  });

  it('judges no reference when no objects are handed in', () => {
    expect(judgeMailHoleGrammar('At {{ stage | option:deal.stage }}')).toEqual([]);
  });
});

describe('the in-app dialect refuses it as a formatter it does not know', () => {
  it('the judge refuses it by default, listing the in-app formatters', () => {
    const refusal = judgeHoleFormatter(HOLE, 'option:opportunity.stage', 'option', 'opportunity.stage');
    expect(refusal?.rule).toBe('known-formatter');
    expect(refusal?.message).toContain("names the formatter 'option', which is not a template formatter");
    expect(refusal?.message).toContain('formats only in a mail template');
    expect(refusal?.message).toContain(`Known formatters: ${TEMPLATE_FORMATTERS.join(', ')}.`);
  });

  it.each([
    ['a notice title', 'Deal stalled at {{ record.stage | option:opportunity.stage }}'],
    ['a notice message', 'Stage: {{ record.stage | option:opportunity.stage }}'],
    ['a confirm sentence', 'Move {{ record.name }} out of {{ record.stage | option:opportunity.stage }}?'],
  ])('⭐ compile, the authoring validator and evaluate all refuse it in %s — never a label nor the stored value', (_slot, source) => {
    const compiled = templateEngine.compile(source);
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) {
      expect(compiled.error.kind).toBe('parse');
      expect(compiled.error.message).toContain('{{ record.stage | option:opportunity.stage }}');
      expect(compiled.error.message).toContain('formats only in a mail template');
    }
    const validated = validateExpression('template', { dialect: 'template', source });
    expect(validated.errors.map((e) => e.code)).toEqual(['invalid-template']);
    const evaluated = templateEngine.evaluate<string>(
      { dialect: 'template', source },
      { record: { name: 'Acme', stage: 'needs_analysis' }, locale: 'en-US' },
    );
    expect(evaluated.ok).toBe(false);
  });
});

describe('the formatter, given the label table the mail renderer builds', () => {
  const en = { 'opportunity.stage': { needs_analysis: 'Needs Analysis', closed_won: 'Closed Won' } };
  const zh = { 'opportunity.stage': { needs_analysis: '需求分析', closed_won: '赢单' } };

  it('⭐ prints the label of the value in the table it is handed — one table per recipient locale', () => {
    expect(formatValue('option', 'needs_analysis', 'opportunity.stage', { locale: 'en-US', optionLabels: en }))
      .toBe('Needs Analysis');
    expect(formatValue('option', 'needs_analysis', 'opportunity.stage', { locale: 'zh-CN', optionLabels: zh }))
      .toBe('需求分析');
  });

  it('prints a value outside the options as stored', () => {
    expect(formatValue('option', 'lost_to_rival', 'opportunity.stage', { optionLabels: en })).toBe('lost_to_rival');
    expect(formatValue('option', 'toString', 'opportunity.stage', { optionLabels: en })).toBe('toString');
  });

  it('labels each value of a multi-select, joined with a comma', () => {
    expect(formatValue('option', ['closed_won', 'needs_analysis', 'other'], 'opportunity.stage', { optionLabels: en }))
      .toBe('Closed Won, Needs Analysis, other');
  });

  it('prints a missing value as empty, never as `undefined`', () => {
    expect(formatValue('option', undefined, 'opportunity.stage', { optionLabels: en })).toBe('');
    expect(formatValue('option', null, 'opportunity.stage', { optionLabels: en })).toBe('');
  });

  it('⭐ with no table for the field — none handed in, or one for another field — prints the value as stored', () => {
    expect(formatValue('option', 'needs_analysis', 'opportunity.stage', { locale: 'zh-CN' })).toBe('needs_analysis');
    expect(formatValue('option', 'needs_analysis', 'opportunity.stage', { optionLabels: { 'lead.status': {} } }))
      .toBe('needs_analysis');
  });
});

describe('the spec states the same rule', () => {
  it.each(['subject', 'bodyHtml', 'bodyText'] as const)('the email_template %s description quotes OPTION_ARGUMENT_RULE', (face) => {
    expect(EmailTemplateDefinitionSchema.shape[face].description).toContain(OPTION_ARGUMENT_RULE);
  });
});
