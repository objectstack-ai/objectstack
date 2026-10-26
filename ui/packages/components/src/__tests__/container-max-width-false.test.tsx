/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ContainerSchema.maxWidth: false` means "no maximum width", and it must
 * CANCEL an inherited one rather than merely decline to add its own
 * (objectui#4889).
 *
 * `ContainerSchema` has declared `maxWidth?: ... | false` since the type was
 * written, but `container.tsx` read it as `schema.maxWidth || 'xl'`. `false ||
 * 'xl'` is `'xl'`, so the one spelling for "do not constrain me" rendered
 * `max-w-xl` — `max-width: 36rem`, the exact opposite of what it asked for —
 * and the `false` arm of the union had no reachable path from the day it was
 * declared. This is the #4001 failure mode: a declared value the engine
 * silently swaps for another. `stack.tsx` and `grid.tsx` already read their
 * scales with `??`, and objectui#4003 converged `flex`'s `gap` and this file's
 * `padding` onto the same spelling; `maxWidth` was the last `||` in the family.
 *
 * WHY `??` ALONE IS NOT THE FIX. `maxWidth` is read as a chain of equality
 * tests, and `false` equals none of the tokens — so `??` on its own would make
 * the renderer emit NO max-width class. That is not the same fact as
 * `max-w-none`:
 *
 *   absent  — the element declares nothing, and whatever else applies to it
 *             wins. Under `@tailwindcss/typography` (a real dependency here,
 *             loaded by `apps/console/src/index.css` via `@plugin`), `.prose`
 *             sets `max-width: 65ch`, so the element is still constrained.
 *   cancel  — `max-w-none` is `max-width: none`, which overrides `.prose` and
 *             leaves the element genuinely unconstrained.
 *
 * The two coincide only when nothing else supplies a max-width, which is why
 * the emission-only assertion below cannot be the whole pin: the one measured
 * victim of this bug (the `components-layout-page/documentation-page` catalog
 * node, `prose prose-slate max-w-none`, a recorded #4003 conversion exemption)
 * needs the CANCEL. `container-cancels-inherited-max-width` is the assertion
 * that tells the two apart, and it is the one that reddens if a future change
 * "simplifies" the fix down to dropping the class.
 *
 * ON THE STYLESHEET THIS TEST INJECTS. happy-dom resolves author stylesheets in
 * `getComputedStyle`, so the cascade is real rather than mocked. The three
 * rules carry the values the real build produces — `.prose` from the typography
 * plugin's `DEFAULT` (`maxWidth: '65ch'`), `.max-w-none` and `.max-w-xl` from
 * Tailwind's own theme (`--container-xl: 36rem`) — and `.max-w-*` is declared
 * AFTER `.prose` because that is the layer order Tailwind emits (typography
 * registers `.prose` in `components`, utilities come last). Equal specificity,
 * so source order is what decides, exactly as it does in the shipped CSS.
 *
 * Module-scope import of the renderers, not `beforeAll` (AGENTS.md §测试纪律):
 * registering them is an unbounded module load and must not be billed to a
 * bounded hook timeout.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import '../renderers';
import { SchemaRenderer } from '@object-ui/react';

function renderNode(schema: unknown): HTMLElement {
  const { container } = render(<SchemaRenderer schema={schema as never} />);
  return container.firstElementChild as HTMLElement;
}

const classOf = (schema: unknown): string => renderNode(schema).className;

describe('container honours a declared maxWidth of false (#4889)', () => {
  it('emits max-w-none, not the max-w-xl default', () => {
    expect(classOf({ type: 'container', maxWidth: false, padding: 0, centered: false, children: [] }))
      .toBe('w-full max-w-none p-0');
  });

  it('still defaults to xl when maxWidth is omitted', () => {
    // The `false` fix must not turn "unspecified" into "no constraint" — that
    // is the mirror-image bug, and it is why `??` is correct where `||` was not.
    expect(classOf({ type: 'container', padding: 0, centered: false, children: [] }))
      .toBe('w-full max-w-xl p-0');
  });

  it('leaves every named token rendering the class it always did', () => {
    for (const token of ['sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', 'full'] as const) {
      expect(classOf({ type: 'container', maxWidth: token, padding: 0, centered: false, children: [] }))
        .toBe(`w-full max-w-${token} p-0`);
    }
    // `screen` is the one token whose class is not `max-w-<token>`.
    expect(classOf({ type: 'container', maxWidth: 'screen', padding: 0, centered: false, children: [] }))
      .toBe('w-full max-w-screen-2xl p-0');
  });
});

describe('`false` cancels an INHERITED max-width, it does not merely omit one (#4889)', () => {
  let sheet: HTMLStyleElement;

  beforeEach(() => {
    sheet = document.createElement('style');
    // Layer order as shipped: typography's `.prose` (components) first, the
    // `max-w-*` utilities after it. See the file header.
    sheet.textContent = [
      '.prose { max-width: 65ch; }',
      '.max-w-none { max-width: none; }',
      '.max-w-xl { max-width: 36rem; }',
    ].join('\n');
    document.head.appendChild(sheet);
  });

  afterEach(() => {
    sheet.remove();
  });

  it('harness self-check: the injected cascade tells absent from cancel', () => {
    // Green on both legs of the reverse-verification by construction — it
    // exercises no renderer code. It exists so that a failure of the two pins
    // below cannot be read as "the stylesheet never applied".
    const absent = renderNode({ type: 'div', className: 'prose' });
    const cancelled = renderNode({ type: 'div', className: 'prose max-w-none' });
    expect(getComputedStyle(absent).maxWidth).toBe('65ch');
    expect(getComputedStyle(cancelled).maxWidth).toBe('none');
  });

  it('container-cancels-inherited-max-width: prose + maxWidth false computes none', () => {
    const el = renderNode({
      type: 'container',
      maxWidth: false,
      padding: 0,
      centered: false,
      className: 'prose',
      children: [],
    });
    // Before the fix this is `36rem` (576px) — `.prose` would have been the
    // lesser wrong answer; `||` folded `false` into `xl` and CONSTRAINED it.
    expect(getComputedStyle(el).maxWidth).toBe('none');
  });

  it('the same node without the cancel would still inherit 65ch', () => {
    // The counterfactual, built by hand: identical class list minus
    // `max-w-none`. It measures what "just stop emitting a class" would have
    // shipped, and is the reason the branch emits an explicit cancel.
    const el = renderNode({ type: 'div', className: 'w-full p-0 prose' });
    expect(getComputedStyle(el).maxWidth).toBe('65ch');
  });
});
