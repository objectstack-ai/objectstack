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
 * `actionCancelText` — the dismiss label of an action's confirm and param
 * dialogs (`ActionSchema.cancelText`, objectstack#28879) — reads the node every
 * action resolver reads: `objects.OBJECT._actions.ACTION.cancelText` for an
 * action with a key object, `globalActions.ACTION.cancelText` for one without,
 * and never both (objectui#11439). A miss answers the authored fallback, and no
 * fallback answers `undefined`, so the dialog keeps its default "Cancel".
 */
describe('useObjectLabel().actionCancelText (objectstack#28879)', () => {
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
          objects: {
            sys_invitation: { _actions: { cancel_invitation: { cancelText: '保留邀请' } } },
          },
          globalActions: {
            close_period: { cancelText: '保持打开' },
            // Filed ONLY under the global scope: a bound action never reads it.
            close_case: { cancelText: '保留工单' },
          },
        },
      },
      true,
      true,
    );
    return result;
  };

  it('reads the object-scoped entry for an action with a key object', () => {
    const l = setup().current.labels;
    expect(l.actionCancelText('sys_invitation', 'cancel_invitation', 'Keep invitation')).toBe('保留邀请');
  });

  it('reads the global entry for an object-less action', () => {
    const l = setup().current.labels;
    expect(l.actionCancelText(undefined, 'close_period', 'Keep open')).toBe('保持打开');
  });

  it('never reads globalActions copy for a bound action', () => {
    const l = setup().current.labels;
    expect(l.actionCancelText('crm_case', 'close_case', 'Keep case')).toBe('Keep case');
    // Control: the same entry, read with no key object.
    expect(l.actionCancelText(undefined, 'close_case', 'Keep case')).toBe('保留工单');
  });

  it('answers the authored text on a miss, and undefined with no authored text', () => {
    const l = setup().current.labels;
    expect(l.actionCancelText('sys_invitation', 'resend', 'Not now')).toBe('Not now');
    expect(l.actionCancelText('sys_invitation', 'resend')).toBeUndefined();
    expect(l.actionCancelText('sys_invitation', 'resend', '')).toBeUndefined();
  });

  it('a nameless action has no key to read: the authored text, else undefined', () => {
    const l = setup().current.labels;
    expect(l.actionCancelText('sys_invitation', undefined, 'Keep invitation')).toBe('Keep invitation');
    expect(l.actionCancelText('sys_invitation', undefined)).toBeUndefined();
  });
});
