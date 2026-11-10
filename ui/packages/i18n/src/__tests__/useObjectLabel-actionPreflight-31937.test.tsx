/**
 * `useObjectLabel().actionPreflight` — the console's reader of the bundle key
 * `…_actions.ACTION.preflight.fields.PATH` (objectstack#31937), the client
 * mirror of `@objectstack/spec`'s `resolveActionPreflight` and of
 * `actionResultDialog`'s `fields` overlay.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useObjectTranslation } from '../provider';
import { useObjectLabel } from '../useObjectLabel';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(
    I18nProvider,
    { config: { defaultLanguage: 'zh', detectBrowserLanguage: false }, children },
  );

/** The authored block, as a package declares it on `crm_deal.upgrade_plan`. */
const preflight = {
  read: { url: '/api/v1/plan?version=${param.version}' },
  path: 'data',
  fields: [
    { path: 'plan.seats', label: 'Seats', format: 'text' as const },
    { path: 'plan.price', label: 'Price', format: 'text' as const },
    { path: 'plan.note', label: { en: 'Note', 'zh-CN': '备注' } },
  ],
};

/** Mount the hook under a zh session holding `node` under the `crm` app namespace. */
function mount(node: Record<string, unknown>) {
  const { result } = renderHook(
    () => ({ labels: useObjectLabel(), i18n: useObjectTranslation().i18n }),
    { wrapper },
  );
  result.current.i18n.addResourceBundle('zh', 'translation', { crm: node }, true, true);
  return result;
}

describe('useObjectLabel().actionPreflight (objectstack#31937)', () => {
  it('draws the zh bundle label on its declared row; the dotted path is ONE literal key', () => {
    const result = mount({
      objects: {
        crm_deal: {
          _actions: {
            upgrade_plan: { preflight: { fields: { 'plan.seats': '席位数' } } },
          },
        },
      },
    });
    const out = result.current.labels.actionPreflight('crm_deal', 'upgrade_plan', preflight);
    expect(out?.fields?.[0]).toEqual({ path: 'plan.seats', label: '席位数', format: 'text' });
    // The rest of the block rides through untouched.
    expect(out?.read).toEqual(preflight.read);
    expect(out?.path).toBe('data');
    // The authored block is not mutated.
    expect(preflight.fields[0].label).toBe('Seats');
  });

  it('adds no row for a bundle path no declared row names', () => {
    const result = mount({
      objects: {
        crm_deal: {
          _actions: {
            upgrade_plan: {
              preflight: { fields: { 'plan.seats': '席位数', 'plan.discount': '折扣' } },
            },
          },
        },
      },
    });
    const out = result.current.labels.actionPreflight('crm_deal', 'upgrade_plan', preflight);
    expect(out?.fields?.map((f) => f.path)).toEqual(['plan.seats', 'plan.price', 'plan.note']);
  });

  it('CONTROL: a row with no bundle string draws as authored, an inline locale map included', () => {
    const result = mount({
      objects: {
        crm_deal: {
          _actions: {
            upgrade_plan: { preflight: { fields: { 'plan.seats': '席位数' } } },
          },
        },
      },
    });
    const out = result.current.labels.actionPreflight('crm_deal', 'upgrade_plan', preflight);
    expect(out?.fields?.[1]).toBe(preflight.fields[1]);
    expect(out?.fields?.[2]).toBe(preflight.fields[2]);
    expect(out?.fields?.[2].label).toEqual({ en: 'Note', 'zh-CN': '备注' });
  });

  it('reads `globalActions.ACTION.preflight.fields` for an action with no key object, and only then', () => {
    const result = mount({
      // The namespace is discovered through `objects`.
      objects: { crm_deal: { label: '交易' } },
      globalActions: {
        upgrade_plan: { preflight: { fields: { 'plan.price': '价格' } } },
      },
    });
    const l = result.current.labels;
    expect(l.actionPreflight(undefined, 'upgrade_plan', preflight)?.fields?.[1]).toEqual({
      path: 'plan.price',
      label: '价格',
      format: 'text',
    });
    // Keyed on an object, the global entry is not read (objectui#11439).
    expect(l.actionPreflight('crm_deal', 'upgrade_plan', preflight)?.fields?.[1].label).toBe('Price');
  });

  it('returns the spec itself with no spec, no action name or no declared rows', () => {
    const result = mount({ objects: { crm_deal: { label: '交易' } } });
    const l = result.current.labels;
    expect(l.actionPreflight('crm_deal', undefined, preflight)).toBe(preflight);
    expect(l.actionPreflight('crm_deal', 'upgrade_plan', undefined)).toBeUndefined();
    const noRows = { read: { url: '/api/v1/plan' } };
    expect(l.actionPreflight('crm_deal', 'upgrade_plan', noRows)).toBe(noRows);
  });
});
