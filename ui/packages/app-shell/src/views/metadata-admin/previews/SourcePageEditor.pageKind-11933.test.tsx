/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11933 — a source page's live preview draws the page's own KIND.
 *
 * `SourcePageEditor`'s preview is "a live preview rendered through the runtime
 * SchemaRenderer". It wrote the page's kind into the node `type` and nowhere
 * else, while the running app (`PageView`) also copies it onto `pageType` — the
 * key `PageRenderer` reads for the page's width, its `data-page-type` and
 * whether it draws the implicit title heading. So Studio drew an `app` or
 * `home` page as a record page (record width, no title) while the running app
 * drew it with both. Both writers now spread one builder, `pageKindNode`.
 *
 * Everything below renders through the REAL `SchemaRenderer`, the real
 * `ComponentRegistry` and the real `PageRenderer` the preview uses — no mock
 * stands in for the renderer. Widths are compared, never written down: the
 * classes are `PageRenderer`'s choice, and what this card owns is only that a
 * non-record page does not get the record one.
 *
 * - an `app` and a `home` source page preview with the title heading and a
 *   width that is not the record width;
 * - every region-composed page kind reaches the renderer as itself;
 * - CONTROL: a `record` page previews exactly as an untyped page does — the
 *   renderer's own record default, which is what every source page drew before.
 *
 * The running app's half of the pair is pinned by `page-kind-writing-end-9718`
 * in `views/__tests__`, kind by kind; this file does not re-assert it.
 */

import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { PageTypeSchema } from '@objectstack/spec/ui';
// Registers `PageRenderer` under each page kind and the html tier's blocks the
// preview compiles the source to. Module scope, not a hook (AGENTS.md's flaky
// test discipline).
import '@object-ui/components';

// The editor half is not under test (the canvas mounts the preview half only),
// but the component asks the Monaco loader either way. Offline, as in the
// sibling source-page tests, so no CDN script is requested.
vi.mock('@monaco-editor/react', () => {
  const Editor = () => null;
  return { Editor, default: Editor, loader: { init: () => Promise.reject(new Error('offline')) } };
});

import { SourcePageEditor } from './SourcePageEditor';

const LABEL = 'Team handbook';
const BODY = 'Welcome to the team.';

/**
 * Kinds that are interface mode in the running app (`PageView` short-circuits
 * them to `InterfaceListPage`), so no `PageRenderer` registration answers for
 * them. The same split `page-kind-writing-end-9718` reads.
 */
const INTERFACE_MODE_KINDS = ['list'] as const;

function regionComposedKinds(): string[] {
  // `PageTypeSchema` is a lazy schema; `.options` is the enum's member list.
  const kinds = [...(PageTypeSchema as unknown as { options: readonly string[] }).options];
  return kinds.filter((kind) => !(INTERFACE_MODE_KINDS as readonly string[]).includes(kind));
}

interface Drawn {
  pageType: string | null;
  /** The `max-w-*` classes on the page's content column. */
  width: string;
  /** The text of every level-one heading the page drew. */
  headings: string[];
}

/** Render the Studio canvas's preview half over one source page document. */
function preview(doc: Record<string, unknown>): Drawn {
  cleanup();
  const { container } = render(
    <SourcePageEditor
      mode="preview"
      readOnly
      draft={{ name: 'team_handbook', label: LABEL, kind: 'html', source: `<p>${BODY}</p>`, ...doc }}
    />,
  );

  // Firing controls: the page renderer was reached, and the source compiled.
  // A compile error replaces the body with an error panel, and a missing page
  // element means the preview drew something else — either would make every
  // reading below a reading of the wrong thing.
  const page = container.querySelector<HTMLElement>('[data-page-type]');
  expect(page, 'the preview drew no PageRenderer at all; nothing below would be measured').not.toBeNull();
  expect(container.textContent).not.toContain('failed to compile');
  expect(container.textContent).toContain(BODY);

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

describe('objectui#11933 — a source page previews as its own page kind', () => {
  it('CONTROL: a record page previews as before, the renderer\'s record default', () => {
    const record = preview({ type: 'record' });
    const untyped = preview({});

    expect(record.pageType).toBe('record');
    // An untyped document carries no kind, so the renderer falls back to its
    // record default — which is what EVERY source page drew before this fix.
    expect(untyped.pageType).toBe('record');
    expect(record.width).toBe(untyped.width);
    // A record page leaves its title to `page:header`, so it draws no implicit one.
    expect(record.headings).toEqual([]);
    expect(untyped.headings).toEqual([]);
  });

  it.each(['app', 'home'])('a page of kind %s previews with its title heading and not the record width', (kind) => {
    const recordWidth = preview({ type: 'record' }).width;
    const drawn = preview({ type: kind });

    expect(
      drawn.pageType,
      `the preview must hand PageRenderer the page kind '${kind}' on pageType, as the running app does`,
    ).toBe(kind);
    expect(drawn.headings).toEqual([LABEL]);
    expect(
      drawn.width,
      `a '${kind}' page previewed at the record width (${recordWidth}); the running app draws it at its own`,
    ).not.toBe(recordWidth);
  });

  it('every region-composed page kind reaches the renderer as itself', () => {
    const kinds = regionComposedKinds();
    // Firing control: a green below is a reading, not an empty loop.
    expect(kinds.length).toBeGreaterThan(0);

    for (const kind of kinds) {
      expect(preview({ type: kind }).pageType, `page kind '${kind}'`).toBe(kind);
    }
  });
});
