/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The runtime half of objectui#8762: an `inputType` authored on the `email` /
 * `password` NODE shorthands never reaches the DOM, while the two neighbours
 * that DO honour the key keep honouring it.
 *
 * ## Why this file exists beside the refusal and not instead of it
 *
 * `@object-ui/types` refuses the key by name (`zod/form.zod.ts#InputShorthandSchema`,
 * pinned in `packages/types/src/__tests__/shorthand-input-type-refusal-8762.test.ts`).
 * That refusal REASONS from a runtime fact — the registration wrapper spreads its
 * own `inputType` last — and `@object-ui/types` cannot render React, so nothing
 * over there could check the reason. Measured on this card's base (681d3f10e),
 * before the refusal landed:
 *
 *     { type: 'password', inputType: 'text' }  ->  <input type="password">   DISCARDED
 *     { type: 'email',    inputType: 'text' }  ->  <input type="email">      DISCARDED
 *     { type: 'input',    inputType: 'text' }  ->  <input type="text">       HONOURED
 *
 * ⚠️ The documents in the first two rows are REFUSED by the validator as of this
 * card. Rendering them here is deliberate and is the point: the refusal is
 * warranted exactly because the runtime ignores what they wrote.
 *
 * ## ⛔ What must NOT be "fixed" to make these pass
 *
 * The cheaper-looking repair is to flip the wrapper's precedence so the author's
 * value wins. That would render `{ type: 'password', inputType: 'text' }` as an
 * UNMASKED field under a `password` key — a secret in clear text, which is worse
 * than refusing the key. If a change makes the first two rows "honour" the
 * authored value, this file is the one that must go red.
 */

import { describe, it, expect } from 'vitest';
import { renderComponent } from '../../../__tests__/test-utils';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout` (objectui#3010/#3021).
import '../../../renderers';

/** The `type` attribute the rendered `<input>` actually carries. */
function renderedInputType(schema: Record<string, unknown>): string | null {
  const { container } = renderComponent(schema as never);
  const input = container.querySelector('input');
  expect(input, `no <input> rendered for ${JSON.stringify(schema)}`).toBeTruthy();
  return input!.getAttribute('type');
}

describe('objectui#8762 — the shorthand wrapper discards an authored `inputType`', () => {
  it.each([
    ['password', 'text'],
    ['password', 'email'],
    ['email', 'text'],
    ['email', 'password'],
  ])('`%s` renders its pinned type, not the authored `%s`', (type, authored) => {
    const rendered = renderedInputType({ type, inputType: authored, name: 'x' });
    expect(rendered).toBe(type);
    expect(rendered, 'the wrapper stopped pinning — see the ⛔ note in this header')
      .not.toBe(authored);
  });

  it.each(['email', 'password'])('`%s` renders its pinned type with nothing authored', (type) => {
    // The baseline the pin is measured against: the wrapper's value is what a
    // correct document gets, and that is unchanged by this card.
    expect(renderedInputType({ type, name: 'x' })).toBe(type);
  });
});

describe('objectui#8762 — the neighbours that DO honour `inputType`', () => {
  it.each(['text', 'email', 'password', 'tel', 'url'])(
    '`input` honours an authored `%s` — the spelling the refusal points at',
    (authored) => {
      // ⭐ THE FIRING CONTROL for the whole card. `{ "type": "input", "inputType":
      // "email" }` is what the refusal's guidance tells the author to write, so a
      // narrowing that also broke it would be worse than the defect it repairs.
      expect(renderedInputType({ type: 'input', inputType: authored, name: 'x' })).toBe(authored);
    },
  );

  it('a form FIELD keeps the OPPOSITE precedence — the carve-out the guidance claims', () => {
    // `renderers/form/form.tsx`: `type={inputType || NATIVE_INPUT_FIELD_TYPES[declaredType] || 'text'}`
    // — at a FIELD position the authored value wins over the one the field type
    // implies. The refusal's message says so, so the sentence is checked here
    // rather than left as prose that can rot. Same two literals, different
    // position, different answer.
    const { container } = renderComponent({
      type: 'form',
      fields: [{ name: 'contact', label: 'Contact', type: 'email', inputType: 'text' }],
    } as never);
    const input = container.querySelector('input[name="contact"], input#contact, input');
    expect(input, 'no field control rendered').toBeTruthy();
    expect(input!.getAttribute('type')).toBe('text');
  });

  it('and a form field with NO authored `inputType` still masks a secret', () => {
    // The control for the control: the carve-out above must not read as "a field
    // ignores its declared type". A plain `{ name, type: 'password' }` authors no
    // `inputType`, and `NATIVE_INPUT_FIELD_TYPES` is what keeps it masked
    // (objectui#5254 / #5375) — without it the secret would render as clear text.
    const { container } = renderComponent({
      type: 'form',
      fields: [{ name: 'secretField', label: 'Secret', type: 'password' }],
    } as never);
    const input = container.querySelector('input');
    expect(input, 'no field control rendered').toBeTruthy();
    expect(input!.getAttribute('type')).toBe('password');
  });
});
