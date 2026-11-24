/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `nodes` and `screens` step-label reads match the session's locale tag
 * the way the flow label (`translateFlow`) and an approval step's label
 * (`resolveFlowApprovalStepLabel`) do: BCP-47 tags are case-insensitive, so a
 * `zh-cn` session reads a bundle keyed `zh-CN`. The exact-key read is
 * unchanged, and a locale the bundle does not carry still answers nothing.
 */

import { describe, expect, it } from 'vitest';
import type { TranslationBundle } from '@objectstack/spec/system';
import { flowLabelTranslations } from '../flowLabels';

const FLOW = 'deal_review';
const plainNode = { id: 'score_deal', type: 'script' };
const untitledScreen = { id: 'collect_notes', type: 'screen', config: {} };

const bundle = {
  'zh-CN': {
    flows: {
      [FLOW]: {
        label: '交易审核',
        nodes: { score_deal: { label: '评分' } },
        screens: { collect_notes: { title: '填写备注' } },
      },
    },
  },
} as unknown as TranslationBundle;

describe('flowLabels: nodes and screens step labels match the locale tag like the flow label', () => {
  it('a zh-cn session reads the zh-CN row for a plain node label and an untitled screen title', () => {
    const t = flowLabelTranslations(bundle, FLOW, 'zh-cn');
    expect(t?.flowLabel).toBe('交易审核');
    expect(t?.stepLabel(plainNode)).toBe('评分');
    expect(t?.stepLabel(untitledScreen)).toBe('填写备注');
    expect(t?.screenTitle(untitledScreen)).toBe('填写备注');
  });

  it('the exact-key session still reads as before', () => {
    const t = flowLabelTranslations(bundle, FLOW, 'zh-CN');
    expect(t?.stepLabel(plainNode)).toBe('评分');
    expect(t?.stepLabel(untitledScreen)).toBe('填写备注');
    expect(t?.screenTitle(untitledScreen)).toBe('填写备注');
  });

  it('a locale the bundle does not carry answers nothing', () => {
    const t = flowLabelTranslations(bundle, FLOW, 'fr');
    expect(t?.flowLabel).toBeUndefined();
    expect(t?.stepLabel(plainNode)).toBeUndefined();
    expect(t?.stepLabel(untitledScreen)).toBeUndefined();
  });
});
