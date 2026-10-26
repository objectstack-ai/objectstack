/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `span` renderer reads the child key its own type declares (objectui#5027).
 *
 * It used to read `schema.body` and nothing else, while every producer on both
 * of its authoring surfaces emits `children`:
 *
 *   - the `kind:'html'` tier — `sdui-parser`'s `parse.ts` assigns compiled child
 *     nodes to `node.children`, so an author writing the plain inline tag with
 *     text in it got an EMPTY element back. No diagnostic: the parser's
 *     `validateTree` does not inspect child keys, so the text was dropped in
 *     silence. The sibling paragraph on the same page rendered normally, which
 *     is what made this look like anything but a compile failure.
 *   - the JSON surface — `TextSpanSchema` declares `value` and `children`. An
 *     author following the declaration got the same empty element.
 *
 * The canonical key is `children`: that is what the type declares, what the
 * parser emits, and what the sibling `div` renderer already reads. `body` is
 * deliberately NOT accepted as a second spelling — a tolerant `||` here would
 * fossilize a second de-facto contract for the one type whose declaration never
 * named it (Commandment #0.1). The third case below pins that.
 *
 * Note on what the type surface could and could not say when this was written:
 * `body` was not a type ERROR on a span, because `BaseSchema` declared both
 * child keys and carried an index signature (`body` has since become a
 * `?: never` tombstone, and objectui#8347 removed the signature). So the read
 * side was the only place this could be stated, which is exactly why it is
 * stated here rather than left to review.
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

/** Renders a `kind:'html'` page — source compiled by the parser, then rendered. */
function renderHtmlPage(source: string) {
  return render(<SchemaRenderer schema={{ type: 'home', kind: 'html', name: 'test_page', source } as never} />);
}

describe('span renders its canonical child key (#5027)', () => {
  it('renders the text an html-tier author wrote inside the inline tag', () => {
    // The reproduction from the card, byte for byte: the inline tag's text used
    // to vanish while the paragraph next to it rendered.
    const { container } = renderHtmlPage(
      '<box className="outer"><span className="inner">hello html tier</span><p>page rendered</p></box>',
    );

    // Control first: a compile error replaces the whole page with an error
    // panel, which would fail the assertions below for the wrong reason.
    expect(container.textContent).not.toContain('failed to compile');
    expect(container.textContent).toContain('page rendered');

    const span = container.querySelector('span.inner');
    expect(span).toBeTruthy();
    expect(span?.textContent).toBe('hello html tier');
  });

  it('renders `children` authored on the JSON surface, as TextSpanSchema declares it', () => {
    const schema: TextSpanSchema = {
      type: 'span',
      className: 'json-authored',
      children: [textNode({ type: 'text', content: 'inline from children' })],
    };

    const { container } = render(<SchemaRenderer schema={schema} />);

    const span = container.querySelector('span.json-authored');
    expect(span).toBeTruthy();
    expect(span?.textContent).toContain('inline from children');
  });

  it('accepts a single child node, not only an array — the declaration allows both', () => {
    const schema: TextSpanSchema = {
      type: 'span',
      className: 'single-child',
      children: textNode({ type: 'text', content: 'lone child' }),
    };

    const { container } = render(<SchemaRenderer schema={schema} />);

    expect(container.querySelector('span.single-child')?.textContent).toContain('lone child');
  });

  it('does not accept a `body` alias — one contract, not two spellings', () => {
    // Guarding the removal, not the defect: re-adding a lenient read here would
    // make this red. `body` never entered this type's declaration, and a repo
    // sweep at the time of the fix found no page, example, catalog entry or
    // metadata document authoring it on a span.
    const { container } = render(
      <SchemaRenderer
        schema={{
          type: 'span',
          className: 'alias-probe',
          body: [{ type: 'text', content: 'must not render' }],
        } as never}
      />,
    );

    const span = container.querySelector('span.alias-probe');
    expect(span).toBeTruthy();
    expect(span?.textContent).toBe('');
    expect(container.textContent).not.toContain('must not render');
  });
});
