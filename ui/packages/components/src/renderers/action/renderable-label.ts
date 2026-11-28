/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The one label guard every action renderer in this directory reads its label
 * through: `action:button`, `action:menu`, `action:group`, `action:icon`, and
 * the static-params warning. One module, so the four renderers cannot drift
 * into four answers to the same off-contract value.
 */

/** Components already warned about a non-string label, so each warns once. */
const warnedNonStringLabel = new Set<string>();

/**
 * The label a renderer may print: the contract's `label` is `z.string()`, and
 * a string is returned as it came. Anything else — typically an inline locale
 * map from metadata that never passed `validateComponentProps` — is returned as
 * `undefined`, so the renderer renders no text instead of throwing "Objects are
 * not valid as a React child" or printing `[object Object]`. The value is never
 * translated here: localization is the translation bundle's entry for the
 * component id, and a value the contract refuses is not given a meaning.
 * A development build warns once per component.
 *
 * `componentType` names the renderer in the warning; it defaults to
 * `action:button`, the renderer this guard was written for.
 */
export function renderableLabel(
  label: unknown,
  componentKey: string,
  componentType = 'action:button',
): string | undefined {
  if (label == null || typeof label === 'string') return label ?? undefined;
  const memo = `${componentType}:${componentKey}`;
  if (process.env.NODE_ENV !== 'production' && !warnedNonStringLabel.has(memo)) {
    warnedNonStringLabel.add(memo);
    console.warn(
      `[object-ui] ${componentType} "${componentKey}" has a non-string label (${Array.isArray(label) ? 'array' : typeof label}); ` +
        'the label was not rendered. The label must be a string: localize it through the translation bundle entry ' +
        'pages.PAGE.components.COMPONENT_ID.label, not an inline locale map.',
    );
  }
  return undefined;
}

/**
 * `subject` with its label passed through `renderableLabel`: the SAME object
 * when the label is a string or absent, otherwise a copy whose `label` is
 * `undefined`. For a renderer that hands the whole action on (to a leaf, to the
 * runner, to `useAutoTriggerOnce`), so every downstream read sees the guarded
 * label and none has to repeat the guard.
 */
export function withRenderableLabel<T extends { label?: unknown }>(
  subject: T,
  componentKey: string,
  componentType: string,
): T {
  const label = renderableLabel(subject.label, componentKey, componentType);
  return label === subject.label ? subject : { ...subject, label };
}
