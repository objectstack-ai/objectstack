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
 * `actionSubmitText` — the verb on an action's param-dialog submit button
 * (`ActionSchema.submitText`, objectstack#28158) — reads the node every action
 * resolver reads: `objects.OBJECT._actions.ACTION.submitText` for an action
 * with a key object, `globalActions.ACTION.submitText` for one without, and
 * never both (objectui#11439). A miss answers the authored fallback, and no
 * fallback answers `undefined`, so the dialog keeps its default "Confirm".
 */
describe('useObjectLabel().actionSubmitText (objectstack#28158)', () => {
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
            crm_contact: { _actions: { send_email: { submitText: '发送' } } },
          },
          globalActions: {
            log_call: { submitText: '记录通话' },
            // Filed ONLY under the global scope: a bound action never reads it.
            merge_cases: { submitText: '合并' },
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
    expect(l.actionSubmitText('crm_contact', 'send_email', 'Send')).toBe('发送');
  });

  it('reads the global entry for an object-less action', () => {
    const l = setup().current.labels;
    expect(l.actionSubmitText(undefined, 'log_call', 'Log Call')).toBe('记录通话');
  });

  it('never reads globalActions copy for a bound action', () => {
    const l = setup().current.labels;
    expect(l.actionSubmitText('crm_case', 'merge_cases', 'Merge')).toBe('Merge');
    // Control: the same entry, read with no key object.
    expect(l.actionSubmitText(undefined, 'merge_cases', 'Merge')).toBe('合并');
  });

  it('answers the authored text on a miss, and undefined with no authored text', () => {
    const l = setup().current.labels;
    expect(l.actionSubmitText('crm_contact', 'archive', 'Archive')).toBe('Archive');
    expect(l.actionSubmitText('crm_contact', 'archive')).toBeUndefined();
    expect(l.actionSubmitText('crm_contact', 'archive', '')).toBeUndefined();
  });

  it('a nameless action has no key to read: the authored text, else undefined', () => {
    const l = setup().current.labels;
    expect(l.actionSubmitText('crm_contact', undefined, 'Send')).toBe('Send');
    expect(l.actionSubmitText('crm_contact', undefined)).toBeUndefined();
  });
});
