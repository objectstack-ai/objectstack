// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26858 — the edit page provides the served verdict on the body
 * on screen (`DraftVerdictContext`), so a field inside it — the flow edge
 * condition, the CEL editors — can read the errors at its own path.
 *
 * The canvas stand-in below reads the context exactly as a field does
 * (`useServerErrorsAt`) at one path and at a sibling. The server double serves
 * a pending draft whose verdict refuses that path, the way the draft read does
 * since objectstack#26707.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const REFUSAL = 'region "main" names a component this deployment does not have';

const server = vi.hoisted(() => ({ draft: null as Record<string, unknown> | null }));

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => ({
    code: null,
    overlay: server.draft,
    overlayScope: 'env',
    effective: server.draft,
    _diagnostics: { valid: true },
    editable: true,
    deletable: true,
    resettable: false,
    lock: 'none',
  })),
  getDraft: vi.fn(async (type: string, name: string) => {
    if (!server.draft) throw Object.assign(new Error('No pending draft'), { code: 'NO_DRAFT', status: 404 });
    return {
      type,
      name,
      item: {
        ...server.draft,
        _draft: true,
        _diagnostics: { valid: false, errors: [{ path: 'regions.0', message: REFUSAL, code: 'page-component-unknown' }] },
      },
    };
  }),
  save: vi.fn(async (type: string, name: string, item: unknown) => ({ type, name, item })),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      entries: [{ type: 'page', name: 'page', label: 'Page', allowEnvironmentOverlay: true, schema: { required: [] } }],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerMetadataPreview, getMetadataPreview } from './preview-registry';
import { useServerErrorsAt } from './draftVerdict';

/** Reads the page's verdict the way an expression field does. */
function VerdictProbe() {
  const here = useServerErrorsAt('regions.0');
  const sibling = useServerErrorsAt('regions.1');
  return (
    <>
      <pre data-testid="at-path">{here.map((e) => e.message).join('|')}</pre>
      <pre data-testid="at-sibling">{sibling.map((e) => e.message).join('|')}</pre>
    </>
  );
}

const realPage = getMetadataPreview('page');

beforeEach(() => {
  server.draft = { name: 'home', label: 'Home', type: 'home', template: 'default', regions: [{ name: 'main', components: [] }] };
  registerMetadataPreview('page', VerdictProbe as never);
});

afterEach(() => {
  cleanup();
  if (realPage) registerMetadataPreview('page', realPage);
  window.history.replaceState(null, '', '/');
});

describe('MetadataResourceEditPage provides the served verdict to the fields inside it (objectstack#26858)', () => {
  it('a field at the refused path reads the refusal; a sibling path reads nothing', async () => {
    window.history.replaceState(null, '', '/metadata/page/home');
    render(
      <MemoryRouter initialEntries={['/metadata/page/home']}>
        <MetadataResourceEditPage type="page" name="home" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('at-path')).toHaveTextContent(REFUSAL), { timeout: 8000 });
    expect(screen.getByTestId('at-sibling')).toHaveTextContent('');
  });
});
