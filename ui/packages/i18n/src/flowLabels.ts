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
 *  - any other node, a screen that authors its own `config.title` included:
 *    `flows.<flow>.nodes.<node_id>.label` (ruling 7076440876). Such a screen is
 *    titled apart from its label, so its label is keyed like any other step's.
 *
 * An untitled screen's translated title is a run-time template: one holding a
 * `{{ }}` hole a drawing cannot fill is not a step name, so `stepLabel`
 * answers nothing for it and the drawing keeps the authored label.
 *
 * The Studio flow designer and the docs viewer's `type: flow` embed
 * (`element:metadata_viewer`) both read them here. The flow label goes
 * through the spec's `translateFlow`, the runner's resolution path, and an
 * approval step's label through the spec's `resolveFlowApprovalStepLabel`,
 * the server's approval reader's resolution path, both with the same resolve
 * options, so no two surfaces can disagree about what a flow or an approval
 * step is called. An edge label
 * has no key and stays the authored text.
 *
 * Display only: nothing here rewrites the flow, so an editor keeps working on
 * the authored label.
 */

import {
  resolveBundleLocale,
  resolveFlowApprovalStepLabel,
  translateFlow,
  type ResolveOptions,
  type TranslationBundle,
} from '@objectstack/spec/system';
import { useObjectTranslation } from './provider.js';
import { activeFlowsBundle, flowsLocaleChain, flowsResolveOptions } from './flowsBundle.js';

/** A flow's translated labels in one language. Every member answers `undefined` where the bundle carries nothing. */
export interface FlowLabelTranslations {
  /** `flows.<flow>.label`. */
  flowLabel?: string;
  /**
   * The step's translated label: `approvals.<node_id>.label` for an `approval`,
   * `screens.<node_id>.title` for an untitled `screen` (unless it holds a
   * `{{ }}` hole), `nodes.<node_id>.label` for any other node, a titled screen
   * included. `undefined` for an id-less node.
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
 * resolution path, and an approval step's label through the spec's
 * `resolveFlowApprovalStepLabel`, the server's; both are asked with the same
 * options: `{ locale: language }` plus the server's declared `fallbackChain`
 * and `defaultLocale` (and the negotiated `locale`) when `declared` carries
 * them ({@link flowsResolveOptions},
 * objectstack#36809), so a label the active language lacks reads the declared
 * fallback locale's text before the authored one, as on the server. Any other
 * step label is the spec-typed address of the node's name (see the module
 * note), read by node type out of the bundle rows the same locale walk visits
 * ({@link flowsLocaleChain}, each tag matched by `resolveBundleLocale`).
 */
export function flowLabelTranslations(
  bundle: TranslationBundle | undefined,
  flowName: string,
  language: string,
  declared?: Pick<ResolveOptions, 'locale' | 'fallbackChain' | 'defaultLocale'>,
): FlowLabelTranslations | undefined {
  if (!bundle || !flowName) return undefined;
  // `declared.locale` is the language as the server negotiated it, when the
  // loader recorded one (`flowsResolveOptions`); else `language` as it is.
  const resolveOptions: ResolveOptions = { ...declared, locale: declared?.locale ?? language };
  const flowLabel = translateFlow<{ name: string; label?: string }>({ name: flowName }, bundle, resolveOptions).label;
  // The `nodes` and `screens` reads walk the locales the resolvers above walk
  // (`flowsLocaleChain`), each tag matched by the spec's one locale ladder
  // (`resolveBundleLocale`): a `zh-cn` session reads a `zh-CN` row, and a key
  // that row lacks reads the declared fallback locale's row.
  const flows = flowsLocaleChain(resolveOptions)
    .map((code) => resolveBundleLocale(bundle, code))
    .map((locale) => (locale === undefined ? undefined : bundle[locale]?.flows?.[flowName]));
  const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
  const first = <T,>(read: (flow: NonNullable<(typeof flows)[number]>) => T | undefined): T | undefined => {
    for (const flow of flows) {
      if (!flow) continue;
      const value = read(flow);
      if (value !== undefined) return value;
    }
    return undefined;
  };
  return {
    flowLabel: text(flowLabel),
    stepLabel: (node) => {
      if (typeof node.id !== 'string' || !node.id) return undefined;
      if (node.type === 'approval') {
        return text(resolveFlowApprovalStepLabel(bundle, flowName, node.id, undefined, resolveOptions));
      }
      if (node.type === 'screen') {
        const config = node.config && typeof node.config === 'object' ? (node.config as { title?: unknown }) : {};
        if (config.title === undefined || config.title === null || config.title === '') {
          const id = node.id;
          const title = first((flow) => text(flow.screens?.[id]?.title));
          return title?.includes('{{') ? undefined : title;
        }
      }
      const id = node.id;
      return first((flow) => text(flow.nodes?.[id]?.label));
    },
    screenTitle: (node) => {
      if (node.type !== 'screen' || typeof node.id !== 'string' || !node.id) return undefined;
      const id = node.id;
      return first((flow) => text(flow.screens?.[id]?.title));
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
  return flowLabelTranslations(
    activeFlowsBundle(i18n, language, flowName),
    flowName,
    language,
    flowsResolveOptions(i18n, language),
  );
}
