/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The page renderer no longer compiles a `kind: 'jsx'` node as html
 * (objectui#12486, half 2 of objectui#12464).
 *
 * ## What was retired
 *
 * `jsx` was the first name of the constrained-JSX page tier, which ADR-0081
 * renamed `html`. `@objectstack/spec` 18 retired it: the page parse refuses it
 * by name with a prescription naming `html`, stored-row rehydration rewrites a
 * stored `jsx` page to `html` before it is served, and `COMPILED_PAGE_KINDS` is
 * `html` alone. objectui#12464 narrowed the page node's `kind` to match, and
 * kept the renderer's `kind === 'jsx'` arm only until the resolved spec carried
 * the retirement. It does now, so the arm is gone.
 *
 * A raw node that still carries `kind: 'jsx'` (one a host builds in code past
 * the types, since the authoring face refuses the value) is therefore a kind the
 * renderer does not name. It takes the path every such kind takes, the
 * template / page-type layout, exactly as a node with no `kind` does: its
 * `source` is not read. ⛔ No arm names `jsx`, neither to honour it nor to
 * refuse it; the refusal lives at the parse.
 *
 * ## The rows
 *
 * - `subject`: a `jsx` node whose `source` compiles cleanly as html paints
 *   nothing from that source. Red while the arm exists.
 * - `same path`: the `jsx` node draws exactly what the same node with no `kind`
 *   draws, its `children` included. Red while the arm exists (the arm draws the
 *   compiled source and ignores `children`).
 * - `control`: the same node as `kind: 'html'` paints its source. Green in both
 *   worlds; it is what keeps `subject` from passing on a renderer that compiles
 *   nothing at all.
 *
 * ⛔ No row pins message prose.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registered at module scope, NOT in a hook: a cold transform billed to
// `hookTimeout` is narrower than the timeout it replaces (objectui#3010).
import '../../../renderers';

afterEach(() => cleanup());

type Node = Record<string, unknown>;

/** A heading only the compiled `source` can produce. */
const FROM_SOURCE = 'Painted from source';
/** A heading only the page-type layout's `children` can produce. */
const FROM_CHILDREN = 'Painted from children';

/** A page node as a host hands it: `source` that compiles as html, and `children`. */
const page = (kind?: string): Node => ({
  type: 'home',
  name: 'retired_kind_page',
  label: 'Retired kind page',
  ...(kind === undefined ? {} : { kind }),
  source: `<flex><h1>${FROM_SOURCE}</h1></flex>`,
  children: [{ type: 'text', content: FROM_CHILDREN }],
});

/** Render one node through the registered page renderer; return its root. */
function paint(node: Node): HTMLElement {
  const C = ComponentRegistry.get('home', 'ui');
  if (!C) throw new Error('no renderer registered for ui:home');
  return render(<C schema={node} />).container;
}

describe('the page renderer does not compile kind jsx as html (objectui#12486)', () => {
  it('subject: a jsx node paints nothing from its source', () => {
    const root = paint(page('jsx'));
    expect(root.textContent).not.toContain(FROM_SOURCE);
  });

  it('same path: a jsx node draws what the same node with no kind draws', () => {
    const absent = paint(page()).innerHTML;
    cleanup();
    const jsx = paint(page('jsx'));
    expect(jsx.textContent).toContain(FROM_CHILDREN);
    expect(jsx.innerHTML).toBe(absent);
  });

  it('control: the same node as kind html compiles its source', () => {
    const root = paint(page('html'));
    expect(root.textContent).toContain(FROM_SOURCE);
    expect(root.textContent).not.toContain(FROM_CHILDREN);
  });
});
