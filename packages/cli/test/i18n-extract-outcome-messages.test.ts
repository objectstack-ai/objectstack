// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ActionSchema.outcomeMessages` (#21095) on the extraction face: the outcome
 * copy rides beside `successMessage`, one key per DECLARED outcome, at the
 * address `translateAction` overlays (`spec/system/i18n-resolver.ts`):
 *
 *   objects.<object>._actions.<action>.outcomeMessages.<outcome>
 *   globalActions.<action>.outcomeMessages.<outcome>
 *
 * Both action walks are exercised — the object's own `actions[]` and the
 * top-level `actions[]` (bound and object-less) — because a repair that kept
 * one walk and dropped the other is the regression `i18n-walk-output-parity`
 * exists for. An inline locale map is authored (counted by the coverage gate)
 * but never seeded, the rule every other action copy key follows.
 */
import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract.js';

const config: any = {
  objects: [
    {
      name: 'sys_environment',
      label: 'Environment',
      fields: { name: { label: 'Name' } },
      actions: [
        {
          name: 'archive_environment',
          label: 'Archive',
          type: 'script',
          target: 'archiveEnvironment',
          outcomeMessages: {
            archived: 'Archived ${result.environmentId}.',
            already_archived: { en: 'Already archived.', 'zh-CN': '已归档。' },
          },
        },
      ],
    },
  ],
  actions: [
    {
      name: 'delete_environment',
      label: 'Delete',
      objectName: 'sys_environment',
      type: 'script',
      target: 'deleteEnvironment',
      successMessage: 'Environment updated.',
      outcomeMessages: { destroyed: 'Destroyed ${result.environmentId}.' },
    },
    {
      name: 'check_app_updates',
      label: 'Check for updates',
      type: 'api',
      target: '/api/v1/cloud/packages/updates',
      outcomeMessages: { up_to_date: 'All apps are up to date.' },
    },
    { name: 'plain', label: 'Plain', type: 'script', target: 'plain' },
  ],
};

const paths = () => collectExpectedEntries(config).map((e) => e.path.join('.'));

describe('i18n extraction — outcomeMessages (#21095)', () => {
  it('emits one key per declared outcome on every action walk', () => {
    const p = paths();
    expect(p).toContain('objects.sys_environment._actions.archive_environment.outcomeMessages.archived');
    expect(p).toContain('objects.sys_environment._actions.archive_environment.outcomeMessages.already_archived');
    expect(p).toContain('objects.sys_environment._actions.delete_environment.outcomeMessages.destroyed');
    expect(p).toContain('globalActions.check_app_updates.outcomeMessages.up_to_date');
  });

  it('emits nothing for an outcome nobody declared, and nothing for an action without the map', () => {
    const outcomeKeys = paths().filter((k) => k.includes('.outcomeMessages.'));
    expect(outcomeKeys.sort()).toEqual([
      'globalActions.check_app_updates.outcomeMessages.up_to_date',
      'objects.sys_environment._actions.archive_environment.outcomeMessages.already_archived',
      'objects.sys_environment._actions.archive_environment.outcomeMessages.archived',
      'objects.sys_environment._actions.delete_environment.outcomeMessages.destroyed',
    ]);
  });

  it('seeds the default locale from the authored copy, ${result.*} tokens verbatim; an inline map is not seeded', () => {
    const { bundles } = extractTranslations(config, {
      defaultLocale: 'en',
      locales: ['zh-CN'],
      fill: 'empty',
      mergeExisting: false,
    });
    const en = bundles.en as any;
    expect(en.objects.sys_environment._actions.archive_environment.outcomeMessages.archived)
      .toBe('Archived ${result.environmentId}.');
    expect(en.objects.sys_environment._actions.delete_environment.outcomeMessages.destroyed)
      .toBe('Destroyed ${result.environmentId}.');
    expect(en.globalActions.check_app_updates.outcomeMessages.up_to_date).toBe('All apps are up to date.');
    expect(en.objects.sys_environment._actions.archive_environment.outcomeMessages.already_archived).toBeUndefined();
    expect((bundles['zh-CN'] as any).globalActions.check_app_updates.outcomeMessages.up_to_date).toBe('');
  });
});
