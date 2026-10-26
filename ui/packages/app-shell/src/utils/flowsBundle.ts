/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The app's `flows` translation group, read back out of the i18next resource
 * tree the console already loaded — the ONE reader of that group in the
 * console. Module-internal (not re-exported from `utils/index` or the package
 * entry).
 *
 * Three surfaces read it, all for the flow a run belongs to: `FlowRunner`
 * (the paused screen's field copy and option labels, the flow's label, the
 * resume's terminal toasts) and the two flow-LAUNCH hosts through
 * `launchConsoleFlow` (a straight-through run's terminal toasts,
 * objectui#12075). They read it through this module so the three cannot
 * disagree about where the bundle lives.
 *
 * The provider's `loadLanguage` hands the app's translation payload to
 * i18next (`transformSpecTranslations` forwards `flows` verbatim under the app
 * namespace), so there is no second loader.
 */

import type { TranslationBundle, TranslationData } from '@objectstack/spec/system';

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
