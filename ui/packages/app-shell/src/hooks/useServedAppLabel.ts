/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * useServedAppLabel — what an app is called, and how it describes itself, on
 * every console surface that names an app (objectstack#30311).
 *
 * An app the `/meta/app` read served is already translated: `translateApp` in
 * `@objectstack/spec` writes its `label` and `description` for the request's
 * locale, and for an overridden app (a `.custom` pair) in the ruled label
 * order, the override's own text kept over the base package's translation
 * (objectstack#30353). So a served label is drawn as given. Running the
 * client bundle's `apps.<name>.label` lookup over it was a second translation
 * pass in which the base package's string won a rename back.
 *
 * The bundle (`useObjectLabel().appLabel` / `appDescription`) is asked only
 * for text no server translated: a pending draft under `?preview=draft`
 * (the item carries `_draft: true`), a keyed label (`{ key, defaultValue }`,
 * resolved through `t` as before), or an app with no label or description at
 * all. An unedited app reads the same text as before, because the server
 * serves the bundle's translation for it.
 */

import { useCallback, useMemo } from 'react';
import { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import { resolveKeyedI18nLabel } from '../utils/index.js';
import { metadataText } from './useNavTargetLabel.js';

/** The members of an app record this hook reads. */
export interface ServedAppSource {
  name: string;
  label?: unknown;
  description?: unknown;
  _draft?: unknown;
}

type KeyedLabel = { key: string; defaultValue?: string; params?: Record<string, any> };

/** A console-keyed label (`{ key, defaultValue }`): a key, not served text. */
function isKeyedLabel(value: unknown): value is KeyedLabel {
  return !!value && typeof value === 'object' && typeof (value as { key?: unknown }).key === 'string';
}

/** `label` / `description` as the server translated it, or `undefined` when it served none. */
function servedText(app: ServedAppSource, value: unknown, language: string | undefined): string | undefined {
  if (app._draft === true || isKeyedLabel(value)) return undefined;
  return metadataText(value, language);
}

/** The bundle's input for a value that is not served text: a keyed label through `t`, else a plain string. */
function bundleFallback(value: unknown, t: (key: string, options?: any) => string): string | undefined {
  if (isKeyedLabel(value)) return resolveKeyedI18nLabel(value, t);
  return typeof value === 'string' ? value : undefined;
}

export interface ServedAppLabels {
  /** The app's display name: the served label, else the bundle's. */
  appLabel: (app: ServedAppSource) => string;
  /** The app's description: the served one, else the bundle's; `undefined` when neither names one. */
  appDescription: (app: ServedAppSource) => string | undefined;
}

export function useServedAppLabel(): ServedAppLabels {
  const { language, t } = useObjectTranslation();
  const { appLabel: bundleAppLabel, appDescription: bundleAppDescription } = useObjectLabel();

  const appLabel = useCallback(
    (app: ServedAppSource) =>
      servedText(app, app.label, language)
        ?? bundleAppLabel({ name: app.name, label: bundleFallback(app.label, t) }),
    [language, t, bundleAppLabel],
  );
  const appDescription = useCallback(
    (app: ServedAppSource) =>
      servedText(app, app.description, language)
        ?? bundleAppDescription({ name: app.name, description: bundleFallback(app.description, t) }),
    [language, t, bundleAppDescription],
  );
  return useMemo(() => ({ appLabel, appDescription }), [appLabel, appDescription]);
}
