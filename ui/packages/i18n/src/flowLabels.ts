/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The flow labels a surface that DRAWS a flow resolves from the app's `flows`
 * translation group (`activeFlowsBundle`, `flowsBundle.ts`): the flow's own
 * label (`flows.<flow>.label`) and each step's label, from the one key the
 * spec gives that step's name:
 *
 *  - an `approval` node: `flows.<flow>.approvals.<node_id>.label`;
 *  - a `screen` node with no `config.title`: `flows.<flow>.screens.<node_id>.title`
 *    (the executor titles such a screen by its label, so one key covers both);
 *  - any other node: `flows.<flow>.nodes.<node_id>.label` (ruling 7076440876).
 *
 * A screen that authors its own `config.title` is titled apart from its label,
 * and its label has no key, so `stepLabel` answers nothing for it.
 *
 * The Studio flow designer and the docs viewer's `type: flow` embed
 * (`element:metadata_viewer`) both read them here, and the flow label goes
 * through the spec's `translateFlow`, the runner's resolution path, so no two
 * surfaces can disagree about what a flow or a step is called. An edge label
 * has no key and stays the authored text.
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
  /**
   * The step's translated label: `approvals.<node_id>.label` for an `approval`,
   * `screens.<node_id>.title` for an untitled `screen`, `nodes.<node_id>.label`
   * for any other node. `undefined` for a titled screen and an id-less node.
   */
  stepLabel: (node: { id?: unknown; type?: unknown; config?: unknown }) => string | undefined;
  /**
   * `flows.<flow>.screens.<node_id>.title` for a `screen` node, titled or not:
   * the translated heading the screen shows at run time. A drawing that names
   * a titled screen by its heading reads it here.
   */
  screenTitle: (node: { id?: unknown; type?: unknown }) => string | undefined;
}

/**
 * The translated labels for `flowName` out of `bundle` in `language`, or
 * `undefined` when there is no bundle (nothing to translate with).
 *
 * The flow label goes through the spec's `translateFlow`, the runner's
 * resolution path; the step label is the spec-typed address of the node's
 * name (see the module note), read by node type.
 */
export function flowLabelTranslations(
  bundle: TranslationBundle | undefined,
  flowName: string,
  language: string,
): FlowLabelTranslations | undefined {
  if (!bundle || !flowName) return undefined;
  const flowLabel = translateFlow<{ name: string; label?: string }>({ name: flowName }, bundle, { locale: language }).label;
  const flow = bundle[language]?.flows?.[flowName];
  const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
  return {
    flowLabel: text(flowLabel),
    stepLabel: (node) => {
      if (typeof node.id !== 'string' || !node.id) return undefined;
      if (node.type === 'approval') return text(flow?.approvals?.[node.id]?.label);
      if (node.type === 'screen') {
        const config = node.config && typeof node.config === 'object' ? (node.config as { title?: unknown }) : {};
        return config.title === undefined || config.title === null || config.title === ''
          ? text(flow?.screens?.[node.id]?.title)
          : undefined;
      }
      return text(flow?.nodes?.[node.id]?.label);
    },
    screenTitle: (node) =>
      node.type === 'screen' && typeof node.id === 'string' && node.id ? text(flow?.screens?.[node.id]?.title) : undefined,
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
