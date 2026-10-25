/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ui:button` resolves its authored `icon` through the SHARED resolver
 * (objectui#5993).
 *
 * ## What was on the tree, and what this suite can and cannot prove
 *
 * `renderers/form/button.tsx` carried a byte-equivalent reimplementation of
 * `renderers/action/resolve-icon.ts` — its own `toPascalCase`, its own
 * `iconNameMap` with the single `Home -> House` entry, its own index into
 * lucide's runtime `icons` record. Same algorithm, not the same function.
 *
 * ⚠️ The two implementations were behaviourally EQUIVALENT, so this suite must
 * not pretend otherwise. Measured over 3547 names before the dedupe (every one
 * of lucide's 1767 record keys in both spellings, plus kebab-case probes, the
 * `Home` alias, retired spellings and `undefined`): 3539 identical by object
 * identity, 8 differing ONLY in the nullish flavour returned for a miss (the
 * copy indexed the record and got `undefined`; the shared resolver `?? null`s
 * it), and ZERO genuine forks. `Icon` is consumed at exactly two sites, both
 * `{!isLoading && Icon && <Icon .../>}` truthiness tests, so that one
 * difference cannot reach the DOM.
 *
 * That has a consequence for how these rows read, and it is stated here rather
 * than left for a reviewer to discover:
 *
 *   - The BEHAVIOUR rows below are GREEN IN BOTH WORLDS. They are not evidence
 *     that the dedupe is correct — they are the guard that it changed nothing
 *     (icon identity, size, `iconPosition`, the loading state). A green run
 *     here proves NO-CHANGE, which is the whole contract of this card.
 *   - Exactly one row DISCRIMINATES, and it is a structural one: the ROUTING
 *     row. Before the dedupe `resolveIcon` was never called by this renderer,
 *     so the spy below records zero calls and that row is RED. It is the only
 *     honest red-before this card has, and it pins the thing that actually
 *     changed: which function the glyph came out of.
 *
 * ## Why the shared module is spied rather than replaced
 *
 * The factory delegates to `importOriginal`, so every behaviour row still runs
 * the REAL resolver against the REAL lucide record. A stub returning a fixed
 * component would have deleted the half that matters — that a RETIRED spelling
 * resolves to NOTHING rather than degrading to a wrong glyph (`edit` is that
 * control: a deprecated lucide export whose key is absent from the runtime
 * record, measured on lucide-react 1.31.0). Only the CALL is observed.
 *
 * ## Why the renderer is invoked DIRECTLY
 *
 * `ComponentRegistry.get('button')` returns the component the registry actually
 * renders; driving through `SchemaRenderer` injects its own props around it and
 * can be green in both directions (PR #4603's toggle case, restated by #4580).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';

vi.mock('../../action/resolve-icon', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../action/resolve-icon')>();
  return { resolveIcon: vi.fn(actual.resolveIcon) };
});

import { resolveIcon } from '../../action/resolve-icon';
// Module scope, not `beforeAll` (objectui#3010/#3021).
import '../../../renderers';

const shared = vi.mocked(resolveIcon);

beforeEach(() => shared.mockClear());
afterEach(() => cleanup());

/**
 * DOM ORDER inside the button, read off `childNodes`.
 *
 * ⚠️ NOT `compareDocumentPosition` against `screen.getByText('Go')`: the label
 * is a bare TEXT NODE, so that query returns its closest ELEMENT — the
 * `<button>` itself — and the comparison then answers `CONTAINS`, which is
 * true whichever side the glyph sits on. Measured: it returned 10
 * (`PRECEDING|CONTAINS`) for BOTH positions.
 */
function indexIn(button: HTMLElement, node: Node): number {
  return Array.prototype.indexOf.call(button.childNodes, node);
}

function labelIndexIn(button: HTMLElement): number {
  const at = Array.prototype.findIndex.call(
    button.childNodes,
    (n: Node) => n.nodeType === Node.TEXT_NODE && n.textContent === 'Go',
  );
  if (at < 0) throw new Error('the label text node is not a direct child of the button');
  return at;
}

function renderButton(schema: Record<string, unknown>): HTMLElement {
  const B = ComponentRegistry.get('button') as React.ComponentType<{ schema: unknown }>;
  const { container } = render(<B schema={{ type: 'button', label: 'Go', ...schema }} />);
  return container.querySelector('button') as HTMLElement;
}

describe('ui:button icon resolution (objectui#5993)', () => {
  describe('harness control', () => {
    // Without this, every "renders no glyph" row could pass against a button
    // that failed to render at all.
    it('renders the button and its label', () => {
      const button = renderButton({ icon: 'arrow-right' });
      expect(button).not.toBeNull();
      expect(screen.getByText('Go')).toBeTruthy();
    });
  });

  describe('routing — the only row that discriminates', () => {
    it('resolves the authored name through the SHARED resolver', () => {
      // RED before the dedupe: this renderer carried its own copy and never
      // called this function, so the spy recorded nothing.
      renderButton({ icon: 'arrow-right' });
      expect(shared).toHaveBeenCalledWith('arrow-right');
    });

    it('renders the glyph the shared resolver returned, not one of its own', () => {
      const button = renderButton({ icon: 'arrow-right' });
      // `toHaveBeenCalledTimes` FIRST, deliberately. Reading
      // `mock.results[0]?.value` straight away is a BLIND instrument: with zero
      // calls it is `undefined`, and `expect(undefined).not.toBeNull()` passes
      // — measured green against the restored copy before this line was added.
      expect(shared).toHaveBeenCalledTimes(1);
      expect(shared.mock.results[0].value).not.toBeNull();
      expect(button.querySelector('svg.lucide-arrow-right')).not.toBeNull();
    });
  });

  describe('behaviour — GREEN IN BOTH WORLDS, pinning that nothing moved', () => {
    it('resolves a kebab-case name to its PascalCase glyph', () => {
      expect(renderButton({ icon: 'arrow-right' }).querySelector('svg.lucide-arrow-right')).not.toBeNull();
    });

    it('resolves `home` through the RENAME alias to House, not to a dead `home`', () => {
      // The single entry both maps carried. It is the one input whose answer
      // would have changed had the dedupe dropped the alias on the floor.
      const button = renderButton({ icon: 'home' });
      expect(button.querySelector('svg.lucide-house')).not.toBeNull();
      // ⚠️ RELAXED under the maintainer's ruling C on objectui#8941 (comment
      // 5750512894, verbatim 「8941 C」). This row USED TO REFUSE a house glyph
      // that did not also carry lucide's `lucide-home` ALIAS class on the same
      // element: `querySelector('svg.lucide-home')` had to BE the house svg. It
      // NO LONGER DOES, because this button draws through the objectui#9251
      // seam, which emits lucide's canonical class and not lucide-react
      // 1.43.0's per-alias classes, and the ruling accepted that rather than
      // put every icon's aliases into the eager static name list.
      //
      // ⛔ Nor does it go back to the older form, `svg.lucide-home` is null:
      // lucide 1.43.0 itself puts `lucide-home` on the house glyph, so that
      // class no longer says which glyph was drawn, and pinning its absence
      // would pin the seam's divergence from lucide. `lucide-home` is neither
      // required nor forbidden here. What still discriminates is the count:
      // `Home` is not a key of the runtime record, so had the rename been
      // dropped this button would render NO glyph at all.
      expect(button.querySelectorAll('svg')).toHaveLength(1);
    });

    it('renders NO glyph for a retired spelling — the RECORD surface, not a fallback', () => {
      // `edit` still imports and still renders as a COMPONENT; its key is gone
      // from the runtime record. Rules out `LazyIcon`, which degrades an
      // unknown name to `Database`.
      const button = renderButton({ icon: 'edit' });
      expect(button.querySelector('svg')).toBeNull();
      expect(screen.getByText('Go')).toBeTruthy();
    });

    it('renders NO glyph for an unresolvable name, and no placeholder either', () => {
      // ⚠️ NOT the `ui:icon` contract. That renderer draws a `SquareDashed`
      // placeholder and warns (objectui#5631, pinned by
      // `basic/__tests__/icon-unresolvable-placeholder.test.tsx`).
      // `ui:button` draws nothing, before and after this card.
      const button = renderButton({ icon: 'definitely-not-a-lucide-icon' });
      expect(button.querySelector('svg')).toBeNull();
    });

    it('renders no glyph when no icon is authored', () => {
      expect(renderButton({}).querySelector('svg')).toBeNull();
    });

    it('places the glyph BEFORE the label by default, at h-4 w-4', () => {
      const button = renderButton({ icon: 'arrow-right' });
      const glyph = button.querySelector('svg.lucide-arrow-right')!;
      expect(glyph.getAttribute('class')).toContain('mr-2');
      expect(glyph.getAttribute('class')).toContain('h-4');
      expect(glyph.getAttribute('class')).toContain('w-4');
      expect(indexIn(button, glyph)).toBeLessThan(labelIndexIn(button));
    });

    it('places the glyph AFTER the label when iconPosition is right', () => {
      const button = renderButton({ icon: 'arrow-right', iconPosition: 'right' });
      const glyph = button.querySelector('svg.lucide-arrow-right')!;
      expect(glyph.getAttribute('class')).toContain('ml-2');
      expect(glyph.getAttribute('class')).toContain('h-4');
      expect(glyph.getAttribute('class')).toContain('w-4');
      expect(indexIn(button, glyph)).toBeGreaterThan(labelIndexIn(button));
    });

    it('swaps the glyph for the spinner while loading', () => {
      const button = renderButton({ icon: 'arrow-right', loading: true });
      expect(button.querySelector('svg.animate-spin')).not.toBeNull();
      expect(button.querySelector('svg.lucide-arrow-right')).toBeNull();
      expect(button.hasAttribute('disabled')).toBe(true);
    });
  });
});
