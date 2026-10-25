/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A `list` item draws from `content`, and `content` renders the node(s) it
 * declares (objectui#9590).
 *
 * ## What was wrong, measured before the change
 *
 * `ListItem.content` is declared `SchemaNode | SchemaNode[]` on both published
 * faces (`ListItemSchema` cited by SYMBOL, objectui#8875). The renderer placed
 * it into the `<li>` as a raw React child, so a string rendered but a node, or
 * an array of nodes, made the whole `list` fail to render ("Objects are not
 * valid as a React child"). The only channel that DID render a node was an
 * item-level `body`, a key neither face declares, which the renderer read as a
 * fallback. ⇒ the declared channel failed for nodes and the undeclared one
 * worked, and the registration's own `items` input recommended `content/body`.
 *
 * Now `content` goes through `renderChildren`: a string is placed as-is,
 * exactly as before, and a node or node array renders through
 * `SchemaRenderer`. The `body` read is retired, and both published faces refuse
 * the key by name (`list-tabs-item-body-refusal-9590.test.ts` in
 * `@object-ui/types`).
 *
 * ## The rows
 *
 * - `nodeContent` / `nodeArrayContent` — red before the change (the list
 *   failed to render), green after.
 * - `stringContent` — the CONTROL: green in both worlds. It keeps the
 *   subject rows from passing on a list that paints nothing at all.
 * - `bodyOnly` — red before the change (the `body` node rendered), green
 *   after.
 * - `registrationInput` — the `items` input no longer recommends `body`.
 *
 * ⛔ No row pins wording: the description row asserts which KEY it names.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registered at module scope, NOT in a hook: a cold transform billed to
// `hookTimeout` is narrower than the timeout it replaces (objectui#3010).
import '../index';

afterEach(() => cleanup());

/** Render one `list` node through the real renderer and return what it paints. */
function paint(items: unknown[]): { text: string; li: number } {
  render(
    <SchemaRendererProvider dataSource={{} as never}>
      <SchemaRenderer schema={{ type: 'list', items } as never} />
    </SchemaRendererProvider>,
  );
  return {
    text: document.body.textContent ?? '',
    li: document.body.querySelectorAll('li').length,
  };
}

const FAILED = 'failed to render';

describe('`list` items draw from `content`, and only `content` (objectui#9590)', () => {
  it('nodeContent: a node-valued `content` renders the node', () => {
    const { text, li } = paint([{ content: { type: 'text', content: 'NODE-CONTENT' } }]);
    expect(text, 'the declared `content` type is a node; the list must render it').not.toContain(FAILED);
    expect(li).toBe(1);
    expect(text).toContain('NODE-CONTENT');
  });

  it('nodeArrayContent: an array of nodes in `content` renders every node', () => {
    const { text, li } = paint([
      { content: [{ type: 'text', content: 'FIRST-NODE' }, { type: 'text', content: 'SECOND-NODE' }] },
    ]);
    expect(text).not.toContain(FAILED);
    expect(li).toBe(1);
    expect(text).toContain('FIRST-NODE');
    expect(text).toContain('SECOND-NODE');
  });

  it('stringContent (control): a string `content` is placed as-is', () => {
    const { text, li } = paint([{ content: 'STRING-CONTENT' }, 'BARE-STRING']);
    expect(li).toBe(2);
    expect(text).toContain('STRING-CONTENT');
    expect(text).toContain('BARE-STRING');
  });

  it('bodyOnly: an item authored with `body` alone paints nothing from it', () => {
    const { text, li } = paint([{ body: { type: 'text', content: 'BODY-ONLY' } }]);
    // Lit half of the same render: the row itself is there, so an empty `li`
    // is a reading and not a list that never rendered.
    expect(li).toBe(1);
    expect(
      text,
      'the item-level `body` fallback is back: `ListItem` declares `content` and refuses `body`',
    ).not.toContain('BODY-ONLY');
  });

  it('registrationInput: the `items` input names `content` and not `body`', () => {
    const items = ComponentRegistry.getMeta('list', 'ui')?.inputs?.find((input) => input.name === 'items');
    expect(items, 'ui:list is not registered with an `items` input — this row is vacuous').toBeDefined();
    const description = String(items?.description ?? '');
    expect(description).toMatch(/\bcontent\b/);
    expect(description).not.toMatch(/\bbody\b/);
  });
});
