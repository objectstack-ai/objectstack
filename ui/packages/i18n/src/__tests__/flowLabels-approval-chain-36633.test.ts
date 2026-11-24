/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An approval step's console label is read through the spec's
 * `resolveFlowApprovalStepLabel` — the resolver the server's approval reader
 * uses — with the same resolve options the console hands `translateFlow` for
 * the flow's own label. So for one bundle and one set of options, console and
 * server answer the same text, a miss included.
 */

import { describe, expect, it } from 'vitest';
import { resolveFlowApprovalStepLabel, type TranslationBundle } from '@objectstack/spec/system';
import { flowLabelTranslations } from '../flowLabels';
import { activeFlowsBundle } from '../flowsBundle';

const FLOW = 'deal_review';
const approval = { id: 'manager_sign_off', type: 'approval' };

const bundle = {
  'zh-CN': { flows: { [FLOW]: { label: '交易审核', approvals: { manager_sign_off: { label: '经理审批' } } } } },
  en: { flows: { [FLOW]: { label: 'Deal review', approvals: { manager_sign_off: { label: 'Manager sign-off' } } } } },
  fr: { flows: { [FLOW]: { label: 'Revue' } } },
} as unknown as TranslationBundle;

function consoleLabel(language: string, b: TranslationBundle = bundle) {
  return flowLabelTranslations(b, FLOW, language)?.stepLabel(approval);
}

function serverLabel(language: string, b: TranslationBundle = bundle) {
  return resolveFlowApprovalStepLabel(b, FLOW, approval.id, undefined, { locale: language });
}

describe('flowLabels: an approval step label reads through resolveFlowApprovalStepLabel', () => {
  it('answers the entry the requested locale carries, as the resolver does', () => {
    expect(consoleLabel('zh-CN')).toBe('经理审批');
    expect(consoleLabel('zh-CN')).toBe(serverLabel('zh-CN'));
  });

  it('matches the locale tag the way the resolver does, as the flow label already did', () => {
    // BCP-47 tags are case-insensitive: the resolver reaches the `zh-CN` row
    // for `zh-cn`, and so does `translateFlow` for the flow label.
    const t = flowLabelTranslations(bundle, FLOW, 'zh-cn');
    expect(t?.flowLabel).toBe('交易审核');
    expect(t?.stepLabel(approval)).toBe('经理审批');
    expect(t?.stepLabel(approval)).toBe(serverLabel('zh-cn'));
  });

  it('a locale missing the entry falls back the same way as the resolver under the same options', () => {
    // No declared fallback chain at this call site: a miss answers nothing, so
    // the drawing keeps the authored label — never another locale's row.
    expect(consoleLabel('fr')).toBeUndefined();
    expect(consoleLabel('fr')).toBe(serverLabel('fr'));
    expect(consoleLabel('de')).toBeUndefined();
    expect(consoleLabel('de')).toBe(serverLabel('de'));
  });

  it('answers nothing through the active-language bundle when that language lacks the entry', () => {
    const i18n = {
      getResourceBundle: (lng: string) =>
        lng === 'fr' ? { app: { flows: { [FLOW]: { label: 'Revue' } } } } : undefined,
    };
    const active = activeFlowsBundle(i18n, 'fr', FLOW);
    expect(active).toBeDefined();
    const t = flowLabelTranslations(active, FLOW, 'fr');
    expect(t?.flowLabel).toBe('Revue');
    expect(t?.stepLabel(approval)).toBeUndefined();
    expect(t?.stepLabel(approval)).toBe(serverLabel('fr', active));
  });

  it('answers nothing for a node id that names an Object.prototype member', () => {
    expect(flowLabelTranslations(bundle, FLOW, 'en')?.stepLabel({ id: 'toString', type: 'approval' })).toBeUndefined();
  });
});
