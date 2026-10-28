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
 * sentence. A sentence with a `{{ }}` hole is filled by the template engine
 * alone; one without is shown as written — the transitional `${…}` reading it
 * used to get is retired (objectui#13476). So no `${…}` token in this copy is
 * ever read as an expression, and a value filled into a hole is never read a
 * second time.
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
 *
 * `locale` is the viewer's display locale (a BCP-47 tag) the formatters render
 * in, passed by the caller that already has it — ⛔ never resolved here. It
 * rides the engine's reserved `locale` channel, apart from `roots`, so a root
 * named `locale` (a param of that name) is a value a hole prints, not the
 * locale of the whole sentence (objectstack#26232). Omitted, the engine
 * formats in `en-US`.
 *
 * `currency` is the tenant default currency (`localization.currency`, the
 * code `useLocalization()` holds), passed the same way and on its own reserved
 * channel: a `{{ amount | currency }}` hole with no argument formats in it.
 * Omitted, the engine refuses such a sentence and it is returned as written,
 * like any sentence the engine refuses — never with a guessed currency.
 *
 * A refused sentence is shown as written, and the engine's refusal — which
 * names the hole and the remedy (for a missing default: set
 * `localization.currency`, or write `currency:CODE`) — goes to
 * `console.warn`, once per distinct refusal, so it reaches whoever reads the
 * console rather than nobody.
 */
export function fillTemplateHoles(
  source: string,
  roots: Record<string, unknown>,
  locale?: string,
  currency?: string,
): string {
  const filled = templateEngine.evaluate<string>(
    { dialect: 'template', source },
    { extra: roots, locale, ...(currency ? { currency } : {}) },
  );
  if (filled.ok && typeof filled.value === 'string') return filled.value;
  if (!filled.ok) warnRefusedCopy(source, filled.error.message);
  return source;
}

/** Refusals already logged, so a dialog that re-renders does not repeat one. */
const warnedRefusals = new Set<string>();

function warnRefusedCopy(source: string, refusal: string): void {
  const key = `${source}\u0000${refusal}`;
  if (warnedRefusals.has(key)) return;
  if (warnedRefusals.size >= 200) warnedRefusals.clear();
  warnedRefusals.add(key);
  console.warn(`[action copy] the sentence "${source}" is shown as written: ${refusal}`);
}
