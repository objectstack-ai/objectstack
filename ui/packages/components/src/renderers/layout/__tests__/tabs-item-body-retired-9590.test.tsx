/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A `tabs` item draws its panel from `content`, and ONLY from `content`
 * (objectui#9590).
 *
 * ## What was retired
 *
 * The `ui:tabs` renderer drew each panel as `item.content`, falling back to an
 * item-level `body` reached through an `any` cast. `TabItem` never declared
 * `body` on either published face: `TabItemSchema` (cited by SYMBOL,
 * objectui#8875) declares `content` REQUIRED and used to strip an undeclared
 * `body`. So the fallback honoured a key the contract did not have: the
 * lenient-fallback shape AGENTS.md #0.1 bans by name. The same change made
 * both item faces refuse `body` by name, naming `content`. Nothing in
 * this tree authors it: objectui#9941 respelled the registration's own
 * `defaultProps` items to `content`, and the producer scan
 * (`pnpm census:body-dialect-producers`) is the instrument that re-derives that.
 *
 * ## The rows
 *
 * - `subject`: an item authored with `body` alone paints NOTHING from it. Red
 *   while the fallback exists (the panel shows the body text), green once it is
 *   gone.
 * - `control`: an item authored with `content` still paints its panel. Green in
 *   both worlds; it is what keeps `subject` from passing on a renderer that
 *   paints no panel at all.
 * - `precedence`: `content` beside `body` paints `content` and never `body`.
 *   Green in both worlds as well (the fallback only ran when `content` was
 *   falsy); it pins that the retirement did not move the primary arm.
 *
 * ⛔ No row pins message prose, and ⛔ none reads the parse: this file is the
 * RENDER half. The door half (the named refusal) is pinned in
 * `@object-ui/types`, `list-tabs-item-body-refusal-9590.test.ts`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registered at module scope, NOT in a hook: a cold transform billed to
// `hookTimeout` is narrower than the timeout it replaces (objectui#3010).
import '../../../renderers';

afterEach(() => cleanup());

type Item = Record<string, unknown>;

/** Render one `tabs` node whose only tab is active, and return its text. */
function paint(item: Item): string {
  const C = ComponentRegistry.get('tabs', 'ui');
  if (!C) throw new Error('no renderer registered for ui:tabs');
  render(<C schema={{ type: 'tabs', defaultValue: 'only', items: [{ value: 'only', label: 'Only tab', ...item }] }} />);
  return document.body.textContent ?? '';
}

const node = (text: string) => [{ type: 'text', content: text }];

describe('`ui:tabs` draws an item panel from `content` only (objectui#9590)', () => {
  it('subject: an item authored with `body` alone paints nothing from it', () => {
    const text = paint({ body: node('BODY-ONLY-PANEL') });
    // Lit half of the same render: the tab strip itself painted, so an empty
    // panel below is a reading and not a render that never happened.
    expect(text).toContain('Only tab');
    expect(
      text,
      'the item-level `body` fallback is back: `TabItem` declares `content` and refuses `body`, ' +
        'so the renderer must not honour it (AGENTS.md #0.1)',
    ).not.toContain('BODY-ONLY-PANEL');
  });

  it('control: an item authored with `content` paints its panel', () => {
    expect(paint({ content: node('CONTENT-PANEL') })).toContain('CONTENT-PANEL');
  });

  it('precedence: `content` beside `body` paints `content`, never `body`', () => {
    const text = paint({ content: node('CONTENT-WINS'), body: node('BODY-LOSES') });
    expect(text).toContain('CONTENT-WINS');
    expect(text).not.toContain('BODY-LOSES');
  });
});
