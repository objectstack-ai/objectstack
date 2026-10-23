// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25189 — `validateEmailTemplateHolePlacements` on every authoring door: the
 * three CLI commands, and the runtime publish gate for an `email_template`
 * write (ruling `6335348115` on #25082, F1 A2).
 *
 * Which placement is supported is the shared judge's to decide, and
 * `@objectstack/formula`'s own test pins it class by class. What this file
 * holds is the rule: it reads every template's `bodyHtml` with the template's
 * own url variables, refuses at `error` on every door, names the placement and
 * the supported set, judges a written template on its own, and leaves the
 * plain-text faces alone.
 *
 * The bodies here carry holes and markup only, never a value.
 */
import { describe, expect, it } from 'vitest';

import { MAIL_HTML_PLACEMENT_LABELS, MAIL_HTML_SUPPORTED_SHAPES } from '@objectstack/formula';

import { AUTHORING_COMMANDS, AUTHORING_RULES, runAuthoringRules } from './authoring-rules.js';
import { buildRuntimeWriteSnapshots, runRuntimeAuthoringRules, stackKeyForType } from './runtime-gate.js';
import {
  EMAIL_TEMPLATE_HOLE_PLACEMENT,
  validateEmailTemplateHolePlacements,
} from './validate-email-template-hole-placements.js';

const template = (over: Record<string, unknown> = {}) => ({
  name: 'acme.welcome',
  label: 'Welcome',
  locale: 'en-US',
  subject: 'Hi {{user.name}}',
  bodyHtml: '<p>Hi <b>{{user.name}}</b>, <a href="{{{link}}}" title="{{user.name}}">open</a></p>',
  bodyText: 'Hi {{user.name}}: {{{link}}}',
  variables: [
    { name: 'user.name', type: 'string' },
    { name: 'link', type: 'url' },
  ],
  ...over,
});

/** A body with an encoded hole in a URL attribute — a placement the encoding does not suit. */
const IN_URL_ATTRIBUTE = '<p><a href="{{link}}">open</a></p>';
/** A body with an unencoded hole in element text — outside the one shape that form is admitted in. */
const RAW_IN_TEXT = '<p>{{{link}}}</p>';

const ruleIds = (findings: readonly { rule: string }[]) => findings.map((f) => f.rule);

describe('the rule, on the stack', () => {
  it('a body whose every hole is supported draws nothing', () => {
    expect(validateEmailTemplateHolePlacements({ emailTemplates: [template()] })).toEqual([]);
  });

  it('refuses an encoded hole in a placement its encoding does not suit, naming the placement and the supported set', () => {
    const findings = validateEmailTemplateHolePlacements({ emailTemplates: [template({ bodyHtml: IN_URL_ATTRIBUTE })] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: EMAIL_TEMPLATE_HOLE_PLACEMENT,
      path: 'emailTemplates[0].bodyHtml',
    });
    expect(findings[0].where).toContain('acme.welcome');
    expect(findings[0].message).toContain(MAIL_HTML_PLACEMENT_LABELS['url-attribute']);
    expect(findings[0].message).toContain('{{link}}');
    expect(findings[0].hint).toContain(MAIL_HTML_SUPPORTED_SHAPES);
  });

  it('refuses an unencoded hole outside the url href shape, and admits it only for a declared url variable', () => {
    const raw = validateEmailTemplateHolePlacements({ emailTemplates: [template({ bodyHtml: RAW_IN_TEXT })] });
    expect(raw.map((f) => f.message)).toEqual([expect.stringContaining(MAIL_HTML_PLACEMENT_LABELS['element-text'])]);

    // The href shape reads the TEMPLATE's own declarations: the same body is
    // refused once `link` is no longer declared with type 'url'.
    const undeclared = template({ variables: [{ name: 'user.name', type: 'string' }, { name: 'link', type: 'string' }] });
    expect(ruleIds(validateEmailTemplateHolePlacements({ emailTemplates: [undeclared] }))).toEqual([EMAIL_TEMPLATE_HOLE_PLACEMENT]);
    const noVariables = template({ variables: undefined });
    expect(ruleIds(validateEmailTemplateHolePlacements({ emailTemplates: [noVariables] }))).toEqual([EMAIL_TEMPLATE_HOLE_PLACEMENT]);
  });

  it('one finding per refused hole, each located on its own template', () => {
    const findings = validateEmailTemplateHolePlacements({
      emailTemplates: [
        template(),
        template({ name: 'acme.digest', bodyHtml: `${IN_URL_ATTRIBUTE}${RAW_IN_TEXT}` }),
      ],
    });
    expect(findings.map((f) => f.path)).toEqual(['emailTemplates[1].bodyHtml', 'emailTemplates[1].bodyHtml']);
    expect(findings.every((f) => f.where.includes('acme.digest'))).toBe(true);
  });

  it('a name-keyed collection is located by name', () => {
    const { name: _name, ...rest } = template({ bodyHtml: IN_URL_ATTRIBUTE });
    const findings = validateEmailTemplateHolePlacements({ emailTemplates: { 'acme.welcome': rest } });
    expect(findings.map((f) => f.path)).toEqual(['emailTemplates.acme.welcome.bodyHtml']);
  });

  it('the plain-text faces are not judged — they carry no markup context', () => {
    expect(validateEmailTemplateHolePlacements({
      emailTemplates: [template({ subject: '{{{link}}} <a href="{{link}}">', bodyText: '<script>{{x}}</script>' })],
    })).toEqual([]);
  });

  it('a stack with no templates, or a template with no html body, draws nothing', () => {
    expect(validateEmailTemplateHolePlacements({})).toEqual([]);
    expect(validateEmailTemplateHolePlacements({ emailTemplates: [template({ bodyHtml: undefined })] })).toEqual([]);
  });
});

describe('the registry entry', () => {
  const entry = AUTHORING_RULES.find((r) => r.name === 'validateEmailTemplateHolePlacements');

  it('is gating, on all three commands and the runtime publish gate for email_template writes', () => {
    expect(entry).toMatchObject({
      tier: 'gating',
      commands: [...AUTHORING_COMMANDS],
      surfaces: ['cli', 'runtime-publish'],
      runtimeTypes: ['email_template'],
    });
  });

  it.each([...AUTHORING_COMMANDS])('os %s refuses the body at error', (command) => {
    const stack = { emailTemplates: [template({ bodyHtml: IN_URL_ATTRIBUTE })] };
    const errors = runAuthoringRules(command, { normalized: stack, parsed: stack })
      .filter((f) => f.severity === 'error' && f.rule === EMAIL_TEMPLATE_HOLE_PLACEMENT);
    expect(errors).toHaveLength(1);
  });
});

describe('the runtime publish gate, for an email_template write', () => {
  it('⭐ LIT — refuses the written template, located on the written template itself', () => {
    const result = runRuntimeAuthoringRules({ type: 'email_template', item: template({ bodyHtml: IN_URL_ATTRIBUTE }) });
    expect(result.rulesRun).toContain('validateEmailTemplateHolePlacements');
    expect(ruleIds(result.errors)).toEqual([EMAIL_TEMPLATE_HOLE_PLACEMENT]);
    // `emailTemplates` is no context collection, so the candidate holds the
    // written template alone and its positional index is never re-keyed: the
    // index names that template, and `where` carries its name.
    expect(result.errors[0].path).toBe('emailTemplates[0].bodyHtml');
    expect(result.errors[0].where).toContain('acme.welcome');
  });

  it('publishes a template whose every hole is supported', () => {
    const result = runRuntimeAuthoringRules({ type: 'email_template', item: template() });
    expect(result.errors).toEqual([]);
  });

  it('judges the written template alone — a stored sibling is never in its snapshot, so never charged to it', () => {
    // An email template write carries no context collection of its own kind:
    // the candidate holds the written item and nothing else, and the baseline
    // holds no template at all. A stored template keeps serving and answers
    // for its own placements at its own next publish.
    const snapshots = buildRuntimeWriteSnapshots({ type: 'email_template', item: template() });
    expect(stackKeyForType('email_template')).toBe('emailTemplates');
    expect(snapshots?.candidate.emailTemplates).toEqual([template()]);
    expect(snapshots?.baseline.emailTemplates ?? []).toEqual([]);
  });
});
