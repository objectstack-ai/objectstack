import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useObjectTranslation } from '../provider';
import { useObjectLabel } from '../useObjectLabel';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(
    I18nProvider,
    { config: { defaultLanguage: 'en', detectBrowserLanguage: false }, children },
  );

/**
 * Which bundle node an action's copy is read from — objectui#3372, as amended
 * by objectui#11439.
 *
 * Mirrors the canonical `@objectstack/spec` resolver (`actionTranslationNode`
 * behind `lookupActionField`): an action with a KEY object (its declared
 * `objectName`, else the host that embeds it) reads that object's
 * `_actions.<action>.*` node and nothing else; an action with no key object
 * reads `globalActions.<action>.*`. There is no object-then-global chain.
 *
 * objectui#3372 originally pinned such a chain here: `globalActions` copy was
 * read for a bound action whenever its object-scoped key missed. Triage's
 * amended ruling on objectui#11439 (comment 6030552631, amending 5942994297)
 * retired it, because `@objectstack/spec` 17.7.0 reads `globalActions` only for
 * an action not bound to an object, so the two resolvers disagreed on the same
 * bundle. The object-less case objectui#3372 also covered is kept unchanged
 * ("still resolves a globalAction when objectName is omitted").
 */
describe('useObjectLabel() action copy is keyed on the action\'s own object (objectui#3372, objectui#11439)', () => {
  const setup = () => {
    const { result } = renderHook(
      () => ({ labels: useObjectLabel(), i18n: useObjectTranslation().i18n }),
      { wrapper },
    );
    result.current.i18n.addResourceBundle(
      'en',
      'translation',
      {
        crm: {
          // Object translations present → namespace is discovered via `objects`.
          objects: {
            crm_case: {
              _actions: {
                // Object action — translated under the object scope.
                escalate_case: { label: '升级工单' },
                // A name that exists in BOTH scopes — object must win.
                shared_action: { label: '对象级' },
                // objectui#3372's action, bound to `crm_case` — its copy filed
                // where the spec reads it (objectui#11439).
                log_call: { label: '记录工单通话', successMessage: '工单通话已记录。' },
              },
            },
          },
          // Global copy — what an object-less action reads.
          globalActions: {
            log_call: { label: '记录通话', successMessage: '通话记录成功！' },
            shared_action: { label: '全局级' },
            // Filed ONLY under the global scope, so a bound action of this
            // name has no object-scoped copy at all (objectui#11439).
            merge_cases: {
              label: '合并工单',
              confirmText: '确认合并？',
              successMessage: '已合并。',
              description: '全局描述',
              outcomeMessages: { merged: '全局结果' },
              params: { target: { label: '全局参数', options: { a: '全局选项' } } },
              resultDialog: { title: '全局标题' },
            },
          },
        },
      },
      true,
      true,
    );
    return result;
  };

  it('resolves an object action from the object scope (unchanged)', () => {
    const result = setup();
    expect(result.current.labels.actionLabel('crm_case', 'escalate_case', 'Escalate Case')).toBe(
      '升级工单',
    );
  });

  it('resolves a bound action from its own object scope, not from globalActions', () => {
    const result = setup();
    // Re-pointed per triage's amended ruling on objectui#11439 (comment
    // 6030552631): this case used to expect the `globalActions.log_call` copy
    // for a call keyed on `crm_case`. A bound action reads the object-scoped
    // copy, as `@objectstack/spec` 17.7.0 does.
    expect(result.current.labels.actionLabel('crm_case', 'log_call', 'Log a Call')).toBe(
      '记录工单通话',
    );
  });

  it('still resolves a globalAction when objectName is omitted', () => {
    const result = setup();
    expect(result.current.labels.actionLabel(undefined, 'log_call', 'Log a Call')).toBe(
      '记录通话',
    );
  });

  it('prefers the object-scoped translation over the global one on a name collision', () => {
    const result = setup();
    expect(result.current.labels.actionLabel('crm_case', 'shared_action', 'Shared')).toBe(
      '对象级',
    );
  });

  it('falls back to the metadata literal when neither scope translates', () => {
    const result = setup();
    expect(result.current.labels.actionLabel('crm_case', 'unknown_action', 'Do Thing')).toBe(
      'Do Thing',
    );
  });

  it('keys sibling resolvers on the same object scope (successMessage)', () => {
    const result = setup();
    // Re-pointed per triage's amended ruling on objectui#11439 (comment
    // 6030552631): this case used to expect the `globalActions.log_call`
    // successMessage for a call keyed on `crm_case`.
    expect(
      result.current.labels.actionSuccess('crm_case', 'log_call', 'Call logged.'),
    ).toBe('工单通话已记录。');
  });

  it('never reads globalActions copy for a bound action (objectui#11439)', () => {
    const result = setup();
    const l = result.current.labels;
    // `merge_cases` is translated ONLY under `globalActions`. Keyed on an
    // object, every action resolver shows the authored text instead — the
    // answer `@objectstack/spec` 17.7.0 gives for the same bundle.
    expect(l.actionLabel('crm_case', 'merge_cases', 'Merge Cases')).toBe('Merge Cases');
    expect(l.actionConfirm('crm_case', 'merge_cases', 'Merge?')).toBe('Merge?');
    expect(l.actionSuccess('crm_case', 'merge_cases', 'Merged.')).toBe('Merged.');
    expect(l.actionDescription('crm_case', 'merge_cases', 'Authored description')).toBe(
      'Authored description',
    );
    expect(l.actionOutcome('crm_case', 'merge_cases', 'merged', 'Authored outcome')).toBe(
      'Authored outcome',
    );
    expect(l.actionParamText('crm_case', 'merge_cases', 'target', 'label', 'Target')).toBe('Target');
    expect(l.actionParamOptionLabel('crm_case', 'merge_cases', 'target', 'a', 'Option A')).toBe(
      'Option A',
    );
    expect(l.actionResultDialog('crm_case', 'merge_cases', { title: 'Authored title' })?.title).toBe(
      'Authored title',
    );
    // With no key object the same entry is read in full (control): the
    // bundle is loaded and every resolver above reaches the global node.
    expect(l.actionLabel(undefined, 'merge_cases', 'Merge Cases')).toBe('合并工单');
    expect(l.actionConfirm(undefined, 'merge_cases', 'Merge?')).toBe('确认合并？');
    expect(l.actionSuccess(undefined, 'merge_cases', 'Merged.')).toBe('已合并。');
    expect(l.actionDescription(undefined, 'merge_cases', 'Authored description')).toBe('全局描述');
    expect(l.actionOutcome(undefined, 'merge_cases', 'merged', 'Authored outcome')).toBe('全局结果');
    expect(l.actionParamText(undefined, 'merge_cases', 'target', 'label', 'Target')).toBe('全局参数');
    expect(l.actionParamOptionLabel(undefined, 'merge_cases', 'target', 'a', 'Option A')).toBe(
      '全局选项',
    );
    expect(l.actionResultDialog(undefined, 'merge_cases', { title: 'Authored title' })?.title).toBe(
      '全局标题',
    );
  });
});
