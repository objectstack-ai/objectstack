/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `span` renderer reads the `value` key its own type and its published doc
 * both declare (objectui#5050), with child content winning when both are there.
 *
 * The defect: two declared authoring surfaces named `value` the text content of
 * a span, and the renderer read neither it nor — before objectui#5027 — any key
 * a producer emits.
 *
 *   - `TextSpanSchema` (`packages/types/src/layout.ts`) declares
 *     `value?: string`, commented `Text content`.
 *   - the published doc `content/docs/components/basic/span.mdx` lists the same
 *     `value?: string  // Text content` in its Schema block.
 *
 * So `{ type: 'span', value: 'hello' }` — written exactly as the type and the
 * docs instruct — rendered an EMPTY element, with no warning and no diagnostic.
 * Same failure shape as #5027 (content silently dropped), one key over.
 *
 * Ruled 2026-08-17: wire it. Both declared faces stay as written, and the
 * renderer makes them true, rather than the declarations being retracted.
 *
 * PRECEDENCE, and why it is not a bespoke rule: at the time `basic/text.tsx`
 * rendered `schema.content || schema.value` (that fallback limb was retired by
 * objectui#6951; `content` is now `text`'s one spelling), so on the sibling type
 * in the same family the richer key already won and the scalar was the fallback. `span`
 * follows that, with `children` (its canonical child key, #5027) in the winning
 * position. `body` stays refused — see `span-children-rendering.test.tsx`; it is
 * declared nowhere for this type, whereas `value` is declared twice.
 *
 * What the type surface could and could not say when this was written, same as
 * on #5027: `BaseSchema` carried an index signature, so no spelling here was a
 * TS error (objectui#8347 removed it, so an undeclared spelling in a typed
 * literal is one now). The read side is the only place the precedence contract
 * can be stated, which is why it is pinned
 * rather than left to review.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
import type { TextSchema, TextSpanSchema } from '@object-ui/types';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

/**
 * Types a child literal below as the `text` node it is (objectui#11347): a
 * `children` entry is checked against `SchemaNode`, and since objectui#8347
 * removed `BaseSchema`'s index signature a literal checked against it may
 * author only `BaseSchema`'s own keys.
 */
const textNode = (schema: TextSchema): TextSchema => schema;

describe('span reads its declared `value` key (#5050)', () => {
  it('renders the plain `{ type: "span", value }` the card reports rendering empty', () => {
    // The reproduction from the card, written exactly as `TextSpanSchema` and
    // the published doc instruct. Before the fix this element was empty.
    const schema: TextSpanSchema = {
      type: 'span',
      className: 'value-only',
      value: 'hello from value',
    };

    const { container } = render(<SchemaRenderer schema={schema} />);

    const span = container.querySelector('span.value-only');
    expect(span).toBeTruthy();
    expect(span?.textContent).toBe('hello from value');
  });

  it('lets child content win when both `children` and `value` are authored', () => {
    // The precedence half of the ruling. `text`'s `content || value` was the
    // family precedent (its `value` limb is retired since objectui#6951): the
    // richer key renders, the scalar does not — and the
    // scalar must not be appended either, which is what the second assertion
    // rules out (a `+` instead of a `||` would keep the first one green).
    const schema: TextSpanSchema = {
      type: 'span',
      className: 'both-keys',
      value: 'value must not render',
      children: [textNode({ type: 'text', content: 'children win' })],
    };

    const { container } = render(<SchemaRenderer schema={schema} />);

    const span = container.querySelector('span.both-keys');
    expect(span).toBeTruthy();
    expect(span?.textContent).toBe('children win');
    expect(container.textContent).not.toContain('value must not render');
  });

  it('lets a single (non-array) child node win over `value` too', () => {
    // `children` is declared `SchemaNode | SchemaNode[]`, and the two arms take
    // different branches inside `renderChildren`. Precedence is a property of
    // the contract, not of which arm the author happened to write.
    const schema: TextSpanSchema = {
      type: 'span',
      className: 'single-child-wins',
      value: 'value must not render',
      children: textNode({ type: 'text', content: 'lone child wins' }),
    };

    const { container } = render(<SchemaRenderer schema={schema} />);

    expect(container.querySelector('span.single-child-wins')?.textContent).toBe('lone child wins');
    expect(container.textContent).not.toContain('value must not render');
  });

  it('falls back to `value` when `children` is present but carries no content', () => {
    // An empty array is authored content-free, so it is the fallback case, not
    // the precedence case: `renderChildren` returns null for it and `value` is
    // what the author still has on the node. Pinned because the empty array is
    // truthy in JS — the one input where "has a children key" and "has child
    // content" come apart.
    const schema: TextSpanSchema = {
      type: 'span',
      className: 'empty-children',
      value: 'fallback rendered',
      children: [],
    };

    const { container } = render(<SchemaRenderer schema={schema} />);

    expect(container.querySelector('span.empty-children')?.textContent).toBe('fallback rendered');
  });

  it('renders an empty element when neither key is authored — no crash, no placeholder', () => {
    // The negative control. Wiring a fallback must not invent content for a
    // node that declares none; this is also what keeps the `body`-refusal pin
    // in span-children-rendering.test.tsx meaningful.
    const { container } = render(
      <SchemaRenderer schema={{ type: 'span', className: 'no-content' } as TextSpanSchema} />,
    );

    const span = container.querySelector('span.no-content');
    expect(span).toBeTruthy();
    expect(span?.textContent).toBe('');
  });
});
