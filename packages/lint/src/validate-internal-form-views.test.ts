// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `form-view-internal-not-loaded` (#36425): an internal create / edit form the
 * app still declares is reported once, as a warning; a public form and a named
 * form are not.
 */

import { describe, expect, it } from 'vitest';
import { FORM_VIEW_INTERNAL_NOT_LOADED, validateInternalFormViews } from './validate-internal-form-views.js';
import { AUTHORING_RULES } from './authoring-rules.js';
import { explainRule } from './rule-explanations.js';

const sections = [{ label: 'Main', fields: ['name'] }];

describe('form-view-internal-not-loaded', () => {
  it('reports a container\'s default form, its formViews.create and formViews.default, each as a warning', () => {
    const findings = validateInternalFormViews({
      views: [{
        name: 'account',
        object: 'account',
        form: { type: 'simple', sections },
        formViews: { create: { type: 'simple', sections }, default: { type: 'tabbed', sections } },
      }],
    });
    expect(findings.map((f) => f.path)).toEqual([
      'views[0].form',
      'views[0].formViews.create',
      'views[0].formViews.default',
    ]);
    for (const f of findings) {
      expect(f.rule).toBe(FORM_VIEW_INTERNAL_NOT_LOADED);
      expect(f.severity).toBe('warning');
      expect(f.hint).toMatch(/^Internal forms are no longer loaded: use field groups/);
    }
  });

  it('reports a stored form view item that is the default or the object\'s create form', () => {
    const findings = validateInternalFormViews({
      views: [
        { name: 'account.form', object: 'account', viewKind: 'form', isDefault: true, config: { sections } },
        { name: 'account.create', object: 'account', viewKind: 'form', config: { sections } },
      ],
    });
    expect(findings.map((f) => f.path)).toEqual(['views[0].config', 'views[1].config']);
  });

  it('CONTROL: a public form (sharing.enabled) is never reported, wherever it sits', () => {
    const sharing = { enabled: true, publicLink: 'contact-us', allowAnonymous: true };
    expect(validateInternalFormViews({
      views: [
        { name: 'lead', object: 'lead', form: { type: 'simple', sections, sharing } },
        { name: 'lead.form', object: 'lead', viewKind: 'form', isDefault: true, config: { sections, sharing } },
      ],
    })).toEqual([]);
  });

  it('CONTROL: a form view under any other name (opened by name by an action) is not reported', () => {
    expect(validateInternalFormViews({
      views: [
        { name: 'lead', object: 'lead', formViews: { wizard: { type: 'wizard', sections } } },
        { name: 'lead.qualify', object: 'lead', viewKind: 'form', config: { sections } },
      ],
    })).toEqual([]);
  });

  it('a form with sharing turned off is internal and reported', () => {
    const findings = validateInternalFormViews({
      views: [{ name: 'lead', object: 'lead', form: { sections, sharing: { enabled: false } } }],
    });
    expect(findings).toHaveLength(1);
  });

  it('is registered as an advisory rule on every check command, and `os explain` knows it', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateInternalFormViews');
    expect(entry?.tier).toBe('advisory');
    expect(explainRule(FORM_VIEW_INTERNAL_NOT_LOADED)?.rule).toBe(FORM_VIEW_INTERNAL_NOT_LOADED);
  });
});
