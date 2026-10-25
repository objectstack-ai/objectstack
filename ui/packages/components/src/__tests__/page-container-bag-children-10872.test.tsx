/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The four `page:` containers render the child list they take in
 * `properties.children` (objectui#10872, batch 7).
 *
 * objectui#10872 batch 6 made `properties.children` the only spelling the zod
 * faces accept for the child list of `page:card`, `page:section`,
 * `page:footer` and `page:sidebar`: a node-level `children` is refused by
 * name, because `@objectstack/spec`'s `PageComponentSchema` is strict and the
 * rows (`PageCardProps`, `PageContainerProps`) declare `children` inside
 * `properties`. That ruling rests on a runtime fact: a document written the
 * way the validator now demands still RENDERS its children. The renderers read
 * `schema.children` (card: `schema.body ?? schema.children`), and the node
 * they read gets the bag's keys from `SchemaRenderer`'s `properties` hoist.
 * Batch 6 measured that once with a probe it did not commit; this file is the
 * committed pin.
 *
 * Every case mounts through the real `SchemaRenderer` and the real registry.
 * A container gets two distinct `element:text` children in
 * `properties.children`, and the pin asserts that both render, inside the
 * container's own element, in the order written. A container ignoring the bag
 * renders neither, and a container that reordered or dropped one fails the
 * order row.
 *
 * The control is the same container with no children: it renders its empty
 * element, and no child content. The control also shows the pin does not pass
 * because the harness paints the markers on its own.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ActionProvider, SchemaRenderer } from '@object-ui/react';
// Registers every renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../renderers';

afterEach(cleanup);

const FIRST = 'First bag child';
const SECOND = 'Second bag child';

const marker = (content: string) => ({ type: 'element:text', properties: { content } });

/**
 * One row per container. `carrier` finds the element the container renders
 * for itself, WITHOUT reading any child content, so children landing outside
 * the container's element fail the pin.
 */
const CONTAINERS: ReadonlyArray<{
  type: string;
  carrier: (container: HTMLElement) => Element | null;
}> = [
  // The shadcn `Card` root. With no `title` there is no header, and with no
  // children there is no `CardContent`.
  { type: 'page:card', carrier: (c) => c.firstElementChild },
  { type: 'page:section', carrier: (c) => c.querySelector('section') },
  // A `Separator` is rendered before the `footer` element.
  { type: 'page:footer', carrier: (c) => c.querySelector('footer') },
  { type: 'page:sidebar', carrier: (c) => c.querySelector('aside') },
];

function renderNode(schema: Record<string, unknown>) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <ActionProvider>
        <SchemaRenderer schema={schema as never} />
      </ActionProvider>
    </I18nProvider>,
  );
}

/** The row's carrier, required to exist. */
function carrierOf(row: (typeof CONTAINERS)[number], container: HTMLElement): Element {
  const el = row.carrier(container);
  expect(el, `${row.type}: the container's own element`).not.toBeNull();
  return el as Element;
}

/** The text of every `element:text` marker under `root`, in document order. */
function markersIn(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('p')).map((p) => p.textContent ?? '');
}

describe('the four page: containers render properties.children through SchemaRenderer (objectui#10872)', () => {
  for (const row of CONTAINERS) {
    describe(row.type, () => {
      it('renders both bag children, inside its own element, in the order written', () => {
        const { container } = renderNode({
          type: row.type,
          properties: { children: [marker(FIRST), marker(SECOND)] },
        });
        const carrier = carrierOf(row, container);
        expect(markersIn(carrier)).toEqual([FIRST, SECOND]);
        // Nothing rendered the markers outside the container.
        expect(markersIn(container)).toEqual([FIRST, SECOND]);
      });

      it('control: with no children it renders its empty element and no child content', () => {
        const { container } = renderNode({ type: row.type });
        const carrier = carrierOf(row, container);
        expect(carrier.childElementCount).toBe(0);
        expect(carrier.textContent).toBe('');
        expect(markersIn(container)).toEqual([]);
      });

      it('control: an empty properties.children renders the same empty element', () => {
        const { container } = renderNode({ type: row.type, properties: { children: [] } });
        const carrier = carrierOf(row, container);
        expect(carrier.childElementCount).toBe(0);
        expect(carrier.textContent).toBe('');
        expect(markersIn(container)).toEqual([]);
      });
    });
  }
});
