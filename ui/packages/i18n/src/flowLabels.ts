/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An app's `flows` translation group, read back out of the i18next resource
 * tree the host already loaded, and the two flow labels a surface that DRAWS a
 * flow resolves from it: the flow's own label (`flows.<flow>.label`) and an
 * `approval` node's step label (`flows.<flow>.approvals.<node_id>.label`).
 *
 * This is the ONE reader of that group in the UI. It lives here, beside the
 * provider whose resource tree it reads, so every surface reads it the same
 * way: the console's `FlowRunner` and flow-launch hosts, the Studio flow
 * designer, and the docs viewer's `type: flow` embed
 * (`element:metadata_viewer`). None of them can disagree about where the
 * bundle lives or what a flow is called.
 *
 * The provider's `loadLanguage` hands the app's translation payload to
 * i18next (`transformSpecTranslations` forwards `flows` verbatim under the app
 * namespace), so there is no second loader.
 *
 * Only those two keys exist in the spec's `flows` group for a label a flow
 * drawing shows. A decision, notify, start or end node's label and an edge
 * label have no key, so they stay the authored text.
 *
 * Display only: nothing here rewrites the flow, so an editor keeps working on
 * the authored label.
 */

import { translateFlow, type TranslationBundle, type TranslationData } from '@objectstack/spec/system';
import { useObjectTranslation } from './provider.js';

/** The `flows` group of a spec `TranslationData` — typed by the spec, so the address below is checked against it. */
export type FlowsTranslation = NonNullable<TranslationData['flows']>;

/**
 * The one member of the i18next instance the bundle read needs. Optional,
 * because outside a provider react-i18next hands back a placeholder object
 * that has none — and then there is no bundle, only the authored copy.
 */
export interface TranslationResourceReader {
  getResourceBundle?: (lng: string, ns: string) => unknown;
}

/**
 * The active language's `flows` group as a spec `TranslationBundle`, or
 * `undefined` when the resource tree translates nothing for `flowName`.
 *
 * App translations sit under an app namespace at the top of that tree (`app`
 * for a spec payload, whatever the payload named for an already-namespaced
 * one), so the first namespace whose `flows` group addresses this flow is the
 * one read. The bundle is keyed by `language` itself, and the resolvers are
 * asked for `language` with no fallback chain: a string the active language
 * does not carry falls back to the author's copy, never to a third locale.
 */
export function activeFlowsBundle(
  i18n: TranslationResourceReader | undefined,
  language: string,
  flowName: string,
): TranslationBundle | undefined {
  if (!flowName || typeof i18n?.getResourceBundle !== 'function') return undefined;
  const tree = i18n.getResourceBundle(language, 'translation');
  if (!tree || typeof tree !== 'object') return undefined;
  for (const namespace of Object.values(tree as Record<string, unknown>)) {
    const flows = (namespace as { flows?: unknown } | null)?.flows;
    if (flows && typeof flows === 'object' && (flows as Record<string, unknown>)[flowName]) {
      return { [language]: { flows: flows as FlowsTranslation } };
    }
  }
  return undefined;
}

/** A flow's translated labels in one language. Every member answers `undefined` where the bundle carries nothing. */
export interface FlowLabelTranslations {
  /** `flows.<flow>.label`. */
  flowLabel?: string;
  /** `flows.<flow>.approvals.<node_id>.label`, for an `approval` node only. */
  stepLabel: (node: { id?: unknown; type?: unknown }) => string | undefined;
}

/**
 * The translated labels for `flowName` out of `bundle` in `language`, or
 * `undefined` when there is no bundle (nothing to translate with).
 *
 * The flow label goes through the spec's `translateFlow`, the runner's
 * resolution path; the step label is the spec-typed address
 * `flows.<flow>.approvals.<node_id>.label`, read for `approval` nodes only.
 */
export function flowLabelTranslations(
  bundle: TranslationBundle | undefined,
  flowName: string,
  language: string,
): FlowLabelTranslations | undefined {
  if (!bundle || !flowName) return undefined;
  const flowLabel = translateFlow<{ name: string; label?: string }>({ name: flowName }, bundle, { locale: language }).label;
  const approvals = bundle[language]?.flows?.[flowName]?.approvals;
  return {
    flowLabel: typeof flowLabel === 'string' && flowLabel ? flowLabel : undefined,
    stepLabel: (node) => {
      if (node.type !== 'approval' || typeof node.id !== 'string' || !node.id) return undefined;
      const label = approvals?.[node.id]?.label;
      return typeof label === 'string' && label ? label : undefined;
    },
  };
}

/**
 * {@link flowLabelTranslations} for `flowName` in the provider's active
 * language. Recomputed on every render: a handful of property reads that
 * follow the live resource tree and a language switch.
 */
export function useFlowLabelTranslations(flowName: string): FlowLabelTranslations | undefined {
  const { i18n, language } = useObjectTranslation();
  return flowLabelTranslations(activeFlowsBundle(i18n, language, flowName), flowName, language);
}
