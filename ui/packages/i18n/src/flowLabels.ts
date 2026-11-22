/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The two flow labels a surface that DRAWS a flow resolves from the app's
 * `flows` translation group (`activeFlowsBundle`, `flowsBundle.ts`): the
 * flow's own label (`flows.<flow>.label`) and an `approval` node's step label
 * (`flows.<flow>.approvals.<node_id>.label`).
 *
 * The Studio flow designer and the docs viewer's `type: flow` embed
 * (`element:metadata_viewer`) both read them here, and the flow label goes
 * through the spec's `translateFlow`, the runner's resolution path, so no two
 * surfaces can disagree about what a flow or a step is called.
 *
 * Only those two keys exist in the spec's `flows` group for a label a flow
 * drawing shows. A start, decision, notify or end node's label and an edge
 * label have no key, so they stay the authored text.
 *
 * Display only: nothing here rewrites the flow, so an editor keeps working on
 * the authored label.
 */

import { translateFlow, type TranslationBundle } from '@objectstack/spec/system';
import { useObjectTranslation } from './provider.js';
import { activeFlowsBundle } from './flowsBundle.js';

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
