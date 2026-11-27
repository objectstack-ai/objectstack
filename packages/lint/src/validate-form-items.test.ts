// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0159 card ② items 7 and 9] The authoring rules of the `form` type:
 * the public-address refusal (ruled question 3 = A), the consumer-less
 * advisory (not raised for an `overrides` item), and the object binding.
 */

import { describe, expect, it } from 'vitest';
import {
  FORM_CONSUMER_LESS,
  FORM_OBJECT_OUTSIDE_CLOSURE,
  FORM_OBJECT_UNKNOWN,
  FORM_PUBLIC_ADDRESS_TAKEN,
  stackForms,
  validateFormConsumers,
  validateFormObjectBindings,
  validateFormPublicAddresses,
} from './validate-form-items.js';
import { AUTHORING_RULES } from './authoring-rules.js';
import { explainRule } from './rule-explanations.js';

const sections = [{ fields: ['name'] }];
const link = (enabled: boolean, slug = 'contact-us') => ({ enabled, allowAnonymous: true, publicLink: `/forms/${slug}` });
const form = (name: string, over: Record<string, unknown> = {}) => ({ name, object: 'lead', type: 'simple', sections, ...over });

describe('stackForms — one walk over authored items and the projection', () => {
  it('reads authored `forms:` and the forms the old `view` shapes carry, under their served names', () => {
    const forms = stackForms({
      forms: [form('lead.web')],
      views: [{ name: 'lead', object: 'lead', formViews: { contact: { sections } } }],
    });
    expect(forms.map((f) => [f.name, f.definedIn])).toEqual([['lead.web', 'form'], ['lead.contact', 'view']]);
  });
});

describe(FORM_PUBLIC_ADDRESS_TAKEN, () => {
  it('refuses an authored form left open on an address an old-shape form holds, naming both', () => {
    const findings = validateFormPublicAddresses({
      forms: [form('lead.web', { sharing: link(true) })],
      views: [{ name: 'lead', object: 'lead', formViews: { contact: { sections, sharing: link(true) } } }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'error', rule: FORM_PUBLIC_ADDRESS_TAKEN });
    expect(findings[0].message).toContain('lead.web');
    expect(findings[0].message).toContain('lead.contact');
  });

  it('a switched-off form that keeps its link still holds the address', () => {
    expect(validateFormPublicAddresses({
      forms: [form('lead.web', { sharing: link(true) }), form('lead.retired', { sharing: link(false) })],
    }).map((f) => f.where)).toEqual(['form "lead.web"']);
  });

  it('CONTROL: a closed authored form is never refused, and two old-shape forms keep today\'s behaviour', () => {
    expect(validateFormPublicAddresses({
      forms: [form('lead.retired', { sharing: link(false) })],
      views: [
        { name: 'lead', object: 'lead', formViews: { a: { sections, sharing: link(true) }, b: { sections, sharing: link(true) } } },
      ],
    })).toEqual([]);
  });
});

describe(FORM_CONSUMER_LESS, () => {
  it('warns on an authored form with no link and no action', () => {
    const findings = validateFormConsumers({ forms: [form('lead.orphan')] });
    expect(findings.map((f) => [f.severity, f.rule])).toEqual([['warning', FORM_CONSUMER_LESS]]);
  });

  it('is silent for a form an action of type `form` opens, a linked form, and an `overrides` item', () => {
    expect(validateFormConsumers({
      forms: [
        form('lead.opened'),
        form('lead.linked', { sharing: link(false) }),
        form('lead.custom', { overrides: { package: 'com.acme', basedOn: '1.0.0' } }),
      ],
      actions: [{ name: 'open_form', type: 'form', target: 'lead.opened' }],
    })).toEqual([]);
  });

  it('raises no new advisory for an old shape', () => {
    expect(validateFormConsumers({ views: [{ name: 'lead', object: 'lead', formViews: { quiet: { sections } } }] })).toEqual([]);
  });
});

describe('form object bindings', () => {
  const stack = { objects: [{ name: 'lead' }], forms: [form('lead.web'), form('ghost.web', { object: 'ghost' })] };

  it('judges an authored form\'s object against a stated package closure', () => {
    const findings = validateFormObjectBindings(stack, { packageScope: { packageId: 'com.acme', dependencies: [] } });
    expect(findings.map((f) => [f.rule, f.path])).toEqual([[FORM_OBJECT_OUTSIDE_CLOSURE, 'forms[1].object']]);
  });

  it('judges it against the whole collection a runtime write is judged against', () => {
    expect(validateFormObjectBindings(stack, { wholeCollection: true }).map((f) => f.rule)).toEqual([FORM_OBJECT_UNKNOWN]);
  });

  it('CONTROL: judges nothing it cannot see', () => {
    expect(validateFormObjectBindings(stack)).toEqual([]);
  });
});

describe('registration', () => {
  it('registers the address refusal as gating and the consumer rule as advisory; `os explain` knows all four', () => {
    expect(AUTHORING_RULES.find((r) => r.name === 'validateFormPublicAddresses')?.tier).toBe('gating');
    expect(AUTHORING_RULES.find((r) => r.name === 'validateFormConsumers')?.tier).toBe('advisory');
    for (const rule of [FORM_PUBLIC_ADDRESS_TAKEN, FORM_CONSUMER_LESS, FORM_OBJECT_OUTSIDE_CLOSURE, FORM_OBJECT_UNKNOWN]) {
      expect(explainRule(rule)?.rule).toBe(rule);
    }
  });
});
