// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The flow designer's reading of a package's `flows` translations: the flow's
 * own label (`flows.<flow>.label`) and an `approval` node's step label
 * (`flows.<flow>.approvals.<node_id>.label`), in the viewer's language.
 *
 * The bundle is the one `FlowRunner` reads, `activeFlowsBundle` over the
 * i18next resource tree the console already loaded, and the flow label goes
 * through the spec's `translateFlow`, the runner's resolution path. So the
 * designer and the runner cannot disagree about a flow's name, and there is no
 * second loader.
 *
 * Only those two keys exist in the spec's `flows` group for a label the
 * designer draws. A decision or other node's label and an edge label have no
 * key, so they stay the authored text.
 *
 * Display only: the draft is never rewritten with a translation, so an edit,
 * a rename or a save keeps working on the authored label. Studio is the
 * authoring surface, so the inspector also shows the authored label beside a
 * translation (`flowSelectionHeading`'s `source`).
 */

import * as React from 'react';
import { useObjectTranslation } from '@object-ui/react';
import { translateFlow, type TranslationBundle } from '@objectstack/spec/system';
import { activeFlowsBundle } from '../../../utils/flowsBundle.js';

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
 */
export function flowLabelTranslations(
  bundle: TranslationBundle | undefined,
  flowName: string,
  language: string,
): FlowLabelTranslations | undefined {
  if (!bundle || !flowName) return undefined;
  const flowLabel = translateFlow({ name: flowName }, bundle, { locale: language }).label;
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
 * {@link flowLabelTranslations} for `flowName` in the console's active
 * language. Recomputed on every render: a handful of property reads that
 * follow the live resource tree and a language switch.
 */
export function useFlowLabelTranslations(flowName: string): FlowLabelTranslations | undefined {
  const { i18n, language } = useObjectTranslation();
  return flowLabelTranslations(activeFlowsBundle(i18n, language, flowName), flowName, language);
}

const FlowLabelTranslationsContext = React.createContext<FlowLabelTranslations | undefined>(undefined);

/** Hands {@link FlowLabelTranslations} to the canvas below it. */
export const FlowLabelTranslationsProvider = FlowLabelTranslationsContext.Provider;

/** The translations the nearest provider hands in, or `undefined` outside one. */
export function useFlowLabelTranslationsContext(): FlowLabelTranslations | undefined {
  return React.useContext(FlowLabelTranslationsContext);
}
