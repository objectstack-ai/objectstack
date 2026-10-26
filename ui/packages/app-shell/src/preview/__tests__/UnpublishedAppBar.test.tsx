/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * UnpublishedAppBar — reads the ADR-0045 publish gate `_unpublished`, NOT the
 * navigation flag `hidden` (objectstack#6955, the objectui half of the #4829 A1
 * ruling; framework half PR #6942).
 *
 * The two keys used to be one, and splitting them made the old read wrong in
 * BOTH directions at once — which is why the cases below assert each direction
 * separately rather than one "happy path":
 *
 *   • a PUBLISHED app that is merely nav-hidden (`hidden: true`, the built-in
 *     `account` app) must NOT wear the unpublished watermark;
 *   • a genuinely unpublished app must wear it even when `hidden` is absent or
 *     false — the server withholds it from non-builders, so this bar is the
 *     builder's only signal that what they are looking at is not live yet.
 *
 * The publish write is asserted on the REQUEST BODY, not just on "a PUT
 * happened": the whole defect class here is writing the right verb at the wrong
 * key, which a status-code assertion cannot see.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let previewMode = false;
vi.mock('../PreviewModeContext', () => ({
  usePreviewDrafts: () => previewMode,
  markPreviewExit: vi.fn(),
  PREVIEW_QUERY_FLAG: 'preview',
}));

// Spread the real module: `@object-ui/components` pulls other exports from it
// (`createSafeTranslation`), and a bare factory would blank them out.
vi.mock('@object-ui/i18n', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@object-ui/i18n');
  return {
    ...actual,
    useObjectTranslation: () => ({
      t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key,
    }),
  };
});

const refresh = vi.fn();
let apps: Array<Record<string, unknown>> = [];
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps, refresh }),
}));

// The commit timeline is a dialog with its own fetches; this file measures the
// bar's read point and its publish body, not ADR-0067 history.
vi.mock('../CommitTimeline', () => ({ CommitTimeline: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { UnpublishedAppBar } from '../UnpublishedAppBar';

function renderBar() {
  return render(
    <MemoryRouter initialEntries={['/apps/crm']}>
      <UnpublishedAppBar />
    </MemoryRouter>,
  );
}

function mockPutOk() {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
}

/** The single `PUT /api/v1/meta/app/:name` the Publish button fires. */
function publishBody(): Record<string, unknown> {
  const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
  expect(calls.length).toBe(1);
  const [url, init] = calls[0] as [string, RequestInit];
  expect(url).toBe('/api/v1/meta/app/crm');
  expect(init.method).toBe('PUT');
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  previewMode = false;
  apps = [];
  refresh.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UnpublishedAppBar — reads `_unpublished`, never `hidden`', () => {
  it('shows the watermark for an unpublished app', () => {
    apps = [{ name: 'crm', _unpublished: true }];
    renderBar();
    expect(screen.getByTestId('unpublished-app-bar')).toBeInTheDocument();
    expect(screen.getByTestId('unpublished-app-publish')).toBeInTheDocument();
  });

  it('shows it for an unpublished app that is ALSO nav-hidden — the read is `_unpublished` alone, not either-of', () => {
    apps = [{ name: 'crm', _unpublished: true, hidden: true }];
    renderBar();
    expect(screen.getByTestId('unpublished-app-bar')).toBeInTheDocument();
  });

  it('⛔ does NOT show it for a PUBLISHED app that is merely nav-hidden (the `account` app)', () => {
    // The live skew this card fixes: since framework 97b0798, `hidden` means
    // navigation presentation only — "Hidden apps stay fully routable and
    // permission-checked". Painting the unpublished watermark here told the
    // user their live app was invisible to their users, which was false.
    apps = [{ name: 'crm', hidden: true }];
    renderBar();
    expect(screen.queryByTestId('unpublished-app-bar')).not.toBeInTheDocument();
  });

  it('stays silent for an app that is neither unpublished nor hidden', () => {
    apps = [{ name: 'crm' }];
    renderBar();
    expect(screen.queryByTestId('unpublished-app-bar')).not.toBeInTheDocument();
  });

  it('treats `_unpublished: false` as published — the gate is two-state, not presence-based', () => {
    apps = [{ name: 'crm', _unpublished: false, hidden: true }];
    renderBar();
    expect(screen.queryByTestId('unpublished-app-bar')).not.toBeInTheDocument();
  });

  it('yields to the draft-preview watermark in preview mode (never stacks both bars)', () => {
    previewMode = true;
    apps = [{ name: 'crm', _unpublished: true }];
    renderBar();
    expect(screen.queryByTestId('unpublished-app-bar')).not.toBeInTheDocument();
  });
});

describe('UnpublishedAppBar — the Publish write', () => {
  it('PUTs `_unpublished: false` and never writes the `hidden` key', async () => {
    apps = [{ name: 'crm', _unpublished: true }];
    mockPutOk();
    renderBar();
    screen.getByTestId('unpublished-app-publish').click();

    await waitFor(() => {
      expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });
    const body = publishBody();
    expect(body._unpublished).toBe(false);
    // The publish gate is the ONLY key this write decides. Sending
    // `hidden: false` — what this bar used to do — republished the app AND
    // silently rewrote the author's navigation choice.
    expect(body).not.toHaveProperty('hidden');
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('carries the app\'s existing `hidden` through untouched — publishing is not an unhide', async () => {
    apps = [{ name: 'crm', _unpublished: true, hidden: true, label: 'CRM' }];
    mockPutOk();
    renderBar();
    screen.getByTestId('unpublished-app-publish').click();

    await waitFor(() => {
      expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });
    const body = publishBody();
    expect(body._unpublished).toBe(false);
    // Still hidden from the launcher, now published — a legitimate end state
    // (the `account` app lives in exactly it), and the server's own
    // publish-drafts flip preserves `hidden` the same way.
    expect(body.hidden).toBe(true);
    expect(body.label).toBe('CRM');
  });
});
