// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `validateEmailTemplateHoleGrammar` and `option:object.field`, the mail
 * formatter that prints a select value as its option's label in the
 * recipient's language: accepted on every authoring door when the argument
 * names an object the app has and a field on it that declares options, and
 * refused, naming the hole and what to fix, when it names an object the app
 * does not have, a field that object does not have, a field with no options,
 * or is not a bare `object.field`.
 *
 * In-app template text refuses `option` as a formatter it does not know: the
 * flow notice `title` / `message` and an action's `confirmText` are pinned at
 * the end, through the doors that judge them.
 */
import { OPTION_ARGUMENT_RULE } from '@objectstack/formula';
import { normalizeStackInput, ObjectStackDefinitionSchema } from '@objectstack/spec';
import { describe, expect, it } from 'vitest';

import { AUTHORING_COMMANDS, EXPRESSION_INVALID, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { validateStackExpressions } from './validate-expressions.js';
import {
  EMAIL_TEMPLATE_HOLE_GRAMMAR,
  validateEmailTemplateHoleGrammar,
} from './validate-email-template-hole-grammar.js';

const HOLE = '{{ stage | option:opportunity.stage }}';

const opportunity = {
  name: 'opportunity',
  label: 'Opportunity',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: {
      type: 'select',
      label: 'Stage',
      options: [
        { value: 'needs_analysis', label: 'Needs Analysis' },
        { value: 'closed_won', label: 'Closed Won' },
      ],
    },
    kind: { type: 'select', label: 'Kind', picklist: 'opportunity_kinds' },
  },
};

const template = (over: Record<string, unknown> = {}) => ({
  name: 'deal.stalled',
  label: 'Deal stalled',
  locale: 'en-US',
  subject: `Stalled at ${HOLE}`,
  bodyHtml: `<p>{{ name }} is at <b>${HOLE}</b></p>`,
  bodyText: `{{ name }} is at ${HOLE}`,
  ...over,
});

const stackWith = (tpl: Record<string, unknown>, objects: unknown[] = [opportunity]) => ({
  objects,
  emailTemplates: [tpl],
});

const onlySubject = (subject: string) => template({ subject, bodyHtml: '<p>Stalled</p>', bodyText: 'Stalled' });

describe('a reference that names an option list', () => {
  it('⭐ a select field the app declares publishes in every face', () => {
    expect(validateEmailTemplateHoleGrammar(stackWith(template()))).toEqual([]);
  });

  it('a field whose options are declared by a picklist name publishes too, as the registry serves it', () => {
    expect(validateEmailTemplateHoleGrammar(stackWith(onlySubject('{{ kind | option:opportunity.kind }}')))).toEqual([]);
  });

  it('a select field another package adds through objectExtensions publishes too', () => {
    const stack = {
      ...stackWith(onlySubject('{{ tier | option:opportunity.tier }}')),
      objectExtensions: [{
        extend: 'opportunity',
        fields: { tier: { type: 'select', label: 'Tier', options: [{ value: 'gold', label: 'Gold' }] } },
      }],
    };
    expect(validateEmailTemplateHoleGrammar(stack)).toEqual([]);
  });

  it('⭐ an object a sibling package of the artifact provides publishes, its fields judged', () => {
    const tpl = onlySubject('{{ stage | option:opportunity.stage }} / {{ name | option:opportunity.name }}');
    const perPackage = { emailTemplates: [tpl], packages: [{ manifest: { emailTemplates: [tpl] } }, { manifest: { objects: [opportunity] } }] };
    expect(validateEmailTemplateHoleGrammar(perPackage).map((f) => f.message))
      .toEqual([expect.stringContaining('names the field `opportunity.name`, which declares no options')]);
  });

  it('⭐ a platform-provided object the stack does not carry resolves, its field left to the publish door and the send', () => {
    expect(validateEmailTemplateHoleGrammar(stackWith(onlySubject('{{ status | option:sys_user.status }}')))).toEqual([]);
  });

  it('⭐ a platform-prefixed object no known package registers is advised at warning, not refused (ladder rung ④)', () => {
    const findings = validateEmailTemplateHoleGrammar(stackWith(onlySubject('Stalled at {{ status | option:sys_userz.status }}')));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'warning', rule: EMAIL_TEMPLATE_HOLE_GRAMMAR, path: 'emailTemplates[0].subject' });
    expect(findings[0].message).toContain('{{ status | option:sys_userz.status }}');
    expect(findings[0].message).toContain('names the object `sys_userz`, which has a platform prefix, but no known package registers it');
    expect(findings[0].hint).toContain('object-reference-unregistered-platform');
    expect(findings[0].hint).toContain(OPTION_ARGUMENT_RULE);
    // Control: the same spelling without the prefix is refused.
    expect(validateEmailTemplateHoleGrammar(stackWith(onlySubject('{{ status | option:userz.status }}'))).map((f) => [f.severity, f.message]))
      .toEqual([['error', expect.stringContaining('names the object `userz`, which resolves to no object')]]);
  });

  it('control: the same hole is refused once the object is not declared — the verdict reads the declaration', () => {
    expect(validateEmailTemplateHoleGrammar(stackWith(onlySubject(HOLE), [])).map((f) => f.message))
      .toEqual([expect.stringContaining('names the object `opportunity`, which resolves to no object this app defines')]);
  });
});

describe('a reference that names no option list', () => {
  it.each([
    ['an object the app does not have', '{{ stage | option:deal.stage }}', 'names the object `deal`, which resolves to no object this app defines, a package of its artifact provides or the platform provides'],
    ['a field the object does not have', '{{ stage | option:opportunity.phase }}', 'names the field `phase`, which the object `opportunity` does not have'],
    ['a field with no options', '{{ name | option:opportunity.name }}', 'names the field `opportunity.name`, which declares no options'],
    ['a quoted reference', "{{ stage | option:'opportunity.stage' }}", 'one object name and one field name joined by a dot'],
    ['a field with no object', '{{ stage | option:stage }}', 'one object name and one field name joined by a dot'],
    ['a marked path', '{{ stage | option:@stage_ref }}', 'one object name and one field name joined by a dot'],
  ])('⭐ refuses %s, naming the hole and what to fix', (_label, hole, says) => {
    const findings = validateEmailTemplateHoleGrammar(stackWith(onlySubject(`Stalled at ${hole}`)));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'error', rule: EMAIL_TEMPLATE_HOLE_GRAMMAR, path: 'emailTemplates[0].subject' });
    expect(findings[0].where).toContain('deal.stalled');
    expect(findings[0].message).toContain(hole);
    expect(findings[0].message).toContain(says);
    expect(findings[0].message).toContain(OPTION_ARGUMENT_RULE);
    expect(findings[0].hint).toContain(OPTION_ARGUMENT_RULE);
  });

  it.each(['subject', 'bodyText', 'bodyHtml'])('refuses it in %s, each face on its own path', (face) => {
    const tpl = template({ subject: 'Stalled', bodyHtml: '<p>Stalled</p>', bodyText: 'Stalled', [face]: 'At {{ stage | option:deal.stage }}' });
    expect(validateEmailTemplateHoleGrammar(stackWith(tpl)).map((f) => f.path)).toEqual([`emailTemplates[0].${face}`]);
  });
});

describe('the authoring doors', () => {
  it.each([...AUTHORING_COMMANDS])('⭐ os %s, on the parsed stack, accepts a select field and refuses one with no options at error', (command) => {
    const accepted = normalizeStackInput(stackWith(template()) as Record<string, unknown>);
    expect(runAuthoringRules(command, {
      normalized: accepted as Record<string, unknown>,
      parsed: ObjectStackDefinitionSchema.parse(accepted) as Record<string, unknown>,
    }).filter((f) => f.rule === EMAIL_TEMPLATE_HOLE_GRAMMAR)).toEqual([]);
    const refused = normalizeStackInput(stackWith(onlySubject('{{ name | option:opportunity.name }}')) as Record<string, unknown>);
    expect(runAuthoringRules(command, {
      normalized: refused as Record<string, unknown>,
      parsed: ObjectStackDefinitionSchema.parse(refused) as Record<string, unknown>,
    }).filter((f) => f.severity === 'error' && f.rule === EMAIL_TEMPLATE_HOLE_GRAMMAR).map((f) => f.path))
      .toEqual(['emailTemplates[0].subject']);
  });

  describe('⭐ the CLI doors walk the ladder, the publish door reads the live universe alone', () => {
    const atCli = (command: (typeof AUTHORING_COMMANDS)[number], tpl: Record<string, unknown>) => {
      const normalized = normalizeStackInput(stackWith(tpl) as Record<string, unknown>);
      return runAuthoringRules(command, {
        normalized: normalized as Record<string, unknown>,
        parsed: ObjectStackDefinitionSchema.parse(normalized) as Record<string, unknown>,
      }).filter((f) => f.rule === EMAIL_TEMPLATE_HOLE_GRAMMAR).map((f) => [f.severity, f.path]);
    };
    const atPublish = (tpl: Record<string, unknown>, objects: unknown[]) => {
      const result = runRuntimeAuthoringRules({ type: 'email_template', item: tpl, context: { objects } });
      return {
        errors: result.errors.map((f) => [f.rule, f.path, f.message]),
        advisories: result.advisories.filter((f) => f.rule === EMAIL_TEMPLATE_HOLE_GRAMMAR).map((f) => f.path),
      };
    };
    const sysUser = {
      name: 'sys_user',
      label: 'User',
      fields: { status: { type: 'select', label: 'Status', options: [{ value: 'active', label: 'Active' }] } },
    };

    it.each([
      ['a platform-prefixed name no package registers (rung ④)', '{{ status | option:sys_userz.status }}', 'sys_userz', [['warning', 'emailTemplates[0].subject']]],
      ['a platform object name the live universe does not carry', '{{ status | option:sys_user.status }}', 'sys_user', []],
    ])('%s: os validate and os build answer from the ladder, the publish door refuses at error', (_label, hole, object, cli) => {
      const tpl = onlySubject(`Stalled at ${hole}`);
      expect(atCli('validate', tpl)).toEqual(cli);
      expect(atCli('build', tpl)).toEqual(cli);
      const published = atPublish(tpl, [opportunity]);
      expect(published.advisories).toEqual([]);
      expect(published.errors).toEqual([[
        EMAIL_TEMPLATE_HOLE_GRAMMAR,
        'emailTemplates[0].subject',
        expect.stringContaining(`names the object \`${object}\`, which resolves to no object`),
      ]]);
    });

    it('control: the publish door accepts the platform object once the live universe serves it', () => {
      expect(atPublish(onlySubject('{{ status | option:sys_user.status }}'), [opportunity, sysUser]))
        .toEqual({ errors: [], advisories: [] });
    });
  });

  it('⭐ the runtime publish gate judges an email_template write against the live objects it carries', () => {
    const write = (objects: unknown[]) => runRuntimeAuthoringRules({
      type: 'email_template',
      item: template(),
      context: { objects },
    });
    expect(write([opportunity]).errors).toEqual([]);
    expect(write([]).errors.map((f) => [f.rule, f.path])).toEqual([
      [EMAIL_TEMPLATE_HOLE_GRAMMAR, 'emailTemplates[0].subject'],
      [EMAIL_TEMPLATE_HOLE_GRAMMAR, 'emailTemplates[0].bodyText'],
      [EMAIL_TEMPLATE_HOLE_GRAMMAR, 'emailTemplates[0].bodyHtml'],
    ]);
  });
});

describe('in-app template text refuses `option` as a formatter it does not know', () => {
  const flowStack = (config: Record<string, unknown>) => ({
    objects: [opportunity],
    flows: [{
      name: 'deal_stalled',
      label: 'Deal stalled',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'w', type: 'notify', label: 'Notify', config },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'w' },
        { id: 'e2', source: 'w', target: 'end' },
      ],
    }],
  });

  it.each([
    ['title', { recipients: ['u1'], title: 'Stalled at {{ stage | option:opportunity.stage }}' }],
    ['message', { recipients: ['u1'], title: 'Stalled', message: 'At {{ stage | option:opportunity.stage }}' }],
  ])('⭐ a flow notice %s, at os validate', (slot, config) => {
    const normalized = normalizeStackInput(flowStack(config) as Record<string, unknown>);
    const findings = runAuthoringRules('validate', {
      normalized: normalized as Record<string, unknown>,
      parsed: ObjectStackDefinitionSchema.parse(normalized) as Record<string, unknown>,
    }).filter((f) => f.rule === EXPRESSION_INVALID && f.where.includes("node 'w'"));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].where).toContain(`notify ${slot}`);
    expect(findings[0].message).toContain("names the formatter 'option', which is not a template formatter");
    expect(findings[0].message).toContain('formats only in a mail template');
  });

  it('⭐ an action\'s confirmText', () => {
    const issues = validateStackExpressions({
      objects: [opportunity],
      actions: [{
        name: 'advance',
        label: 'Advance',
        type: 'api',
        target: '/api/v1/advance',
        objectName: 'opportunity',
        confirmText: 'Move {{ record.name }} out of {{ record.stage | option:opportunity.stage }}?',
      }],
    }).filter((i) => i.where.includes('confirmText'));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toContain('formats only in a mail template');
  });
});
