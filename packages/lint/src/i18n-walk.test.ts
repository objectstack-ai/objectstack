// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The translatable-key walk, from this package: the keys a small stack yields,
 * and the one input a browser cannot read (the liveness ledger) leaving out
 * the same groups there as in the CLI. The walk's surface is pinned in depth by
 * the CLI's i18n suites, which reach it through its re-export.
 */

import { describe, it, expect } from 'vitest';
import { authorWarnedTranslationGroups, collectExpectedEntries } from './i18n-walk.js';

const STACK = {
  objects: [
    {
      name: 'repair_ticket',
      label: 'Repair Ticket',
      fields: {
        priority: {
          type: 'select',
          label: 'Priority',
          options: [
            { value: 'low', label: 'Low' },
            { value: 'high', label: 'High' },
          ],
        },
      },
    },
  ],
  apps: [
    {
      name: 'service',
      label: 'Service',
      navigation: [{ id: 'nav_tickets', type: 'object', objectName: 'repair_ticket', label: 'Tickets' }],
    },
  ],
};

describe('collectExpectedEntries', () => {
  const entries = collectExpectedEntries(STACK, { warnedGroups: new Set() });
  const byKey = new Map(entries.map((e) => [e.path.join('.'), e]));

  it('yields the object, field, option, app and navigation keys, each with its source text', () => {
    expect(byKey.get('objects.repair_ticket.label')?.sourceValue).toBe('Repair Ticket');
    expect(byKey.get('objects.repair_ticket.fields.priority.label')?.sourceValue).toBe('Priority');
    expect(byKey.get('objects.repair_ticket.fields.priority.options.low')?.sourceValue).toBe('Low');
    expect(byKey.get('objects.repair_ticket.fields.priority.options.high')?.sourceValue).toBe('High');
    expect(byKey.get('apps.service.label')?.sourceValue).toBe('Service');
    expect(byKey.get('apps.service.navigation.nav_tickets.label')?.sourceValue).toBe('Tickets');
  });

  it('names what each key was harvested from', () => {
    expect(byKey.get('objects.repair_ticket.label')?.source).toBe('object');
    expect(byKey.get('objects.repair_ticket.fields.priority.label')?.source).toBe('field');
    expect(byKey.get('objects.repair_ticket.fields.priority.options.low')?.source).toBe('option');
    expect(byKey.get('apps.service.label')?.source).toBe('app');
    expect(byKey.get('apps.service.navigation.nav_tickets.label')?.source).toBe('navigation');
  });

  it('leaves a warned group out of the walk', () => {
    const keys = collectExpectedEntries(STACK, { warnedGroups: new Set(['apps']) }).map((e) => e.path[0]);
    expect(keys).toContain('objects');
    expect(keys).not.toContain('apps');
  });
});

describe('collectExpectedEntries — a hook\'s declared texts (#34374)', () => {
  const entries = collectExpectedEntries({
    hooks: [{
      name: 'lead_follow_up',
      object: 'lead',
      events: ['afterUpdate'],
      body: { language: 'js', source: "await ctx.text('follow_up_subject', { lead: 'x' });" },
      texts: { follow_up_subject: { message: 'Follow up with qualified lead: {{ lead }}', params: ['lead'] } },
    }],
  }, { warnedGroups: new Set() });

  it('yields hooks.<hook>.texts.<key>.message with the declared sentence, from the hook', () => {
    const entry = entries.find((e) => e.path.join('.') === 'hooks.lead_follow_up.texts.follow_up_subject.message');
    expect(entry?.sourceValue).toBe('Follow up with qualified lead: {{ lead }}');
    expect(entry?.source).toBe('hook');
  });
});

describe('collectExpectedEntries — a named import mapping\'s label', () => {
  const entries = collectExpectedEntries({
    mappings: [
      { name: 'lead_feed', label: 'Lead feed', targetObject: 'lead', fieldMapping: [{ source: 'Company', target: 'company' }] },
      { name: 'unlabelled_feed', targetObject: 'lead', fieldMapping: [] },
    ],
  }, { warnedGroups: new Set() });

  it('yields mappings.<mapping>.label with the authored label, from the mapping', () => {
    const entry = entries.find((e) => e.path.join('.') === 'mappings.lead_feed.label');
    expect(entry?.sourceValue).toBe('Lead feed');
    expect(entry?.source).toBe('mapping');
  });

  it('keys nothing from the field mapping, and no authored text for a mapping with no label', () => {
    const keys = entries.map((e) => e.path.join('.'));
    expect(keys.filter((k) => k.startsWith('mappings.lead_feed.'))).toEqual(['mappings.lead_feed.label']);
    expect(entries.find((e) => e.path.join('.') === 'mappings.unlabelled_feed.label')?.sourceValue).toBeUndefined();
  });
});

describe('authorWarnedTranslationGroups on the shipped ledger', () => {
  // A browser reads no ledger file, so there the default leaves no group out.
  // That matches the CLI only while the ledger warns on no translation group;
  // the day one is warned, a browser caller must be handed the set instead.
  it('warns on no translation group, so a browser and the CLI walk the same groups', () => {
    expect([...authorWarnedTranslationGroups()]).toEqual([]);
  });
});

/**
 * [#31885] `preflight.fields.<path>` — one key per labelled field the action's
 * `preflight.fields[]` declares, keyed by the literal path exactly as
 * `resultDialog.fields.<path>` is (a dotted path stays ONE segment), at the
 * action's one address: `objects.<obj>._actions` when it is bound,
 * `globalActions` when it is not.
 */
describe('collectExpectedEntries — preflight field labels', () => {
  const preflight = {
    read: { url: '/api/v1/cloud/packages/${ctx.recordId}/upgrade-plan?version=${param.version}' },
    path: 'data',
    fields: [
      { path: 'findings', label: 'Schema findings', format: 'json' },
      { path: 'verdict.summary', label: { en: 'Verdict', 'zh-CN': '结论' } },
      { path: 'unlabeled' },
    ],
  };
  const stack = {
    objects: [
      {
        name: 'sys_package',
        label: 'Package',
        fields: {},
        actions: [
          { name: 'install_package', label: 'Install', type: 'api', params: [{ name: 'version', type: 'text' }], preflight },
          { name: 'install_bare', label: 'Install bare', type: 'api', params: [{ name: 'version', type: 'text' }], preflight: { read: preflight.read } },
        ],
      },
    ],
    actions: [
      { name: 'check_upgrade', label: 'Check', type: 'api', params: [{ name: 'version', type: 'text' }], preflight },
    ],
  };
  const entries = collectExpectedEntries(stack, { warnedGroups: new Set() });
  const preflightKeys = (root: string[]) =>
    entries
      .filter((e) => root.every((seg, i) => e.path[i] === seg) && e.path[root.length] === 'preflight')
      .map((e) => e.path.slice(root.length));

  it('emits one key per labelled field, the dotted path kept as one segment, at the bound address', () => {
    expect(preflightKeys(['objects', 'sys_package', '_actions', 'install_package'])).toEqual([
      ['preflight', 'fields', 'findings'],
      ['preflight', 'fields', 'verdict.summary'],
    ]);
    const findings = entries.find((e) => e.path.join('\u0000') === ['objects', 'sys_package', '_actions', 'install_package', 'preflight', 'fields', 'findings'].join('\u0000'));
    expect(findings).toMatchObject({ sourceValue: 'Schema findings', inline: 'Schema findings', source: 'action', objectName: 'sys_package' });
    const verdict = entries.find((e) => e.path.join('\u0000') === ['objects', 'sys_package', '_actions', 'install_package', 'preflight', 'fields', 'verdict.summary'].join('\u0000'));
    expect(verdict?.inlineLocales).toEqual({ en: 'Verdict', 'zh-CN': '结论' });
  });

  it('emits the same keys under `globalActions` for an object-less action', () => {
    expect(preflightKeys(['globalActions', 'check_upgrade'])).toEqual([
      ['preflight', 'fields', 'findings'],
      ['preflight', 'fields', 'verdict.summary'],
    ]);
    expect(entries.find((e) => e.path[0] === 'globalActions' && e.path[2] === 'preflight')?.source).toBe('globalAction');
  });

  it('emits nothing for a preflight that declares no `fields` (the panel shows the answer as JSON)', () => {
    expect(preflightKeys(['objects', 'sys_package', '_actions', 'install_bare'])).toEqual([]);
  });
});

/**
 * [#34652] `resultDialog.columns.<path>.<column_path>` and
 * `preflight.columns.<path>.<column_path>` — one key per labelled column of a
 * `format: 'table'` field, beside the field's own `fields.<path>` key, both
 * levels keyed by the literal path (a dotted path stays ONE segment).
 */
describe('collectExpectedEntries — answer table column labels', () => {
  const table = {
    path: 'rows',
    label: 'Result per row',
    format: 'table',
    columns: [
      { path: 'email', label: 'Email' },
      { path: 'error.message', label: { en: 'Not added because', 'zh-CN': '未添加的原因' } },
      { path: 'row', format: 'json' },
    ],
  };
  const stack = {
    objects: [
      {
        name: 'sys_user',
        label: 'User',
        fields: {},
        actions: [
          {
            name: 'import_users',
            label: 'Import',
            type: 'api',
            params: [{ name: 'csv', type: 'text' }],
            resultDialog: { title: 'Done', fields: [{ path: 'summary.added', label: 'Added' }, table] },
            preflight: { read: { url: '/api/v1/x' }, fields: [table] },
          },
        ],
      },
    ],
  };
  const entries = collectExpectedEntries(stack, { warnedGroups: new Set() });
  const root = ['objects', 'sys_user', '_actions', 'import_users'];
  const blockKeys = (block: string) =>
    entries
      .filter((e) => root.every((seg, i) => e.path[i] === seg) && e.path[root.length] === block)
      .map((e) => e.path.slice(root.length));

  it('lists a key per labelled column beside the field key, an unlabelled column none', () => {
    expect(blockKeys('resultDialog')).toEqual([
      // The optional prose slots are listed whether authored or not.
      ['resultDialog', 'title'],
      ['resultDialog', 'description'],
      ['resultDialog', 'acknowledge'],
      ['resultDialog', 'fields', 'summary.added'],
      ['resultDialog', 'fields', 'rows'],
      ['resultDialog', 'columns', 'rows', 'email'],
      ['resultDialog', 'columns', 'rows', 'error.message'],
    ]);
    const email = entries.find((e) => e.path.join('\u0000') === [...root, 'resultDialog', 'columns', 'rows', 'email'].join('\u0000'));
    expect(email).toMatchObject({ sourceValue: 'Email', inline: 'Email', source: 'action', objectName: 'sys_user' });
    const reason = entries.find((e) => e.path.join('\u0000') === [...root, 'resultDialog', 'columns', 'rows', 'error.message'].join('\u0000'));
    expect(reason?.inlineLocales).toEqual({ en: 'Not added because', 'zh-CN': '未添加的原因' });
  });

  it('lists the same column keys under a preflight table field', () => {
    expect(blockKeys('preflight')).toEqual([
      ['preflight', 'fields', 'rows'],
      ['preflight', 'columns', 'rows', 'email'],
      ['preflight', 'columns', 'rows', 'error.message'],
    ]);
  });
});

describe('collectExpectedEntries — an action\'s declared texts (#34374 PR2)', () => {
  const texts = { email_subject: { message: 'Email: {{ subject }}', params: ['subject'] } };
  const body = { language: 'js', source: "await ctx.text('email_subject', { subject: input.subject });" };
  const entries = collectExpectedEntries({
    objects: [{
      name: 'crm_contact',
      fields: {},
      actions: [{ name: 'send_email', label: 'Send email', type: 'script', body, texts }],
    }],
    actions: [
      { name: 'send_digest', label: 'Send digest', type: 'script', body, texts },
      { name: 'log_call', label: 'Log call', objectName: 'crm_contact', type: 'script', body, texts },
    ],
  }, { warnedGroups: new Set() });
  const at = (path: string) => entries.find((e) => e.path.join('.') === path);

  it('yields objects.<object>._actions.<action>.texts.<key>.message with the declared sentence, for an inline action', () => {
    expect(at('objects.crm_contact._actions.send_email.texts.email_subject.message')).toMatchObject({
      sourceValue: 'Email: {{ subject }}', source: 'action', objectName: 'crm_contact',
    });
  });

  it('yields a top-level bound action\'s texts under its object', () => {
    expect(at('objects.crm_contact._actions.log_call.texts.email_subject.message')?.sourceValue).toBe('Email: {{ subject }}');
  });

  it('yields an object-less action\'s texts under globalActions', () => {
    expect(at('globalActions.send_digest.texts.email_subject.message')).toMatchObject({
      sourceValue: 'Email: {{ subject }}', source: 'globalAction',
    });
  });
});

describe('collectExpectedEntries — an action\'s refusal catalogue (#34273)', () => {
  const refusals = {
    NOT_DRAFT: { message: 'Only a draft invoice can be signed off.' },
    STAGE_LOCKED: { message: 'Locked.', reasons: { closed: { message: 'A {{ stage }} deal is closed.' } }, params: ['stage'] },
  };
  const body = { language: 'js', source: "throw { code: 'NOT_DRAFT' };" };
  const entries = collectExpectedEntries({
    objects: [{
      name: 'crm_invoice',
      fields: {},
      actions: [{ name: 'submit_signoff', label: 'Submit', type: 'script', body, refusals }],
    }],
    actions: [{ name: 'export_all', label: 'Export', type: 'script', body, refusals: { NOT_DRAFT: refusals.NOT_DRAFT } }],
  }, { warnedGroups: new Set() });
  const at = (path: string) => entries.find((e) => e.path.join('.') === path);

  it('yields objects.<object>._actions.<action>.refusals.<CODE>.message with the declared sentence', () => {
    expect(at('objects.crm_invoice._actions.submit_signoff.refusals.NOT_DRAFT.message')?.sourceValue)
      .toBe('Only a draft invoice can be signed off.');
  });

  it('yields each declared reason under its code', () => {
    expect(at('objects.crm_invoice._actions.submit_signoff.refusals.STAGE_LOCKED.reasons.closed.message')?.sourceValue)
      .toBe('A {{ stage }} deal is closed.');
  });

  it('yields an object-less action\'s refusals under globalActions', () => {
    expect(at('globalActions.export_all.refusals.NOT_DRAFT.message')?.sourceValue)
      .toBe('Only a draft invoice can be signed off.');
  });
});
