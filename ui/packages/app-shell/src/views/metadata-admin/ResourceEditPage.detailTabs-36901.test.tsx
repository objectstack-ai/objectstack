// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36901 (epic objectstack#36890, decisions 4 and 8) — the generic
 * item page under its detail header, with its tools as tabs:
 *
 *  - a plain type opens on Details; a type with a canvas opens on Preview,
 *    and the canvas and the Details form edit ONE draft, so an edit on the
 *    canvas is in the draft every other tab reads (decision 4);
 *  - the draft review is the header's status chip, and `?review=1` still
 *    opens it (and is consumed);
 *  - carry-forward N2: the header's Esc listener is document-wide, and the
 *    canvas fullscreen is not a Radix layer, so while it is up Esc leaves the
 *    fullscreen and the page stays; with no overlay up Esc is the header's ×.
 *
 * The real page, header and tabs run; the metadata client is a double and the
 * canvas is a registered stub.
 */

import '@testing-library/jest-dom/vitest';
// The source under test reaches a dynamic import of this module: its first load is paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const BODY = { name: 'w1', label: 'Shipped' };

const state = vi.hoisted(() => ({ draft: null as Record<string, unknown> | null }));

const client = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async () => state.draft),
  references: vi.fn(async () => []),
  history: vi.fn(async () => ({ events: [] })),
  audit: vi.fn(async () => ({ events: [] })),
  layered: vi.fn(async () => ({
    code: BODY,
    overlay: null,
    overlayScope: null,
    effective: BODY,
    provenance: 'package',
    packageId: 'com.acme.app',
    editable: true,
    deletable: true,
  })),
}));

const SCHEMA = { type: 'object', properties: { name: { type: 'string' }, label: { type: 'string' } } };

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useMetadata')>()),
  useMetadataClient: () => client,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [
      { type: 'canvas_36901', label: 'Canvas thing', allowEnvironmentOverlay: true, allowRuntimeCreate: true, schema: SCHEMA },
      { type: 'plain_36901', label: 'Plain thing', allowEnvironmentOverlay: true, allowRuntimeCreate: true, schema: SCHEMA },
    ],
  }),
}));
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => true,
  useCanReadAuthoringTrail: () => true,
}));

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

// Monaco's loader fails (offline), so the JSON source editor is its textarea.
vi.mock('@monaco-editor/react', () => {
  const Editor = () => null;
  return { Editor, default: Editor, loader: { init: () => Promise.reject(new Error('offline')) } };
});
vi.mock('@object-ui/plugin-editor', () => ({ configureBundledMonaco: () => Promise.resolve() }));

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerMetadataPreview, type MetadataPreviewProps } from './preview-registry';
import { t } from './i18n';

/** The canvas: draws the draft's label and patches it on a click. */
function CanvasStub({ draft, onPatch }: MetadataPreviewProps) {
  return (
    <div data-testid="canvas-stub">
      <span data-testid="canvas-label">{String(draft.label ?? '')}</span>
      <button type="button" onClick={() => onPatch?.({ label: 'Edited on canvas' })}>
        patch
      </button>
    </div>
  );
}
registerMetadataPreview('canvas_36901', CanvasStub);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.draft = null;
});

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

function open(type: string, search = '') {
  const at = `/studio/com.acme.app/metadata/${type}/w1${search}`;
  window.history.replaceState({}, '', at);
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/studio/:pkg/metadata/:type" element={<p data-testid="list-page">list</p>} />
        <Route path="/studio/:pkg/metadata/:type/:name" element={<MetadataResourceEditPage type={type} name="w1" />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent ?? '';

describe('the item page opens on its tab (decision 4)', () => {
  it('a plain type opens on Details, under the detail header, with no Preview tab', async () => {
    open('plain_36901', '?package=com.acme.app');
    expect(await screen.findByTestId('item-tab-details')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('resource-detail-header')).toBeInTheDocument();
    expect(screen.queryByTestId('item-tab-preview')).toBeNull();
    expect(screen.queryByTestId('canvas-stub')).toBeNull();
  });

  it('a canvas type opens on Preview, and a canvas edit is in the one draft the other tabs read', { timeout: 15000 }, async () => {
    open('canvas_36901', '?package=com.acme.app');
    expect(await screen.findByTestId('canvas-stub')).toBeInTheDocument();
    expect(screen.getByTestId('item-tab-preview')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('canvas-label')).toHaveTextContent('Shipped');

    fireEvent.click(screen.getByRole('button', { name: 'patch' }));
    expect(screen.getByTestId('canvas-label')).toHaveTextContent('Edited on canvas');

    // Source reads the same buffer: the unsaved canvas edit is there.
    fireEvent.click(screen.getByTestId('item-tab-source'));
    const source = await screen.findByRole('textbox', { name: 'JSON source' }, { timeout: 8000 });
    expect((source as HTMLTextAreaElement).value).toContain('Edited on canvas');

    // Back on Preview the edit is still the canvas's: the switch kept it.
    fireEvent.click(screen.getByTestId('item-tab-preview'));
    expect(await screen.findByTestId('canvas-label')).toHaveTextContent('Edited on canvas');
    expect(client.layered).toHaveBeenCalledTimes(1);
  });
});

describe('the draft review is a header chip (decision 8)', () => {
  it('?review=1 opens the review and is consumed; the chip opens it again', async () => {
    state.draft = { type: 'plain_36901', name: 'w1', item: { name: 'w1', label: 'Drafted' } };
    open('plain_36901', '?package=com.acme.app&review=1');
    expect(await screen.findByTestId('draft-review-panel')).toBeInTheDocument();
    await waitFor(() => expect(where()).toBe('/studio/com.acme.app/metadata/plain_36901/w1?package=com.acme.app'));
    expect(screen.getByTestId('resource-review-trigger')).toHaveTextContent(t('engine.studio.unpublishedDraft', 'en-US'));

    fireEvent.keyDown(screen.getByTestId('draft-review-panel'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('draft-review-panel')).toBeNull());
    // The Radix sheet took that Esc: the page is still open.
    expect(screen.getByTestId('resource-detail-header')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('resource-review-trigger'));
    expect(await screen.findByTestId('draft-review-panel')).toBeInTheDocument();
  });

  it('CONTROL: no pending draft, no chip, and ?review=1 opens nothing', async () => {
    open('plain_36901', '?package=com.acme.app&review=1');
    await screen.findByTestId('item-tab-details');
    await waitFor(() => expect(where()).toBe('/studio/com.acme.app/metadata/plain_36901/w1?package=com.acme.app'));
    expect(screen.queryByTestId('resource-review-trigger')).toBeNull();
    expect(screen.queryByTestId('draft-review-panel')).toBeNull();
  });
});

describe('carry-forward N2 — Esc reaches the non-Radix fullscreen first', () => {
  it('Esc leaves the canvas fullscreen and the page stays; the next Esc is the header ×', async () => {
    open('canvas_36901', '?package=com.acme.app');
    await screen.findByTestId('canvas-stub');
    fireEvent.click(screen.getByTitle(t('engine.edit.fullscreen', 'en-US')));
    expect(screen.getByTitle(t('engine.edit.exitFullscreen', 'en-US'))).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTitle(t('engine.edit.fullscreen', 'en-US'))).toBeInTheDocument());
    expect(screen.getByTestId('canvas-stub')).toBeInTheDocument();
    expect(where()).toBe('/studio/com.acme.app/metadata/canvas_36901/w1?package=com.acme.app');

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(await screen.findByTestId('list-page')).toBeInTheDocument();
    expect(where()).toBe('/studio/com.acme.app/metadata/canvas_36901?package=com.acme.app');
  });
});
