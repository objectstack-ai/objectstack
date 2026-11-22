// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The flow designer's reading of a package's `flows` translations: the flow's
 * own label (`flows.<flow>.label`) and an `approval` node's step label
 * (`flows.<flow>.approvals.<node_id>.label`), in the viewer's language.
 *
 * The resolution itself is `@object-ui/i18n`'s (`flowLabelTranslations` over
 * `activeFlowsBundle`), the one the runner and the docs viewer's flow embed
 * read too, so no two surfaces can disagree about a flow's name and there is
 * no second loader. This module adds only what the designer needs on top:
 * a per-row reader for the Automations rail and a context that hands the
 * translations to the canvas.
 *
 * Display only: the draft is never rewritten with a translation, so an edit,
 * a rename or a save keeps working on the authored label. Studio is the
 * authoring surface, so the inspector also shows the authored label beside a
 * translation (`flowSelectionHeading`'s `source`).
 */

import * as React from 'react';
import { useObjectTranslation } from '@object-ui/react';
import {
  activeFlowsBundle,
  flowLabelTranslations,
  type FlowLabelTranslations,
} from '@object-ui/i18n';

export { flowLabelTranslations, useFlowLabelTranslations, type FlowLabelTranslations } from '@object-ui/i18n';

/**
 * The flow label of any flow, by name, for a surface that lists many: the
 * Automations rail names each row by it. Each call is
 * {@link flowLabelTranslations}' `flowLabel` in the console's active language,
 * the reading the designer header makes for the open flow, so a row and the
 * flow it opens cannot disagree. `undefined` where the bundle carries no label
 * for that flow, and the caller keeps the authored label. A fresh function on
 * every render: a handful of property reads that follow the live resource tree
 * and a language switch.
 */
export function useFlowLabelOf(): (flowName: string) => string | undefined {
  const { i18n, language } = useObjectTranslation();
  return (flowName) => flowLabelTranslations(activeFlowsBundle(i18n, language, flowName), flowName, language)?.flowLabel;
}

const FlowLabelTranslationsContext = React.createContext<FlowLabelTranslations | undefined>(undefined);

/** Hands {@link FlowLabelTranslations} to the canvas below it. */
export const FlowLabelTranslationsProvider = FlowLabelTranslationsContext.Provider;

/** The translations the nearest provider hands in, or `undefined` outside one. */
export function useFlowLabelTranslationsContext(): FlowLabelTranslations | undefined {
  return React.useContext(FlowLabelTranslationsContext);
}
