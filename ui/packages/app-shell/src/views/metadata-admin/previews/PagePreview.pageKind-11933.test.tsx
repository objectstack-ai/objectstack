/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11933 — Studio's Run-mode page canvas draws the page's own KIND.
 *
 * `PagePreview` renders a region-composed page "using the runtime
 * SchemaRenderer so authors see exactly what end-users would see". Out of
 * design mode (the Studio Interfaces canvas in Run mode) it wrote the page's
 * kind into the node `type` and nowhere else,
 * while the running app (`PageView`) also copies it onto `pageType` — the key
 * `PageRenderer` reads for the page's width, its `data-page-type` and whether
 * it draws the implicit title heading. So an `app` or `home` page drew as a
 * record page (record width, no title). It now spreads the builder `PageView`
 * uses, `pageKindNode`.
 *
 * Everything below renders through the REAL `SchemaRenderer`, the real
 * `ComponentRegistry` and the real `PageRenderer`. Widths are compared, never
 * written down: the classes are `PageRenderer`'s choice, and what this card
 * owns is only that a non-record page does not get the record one.
 *
 * - an `app` and a `home` page draw the title heading and a width that is not
 *   the record width;
 * - CONTROL: a `record` page draws exactly as an untyped page does — the
 *   renderer's own record default, which is what every page drew here before;
 * - CONTROL: an empty draft, typed or not, still draws no page but the
 *   "add components" message. The renderer's node now carries two keys the
 *   draft did not write, and neither counts as content.
 *
 * The source-page preview's half is `SourcePageEditor.pageKind-11933` beside
 * this file; the running app's half is `page-kind-writing-end-9718`.
 */

import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
// Registers `PageRenderer` under each page kind and the blocks the region
// renders. Module scope, not a hook (AGENTS.md's flaky test discipline).
import '@object-ui/components';
import { PagePreview } from './PagePreview';
import { t } from '../i18n';

const LABEL = 'Team handbook';

interface Drawn {
  pageType: string | null;
  /** The `max-w-*` classes on the page's content column. */
  width: string;
  /** The text of every level-one heading the page drew. */
  headings: string[];
}

/** Render the Run-mode canvas (no design mode) over one region page document. */
function runMode(doc: Record<string, unknown>): Drawn {
  cleanup();
  const { container } = render(
    <PagePreview
      type="page"
      name="team_handbook"
      draft={{
        name: 'team_handbook',
        label: LABEL,
        regions: [{ name: 'main', components: [{ type: 'container' }] }],
        ...doc,
      }}
    />,
  );

  // Firing controls: the page renderer was reached and drew its region layout.
  // Without them every reading below could be a reading of something else.
  const page = container.querySelector<HTMLElement>('[data-page-type]');
  expect(page, 'the canvas drew no PageRenderer at all; nothing below would be measured').not.toBeNull();
  expect(page!.querySelector('[data-page-layout]'), 'the page drew no region layout').not.toBeNull();

  const column = page!.firstElementChild as HTMLElement | null;
  const width = (column?.className ?? '')
    .split(/\s+/)
    .filter((c) => c.startsWith('max-w-'))
    .join(' ');
  expect(width, 'the page content column carries no max-width class to compare').not.toBe('');

  return {
    pageType: page!.getAttribute('data-page-type'),
    width,
    headings: [...container.querySelectorAll('h1')].map((h) => h.textContent ?? ''),
  };
}

afterEach(() => cleanup());

describe('objectui#11933 — the Run-mode page canvas draws the page as its own kind', () => {
  it('CONTROL: a record page draws as before, the renderer\'s record default', () => {
    const record = runMode({ type: 'record' });
    const untyped = runMode({});

    expect(record.pageType).toBe('record');
    // An untyped document carries no kind, so the renderer falls back to its
    // record default — which is what EVERY page drew on this canvas before.
    expect(untyped.pageType).toBe('record');
    expect(record.width).toBe(untyped.width);
    // A record page leaves its title to `page:header`, so it draws no implicit one.
    expect(record.headings).toEqual([]);
    expect(untyped.headings).toEqual([]);
  });

  it.each(['app', 'home'])('a page of kind %s draws its title heading and not the record width', (kind) => {
    const recordWidth = runMode({ type: 'record' }).width;
    const drawn = runMode({ type: kind });

    expect(
      drawn.pageType,
      `the canvas must hand PageRenderer the page kind '${kind}' on pageType, as the running app does`,
    ).toBe(kind);
    expect(drawn.headings).toEqual([LABEL]);
    expect(
      drawn.width,
      `a '${kind}' page drew at the record width (${recordWidth}); the running app draws it at its own`,
    ).not.toBe(recordWidth);
  });

  it.each([{}, { type: 'app' }])('CONTROL: an empty draft %j still shows the add-components message', (draft) => {
    cleanup();
    const { container } = render(<PagePreview type="page" name="empty" draft={draft} />);

    expect(container.querySelector('[data-page-type]')).toBeNull();
    expect(container.textContent).toContain(t('engine.pagePreview.addComponents'));
  });
});
