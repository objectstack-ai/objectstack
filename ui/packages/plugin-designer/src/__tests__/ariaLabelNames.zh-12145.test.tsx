/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12145 — `@object-ui/plugin-designer`'s accessible names are read
 * from the pack through `useDesignerTranslation`, so under `zh` a screen reader
 * hears the zh pack's words:
 *
 *  - `HistoryPanel`'s undo / redo buttons: `designer.undo` / `designer.redo`;
 *  - `Minimap`'s image: `designer.canvasMinimap`;
 *  - `VersionHistory`'s region: `designer.versionHistory`.
 *
 * (`DashboardDesignPage`'s back button reads `detail.goBack` through the same
 * hook.) Every name is read against the PACK, never against a literal.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';
import { HistoryPanel } from '../components/HistoryPanel';
import { Minimap } from '../components/Minimap';
import { VersionHistory } from '../components/VersionHistory';
import type { UndoRedoState } from '../hooks/useUndoRedo';

afterEach(cleanup);

const noop = () => {};
const history: UndoRedoState<string> = {
  current: 'b',
  canUndo: true,
  canRedo: true,
  undoCount: 1,
  redoCount: 1,
  timeline: ['a', 'b', 'c'],
  currentIndex: 1,
  push: noop,
  undo: noop,
  redo: noop,
  reset: noop,
  jumpTo: noop,
  clearPersisted: noop,
};

const designerChrome = () => (
  <>
    <HistoryPanel history={history} />
    <Minimap items={[]} canvasWidth={300} canvasHeight={200} />
    <VersionHistory versions={[]} />
  </>
);

type Names = { undo: string; redo: string; canvasMinimap: string; versionHistory: string };

function expectNamed(names: Names) {
  expect(screen.getByRole('button', { name: names.undo })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: names.redo })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: names.canvasMinimap })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: names.versionHistory })).toBeInTheDocument();
}

describe('designer chrome is named from the pack (objectui#12145)', () => {
  it('with no provider, each name is the en pack value', () => {
    render(designerChrome());
    expectNamed(en.designer);
  });

  it('under zh, each is named by the zh pack, not by the English words', async () => {
    for (const k of ['undo', 'redo', 'canvasMinimap', 'versionHistory'] as const) {
      expect(zh.designer[k]).not.toBe(en.designer[k]);
    }
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        {designerChrome()}
      </I18nProvider>,
    );
    await screen.findByRole('region', { name: zh.designer.versionHistory });
    expectNamed(zh.designer);
    expect(screen.queryByRole('button', { name: en.designer.undo })).toBeNull();
  });
});
