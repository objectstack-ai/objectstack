/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36809 — the console's flow labels follow the server's declared
 * fallback chain.
 *
 * The server resolves a flow label through the spec resolvers with
 * `{ locale, fallbackChain: [getFallbackLocale()], defaultLocale }`. The
 * console's loader lays the declared chain and the fallback locales' `flows`
 * groups beside the active language's tree (`withDeclaredFlowsFallback`), and
 * the readers (`activeFlowsBundle`, `flowsResolveOptions`,
 * `flowLabelTranslations`) hand the resolvers the same options. Pinned:
 *
 *  - with a declared fallback, a label the active language lacks reads the
 *    fallback locale's text, equal to the server's answer for the same bundle
 *    and options, for every label the readers serve (flow, approval step,
 *    plain node, untitled screen);
 *  - with no declared chain, nothing changes: the active language, then
 *    nothing (the caller keeps the authored label);
 *  - a request in the authored language walks no chain, as on the server;
 *  - the walk the readers run for the keys no spec resolver reads
 *    (`flowsLocaleChain`) visits the locales the resolvers visit.
 */

import { describe, expect, it } from 'vitest';
import {
  resolveFlowApprovalStepLabel,
  translateFlow,
  type ResolveOptions,
  type TranslationBundle,
} from '@objectstack/spec/system';
import { createI18n } from '../i18n';
import { flowLabelTranslations } from '../flowLabels';
import {
  activeFlowsBundle,
  DECLARED_FLOWS_FALLBACK_KEY,
  flowsLocaleChain,
  flowsResolveOptions,
  withDeclaredFlowsFallback,
  type FlowsTranslation,
  type TranslationResourceReader,
} from '../flowsBundle';

const FLOW = 'deal_review';
const approval = { id: 'manager_ok', type: 'approval' };
const plainNode = { id: 'score_deal', type: 'script' };
const untitledScreen = { id: 'collect_notes', type: 'screen', config: {} };

/** The active language (fr) translates only the plain node. */
const FR_FLOWS = { [FLOW]: { nodes: { score_deal: { label: 'Noter' } } } } as unknown as FlowsTranslation;
/** The declared fallback (en) translates everything. */
const EN_FLOWS = {
  [FLOW]: {
    label: 'Deal review',
    approvals: { manager_ok: { label: 'Manager approval' } },
    nodes: { score_deal: { label: 'Score' } },
    screens: { collect_notes: { title: 'Collect notes' } },
  },
} as unknown as FlowsTranslation;

/** What the server holds and resolves against: every locale's bundle. */
const SERVER_BUNDLE = { fr: { flows: FR_FLOWS }, en: { flows: EN_FLOWS } } as unknown as TranslationBundle;
const SERVER_OPTIONS: ResolveOptions = { locale: 'fr', fallbackChain: ['en'], defaultLocale: 'zh-CN' };

/** A reader whose `fr` tree is what the console's loader hands the provider. */
function reader(trees: Record<string, Record<string, unknown>>): TranslationResourceReader {
  return { getResourceBundle: (lng: string) => trees[lng] };
}

const declaredTree = withDeclaredFlowsFallback(
  { app: { flows: FR_FLOWS } },
  { fallbackChain: ['en'], defaultLocale: 'zh-CN', bundles: { en: { flows: EN_FLOWS } } },
);
const undeclaredTree = withDeclaredFlowsFallback({ app: { flows: FR_FLOWS } }, undefined);

function consoleLabels(i18n: TranslationResourceReader, language: string) {
  return flowLabelTranslations(activeFlowsBundle(i18n, language, FLOW), FLOW, language, flowsResolveOptions(i18n, language));
}

describe('console flow labels follow a declared fallback chain (objectstack#36809)', () => {
  it('a label missing in the requested locale reads the fallback locale text, matching the server', () => {
    const t = consoleLabels(reader({ fr: declaredTree }), 'fr');
    // The server's answers, from the spec resolvers with the server's options.
    const serverFlowLabel = translateFlow<{ name: string; label?: string }>({ name: FLOW }, SERVER_BUNDLE, SERVER_OPTIONS).label;
    const serverApproval = resolveFlowApprovalStepLabel(SERVER_BUNDLE, FLOW, approval.id, undefined, SERVER_OPTIONS);
    expect(serverFlowLabel).toBe('Deal review');
    expect(serverApproval).toBe('Manager approval');
    expect(t?.flowLabel).toBe(serverFlowLabel);
    expect(t?.stepLabel(approval)).toBe(serverApproval);
    // The keys no spec resolver reads walk the same locales.
    expect(t?.stepLabel(untitledScreen)).toBe('Collect notes');
    expect(t?.screenTitle(untitledScreen)).toBe('Collect notes');
    // The requested locale still wins where it translates.
    expect(t?.stepLabel(plainNode)).toBe('Noter');
  });

  it('the readers hand the resolvers the server options', () => {
    expect(flowsResolveOptions(reader({ fr: declaredTree }), 'fr')).toEqual(SERVER_OPTIONS);
  });

  it('a flow only the fallback locale translates still yields a bundle', () => {
    const tree = withDeclaredFlowsFallback(
      { app: { flows: {} } },
      { fallbackChain: ['en'], bundles: { en: { flows: EN_FLOWS } } },
    );
    const i18n = reader({ fr: tree });
    expect(activeFlowsBundle(i18n, 'fr', FLOW)).toEqual({ en: { flows: EN_FLOWS } });
    expect(consoleLabels(i18n, 'fr')?.flowLabel).toBe('Deal review');
  });

  it('survives the real i18next store the provider writes into', () => {
    const instance = createI18n({ defaultLanguage: 'fr', detectBrowserLanguage: false });
    instance.addResourceBundle('fr', 'translation', declaredTree, true, true);
    expect(flowsResolveOptions(instance, 'fr')).toEqual(SERVER_OPTIONS);
    expect(consoleLabels(instance, 'fr')?.flowLabel).toBe('Deal review');
  });
});

describe('no declared chain: unchanged (objectstack#36809)', () => {
  it('the requested locale, then nothing — the caller keeps the authored label', () => {
    expect(undeclaredTree).not.toHaveProperty(DECLARED_FLOWS_FALLBACK_KEY);
    const i18n = reader({ fr: undeclaredTree, en: { app: { flows: EN_FLOWS } } });
    expect(flowsResolveOptions(i18n, 'fr')).toEqual({ locale: 'fr' });
    expect(activeFlowsBundle(i18n, 'fr', FLOW)).toEqual({ fr: { flows: FR_FLOWS } });
    const t = consoleLabels(i18n, 'fr');
    expect(t?.flowLabel).toBeUndefined();
    expect(t?.stepLabel(approval)).toBeUndefined();
    expect(t?.stepLabel(untitledScreen)).toBeUndefined();
    expect(t?.stepLabel(plainNode)).toBe('Noter');
  });

  it('an empty declared chain lays nothing', () => {
    expect(withDeclaredFlowsFallback({ app: {} }, { fallbackChain: [], bundles: {} })).toEqual({ app: {} });
  });
});

describe('a request in the authored language walks no chain (objectstack#36809)', () => {
  it('reads its own row, then nothing, as the server does', () => {
    const tree = withDeclaredFlowsFallback(
      { app: { flows: FR_FLOWS } },
      { fallbackChain: ['en'], defaultLocale: 'fr', bundles: { en: { flows: EN_FLOWS } } },
    );
    const t = consoleLabels(reader({ fr: tree }), 'fr');
    const serverOptions: ResolveOptions = { locale: 'fr', fallbackChain: ['en'], defaultLocale: 'fr' };
    expect(translateFlow<{ name: string; label?: string }>({ name: FLOW }, SERVER_BUNDLE, serverOptions).label).toBeUndefined();
    expect(t?.flowLabel).toBeUndefined();
    expect(t?.stepLabel(untitledScreen)).toBeUndefined();
    expect(t?.stepLabel(plainNode)).toBe('Noter');
  });
});

describe('flowsLocaleChain visits the locales the spec resolvers visit (objectstack#36809)', () => {
  // Each locale's row carries a label naming that locale, and only the rows
  // the case lists exist, so the resolver's answer names the first locale its
  // walk found; the chain's first listed locale must be the same one.
  const cases: Array<[string, ResolveOptions, string[]]> = [
    ['no chain', { locale: 'fr' }, ['de', 'en']],
    ['a chain', { locale: 'fr', fallbackChain: ['en'] }, ['de', 'en']],
    ['a two-entry chain', { locale: 'fr', fallbackChain: ['de', 'en'] }, ['en', 'de']],
    ['the authored request', { locale: 'fr', fallbackChain: ['en'], defaultLocale: 'FR' }, ['en']],
    ['a chain naming the request', { locale: 'en', fallbackChain: ['en'] }, ['en']],
  ];
  it.each(cases)('%s', (_label, options, rows) => {
    const bundle = Object.fromEntries(
      rows.map((code) => [code, { flows: { [FLOW]: { approvals: { manager_ok: { label: code } } } } }]),
    ) as unknown as TranslationBundle;
    const resolved = resolveFlowApprovalStepLabel(bundle, FLOW, approval.id, undefined, options);
    const walked = flowsLocaleChain(options).find((code) => rows.includes(code));
    expect(walked).toBe(resolved);
  });
});
