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
