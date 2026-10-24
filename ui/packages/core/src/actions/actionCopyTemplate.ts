/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { templateEngine } from '@objectstack/formula';

/**
 * An action's person-facing copy slot — `confirmText`, `successMessage`,
 * `errorMessage` — as it can reach the runner: a string, or ADR-0032's
 * `template` envelope.
 *
 * Two arms, because the protocol is moving these slots to the `template`
 * dialect (objectstack#24814, ruling A): there a bare string is shorthand for
 * `{ dialect: 'template', source }`, and a parsed definition carries the
 * envelope. The renderer moves first (objectui#13367), so both arms are read
 * here before the spec types the slot. `source` is optional, as on the
 * protocol's `Expression`: a parsed slot may carry its `ast` instead, and then
 * there is no text to show. The same shape the bulk `confirmText` reader
 * (`bulkConfirmTextSource` in plugin-grid) and core's `formatTitleTemplate`
 * read.
 */
export type ActionCopyTemplate = string | { dialect?: 'template'; source?: string };

/**
 * Whether `value` is the `template` envelope rather than a plain string or an
 * `I18nLabel` locale map. A locale map's keys are language tags, so neither
 * `dialect` nor `source` is ever one of them.
 */
export function isActionCopyEnvelope(
  value: unknown,
): value is { dialect?: 'template'; source?: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (value as { dialect?: unknown }).dialect === 'template'
    || Object.prototype.hasOwnProperty.call(value, 'source');
}

/**
 * The text a copy slot carries: the string itself, or the envelope's
 * `source`, as written. `undefined` for anything else — an envelope with no
 * string `source`, a number, an object that reached the runner without
 * passing through a localizer — so no caller hands a non-string to a toast or
 * a dialog (the React #31 crash).
 */
export function actionCopySource(copy: unknown): string | undefined {
  if (typeof copy === 'string') return copy;
  if (isActionCopyEnvelope(copy) && typeof copy.source === 'string') return copy.source;
  return undefined;
}

/** A `{{ … }}` hole, as the template engine delimits one. */
const TEMPLATE_HOLE = /\{\{[^}]*\}\}/;

/**
 * Whether `text` carries a `{{ }}` hole, which makes it a `template`-dialect
 * sentence. The runner reads ONE dialect per sentence: a sentence with a
 * `{{ }}` hole is filled by the template engine alone, and one without keeps
 * the transitional `${…}` reading. So a value filled into a hole is never read
 * a second time as a `${…}` expression.
 */
export function hasTemplateHoles(text: string): boolean {
  return TEMPLATE_HOLE.test(text);
}

/**
 * Fill the `{{ path }}` / `{{ path | formatter }}` holes of `source` over
 * `roots`, through `@objectstack/formula`'s `templateEngine` — the engine the
 * flow notifications render with, and the one objectui#13183 names for the
 * bulk `confirmText`. ⛔ No second hole grammar here.
 *
 * `roots` is the slot's whole scope: a hole naming anything else prints empty,
 * as an unbound path does in every template. A source the engine refuses (an
 * unbalanced delimiter, logic inside a hole) is returned as written: the
 * publish gate refuses it on the server side, and the user still reads the
 * author's sentence rather than nothing.
 */
export function fillTemplateHoles(source: string, roots: Record<string, unknown>): string {
  const filled = templateEngine.evaluate<string>({ dialect: 'template', source }, { extra: roots });
  return filled.ok && typeof filled.value === 'string' ? filled.value : source;
}
