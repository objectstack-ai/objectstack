// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `form-view-internal-not-loaded` (#36425): an internal create / edit form the
 * app still declares is reported once, as a warning; a public form and a named
 * form are not, and neither is a default or create form a `type: 'form'`
 * action opens by the name it is served under (#36545).
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
    expect(findings.map((f) => f.where)).toEqual([
      'view "account" · form',
      'view "account" · formViews.create',
      'view "account" · formViews.default',
    ]);
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

  it('a nameless container is named by the object its form binds, not by its index', () => {
    const findings = validateInternalFormViews({
      views: [
        { list: { type: 'grid', data: { provider: 'object', object: 'deal' } }, form: { data: { provider: 'object', object: 'deal' }, sections } },
        { list: { type: 'grid', data: { provider: 'object', object: 'lead' } }, form: { sections } },
      ],
    });
    expect(findings.map((f) => f.where)).toEqual(['view "deal" · form', 'view "lead" · form']);
    expect(findings.map((f) => f.path)).toEqual(['views[0].form', 'views[1].form']);
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

describe('form-view-internal-not-loaded — a form an action opens by name keeps loading (#36545)', () => {
  const container = {
    name: 'account',
    object: 'account',
    list: { type: 'grid', columns: ['name'] },
    form: { type: 'simple', sections },
    formViews: { create: { type: 'simple', sections }, default: { type: 'tabbed', sections } },
  };

  it('a registered or object-bound form action targeting the served name exempts that form, and only it', () => {
    const findings = validateInternalFormViews({
      views: [container],
      actions: [{ name: 'log_call', type: 'form', target: 'account.form' }],
      objects: [{ name: 'account', actions: [{ name: 'new_account', type: 'form', target: 'account.create' }] }],
    });
    expect(findings.map((f) => f.where)).toEqual(['view "account" · formViews.default']);
  });

  it('matches the name the spec expansion serves, collisions included, never a hand-built OBJECT.KEY', () => {
    // The default `list` claims `account.default`, so `formViews.default` is
    // served as `account.default_2`: a target of `account.default` opens the
    // list, not this form.
    const atList = validateInternalFormViews({
      views: [container],
      actions: [{ name: 'a', type: 'form', target: 'account.default' }],
    });
    expect(atList.map((f) => f.where)).toContain('view "account" · formViews.default');
    const atServed = validateInternalFormViews({
      views: [container],
      actions: [{ name: 'a', type: 'form', target: 'account.default_2' }],
    });
    expect(atServed.map((f) => f.where)).not.toContain('view "account" · formViews.default');
    // A container form with its own `name` is served under it.
    const renamed = validateInternalFormViews({
      views: [{ object: 'deal', form: { name: 'quick', sections } }],
      actions: [{ name: 'a', type: 'form', target: 'deal.quick' }],
    });
    expect(renamed).toEqual([]);
  });

  it('a page component\'s inline form action exempts a stored default form it names', () => {
    const findings = validateInternalFormViews({
      views: [{ name: 'task.form', object: 'task', viewKind: 'form', isDefault: true, config: { sections } }],
      pages: [{
        name: 'home',
        regions: [{ name: 'main', components: [
          { type: 'element:button', properties: { label: 'New', action: { name: 'new_task', type: 'form', target: 'task.form' } } },
        ] }],
      }],
    });
    expect(findings).toEqual([]);
  });

  it('CONTROL: a short or interpolated target, or a non-form action with the same target, exempts nothing', () => {
    for (const action of [
      { name: 'a', type: 'form', target: 'form' },
      { name: 'a', type: 'form', target: '{record.form_name}' },
      { name: 'a', type: 'modal', target: 'account.form' },
      { name: 'a', type: 'url', target: '/forms/account.form' },
    ]) {
      const findings = validateInternalFormViews({ views: [container], actions: [action] });
      expect(findings.map((f) => f.where), JSON.stringify(action)).toContain('view "account" · form');
    }
  });
});
