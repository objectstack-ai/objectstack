// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11807 — Studio's publish says how many items went live, and an
 * answer in which nothing went live is never told as a success.
 *
 * ## What was measured before this card
 *
 * The success toast already fired on this surface: with the real review sheet
 * and the real client, a publish of two drafts toasted the one sentence that
 * names no number — "Published all drafts in this package (one atomic
 * release)". So the gap was the count, not the toast. And two zero answers were
 * wrong in opposite directions: the package-less scope toasted its success
 * sentence after publishing nothing, and the batch's `nothing_to_publish`
 * answer (`success: false`, which the spec says not to read as a refusal) was
 * thrown as a failure. A refusal itself reached the author as "Action failed":
 * the batch's own `success` is false on it, and that was read before
 * `failed[]`, where the refused item and its reason are.
 *
 * ## Real vs stubbed
 *
 * Real: the surface, `useMetadataClient` and the client it builds — which is
 * what unwraps the batch route's `{ success, data }` envelope, so `published[]`
 * is read through the same composition the console reads it through. Stubbed:
 * `sonner`, `globalThis.fetch` (the server), `packages-io`'s package list, and
 * `DraftChangesPanel`, reduced to the button that fires `onPublish` (the sheet
 * has its own tests, `../../preview/__tests__/`).
 *
 * The expected sentences are read from the string table through the same
 * `tFormat` the surface calls, so what is pinned is which row and which count,
 * never the prose.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const PACKAGE_ID = 'app.b2r4';

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
  },
  Toaster: () => null,
}));

vi.mock('./packages-io', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchPackages: vi.fn(async () => [
      { id: PACKAGE_ID, name: PACKAGE_ID, writable: true, namespace: 'b2r4' },
    ]),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});

vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({
  DraftChangesPanel: ({ onPublish }: { onPublish?: () => void | Promise<void> }) =>
    onPublish ? (
      <button type="button" data-testid="publish-all-drafts" onClick={() => void onPublish()}>
        publish
      </button>
    ) : null,
}));

import { toast } from 'sonner';
import { StudioDesignSurface } from './StudioDesignSurface';
import { t, tFormat } from '../metadata-admin/i18n';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

/**
 * A batch answer as the producer sends it: the protocol's result, which carries
 * its own `success` (`=== (outcome === 'published')`, pinned upstream), inside
 * the dispatcher's `{ success: true, data }` envelope — `true` on every 200,
 * the refusals and `nothing_to_publish` included.
 */
function batch(data: Record<string, unknown>) {
  return { success: true, data: { success: data.outcome === 'published', ...data } };
}

const published = (...names: string[]) =>
  names.map((name, i) => ({ type: 'object', name, version: `sha256:${i}` }));

let batchBody: unknown;
let orgDrafts: Array<{ type: string; name: string; packageId: null; label?: string }> = [];
/** Every publish request the surface sent: the batch door and the by-reference one. */
const posts: string[] = [];

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  posts.length = 0;
  orgDrafts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (/\/publish(-drafts)?$/.test(url)) posts.push(url);
      if (url.includes('/publish-drafts')) return json(batchBody);
      if (/\/meta\/flow\/[^/]+\/publish$/.test(url)) return json({ success: true });
      if (url === '/api/v1/meta/_drafts') return json({ drafts: orgDrafts });
      // Every other read (the package's drafts count, the type registry, the
      // pillar lists) answers empty — none of them is under test here.
      return json([]);
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function publishAt(path: string, expectPosts: number): Promise<void> {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByTestId('publish-all-drafts'));
  await waitFor(() => expect(posts).toHaveLength(expectPosts));
}

/** Every toast the publish raised, by kind. */
function toasts() {
  return {
    success: vi.mocked(toast.success).mock.calls.map((c) => c[0]),
    info: vi.mocked(toast.info).mock.calls.map((c) => c[0]),
    error: vi.mocked(toast.error).mock.calls.map((c) => c[0]),
  };
}

describe('the package publish names how many items went live, and what was refused (objectui#11807)', () => {
  it('two published items: the count row, with 2', async () => {
    batchBody = batch({
      outcome: 'published',
      publishedCount: 2,
      failedCount: 0,
      published: published('repairs_repair_ticket', 'visit'),
      failed: [],
    });
    await publishAt(`/studio/${PACKAGE_ID}/interfaces`, 1);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toasts().success).toEqual([tFormat('engine.studio.publishedAllCount', 'en', { count: 2 })]);
    expect(toasts().error).toEqual([]);
  });

  it('one published item: the singular row, with 1', async () => {
    batchBody = batch({
      outcome: 'published',
      publishedCount: 1,
      failedCount: 0,
      published: published('visit'),
      failed: [],
    });
    await publishAt(`/studio/${PACKAGE_ID}/interfaces`, 1);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toasts().success).toEqual([tFormat('engine.studio.publishedAllCountOne', 'en', { count: 1 })]);
  });

  it('nothing to publish: said as such, neither a success nor a failure', async () => {
    batchBody = batch({ outcome: 'nothing_to_publish', publishedCount: 0, failedCount: 0, published: [], failed: [] });
    await publishAt(`/studio/${PACKAGE_ID}/interfaces`, 1);
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(toasts()).toEqual({ success: [], info: [t('engine.studio.publishNoneTitle', 'en')], error: [] });
  });

  it('a refused batch claims no success, and names the refused item with the server’s reason', async () => {
    // The refusal as the producer answers it: the batch's own `success` is
    // false AND `failed[]` carries the reason. Read `success` first and the
    // reason never reaches the author (measured: "Action failed").
    const reason = 'sharingModel is not set';
    batchBody = batch({
      outcome: 'refused',
      publishedCount: 0,
      failedCount: 1,
      published: [],
      failed: [{ type: 'object', name: 'visit', error: reason, code: 'SECURITY_OWD_UNSET' }],
    });
    await publishAt(`/studio/${PACKAGE_ID}/interfaces`, 1);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toasts().success).toEqual([]);
    expect(toasts().info).toEqual([]);
    expect(toasts().error).toEqual([tFormat('engine.studio.publishRefusedOne', 'en', { count: 1 })]);
    // objectstack#26730 — the item and its reason ride in the description; the
    // reason is also kept on the item's Pending changes entry.
    const description = (vi.mocked(toast.error).mock.calls[0][1] as { description?: string } | undefined)?.description;
    expect(description).toContain('visit');
    expect(description).toContain(reason);
  });
});

describe('the package-less publish names its count, and its zero is no success (objectui#11807)', () => {
  it('two package-less flow drafts: the count row, with 2', async () => {
    orgDrafts = [
      { type: 'flow', name: 'qa_alert_clone', packageId: null },
      { type: 'flow', name: 'qa_digest_clone', packageId: null },
    ];
    await publishAt('/studio/~org/automations', 2);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toasts().success).toEqual([tFormat('engine.studio.publishedAllFlows', 'en', { count: 2 })]);
  });

  // #27356 row 18 (hotcrm#2320 Studio S7): the toast names what went live.
  it('one package-less flow draft: the toast names it by its label', async () => {
    orgDrafts = [{ type: 'flow', name: 'qa_alert_clone', packageId: null, label: 'QA alert (copy)' }];
    await publishAt('/studio/~org/automations', 1);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toasts().success).toEqual([tFormat('engine.studio.publishedAllFlowsOne', 'en', { label: 'QA alert (copy)' })]);
    expect(toasts().success[0]).toContain('QA alert (copy)');
  });

  it('several: the count row, the flows named in the description (label, else name)', async () => {
    orgDrafts = [
      { type: 'flow', name: 'qa_alert_clone', packageId: null, label: 'QA alert (copy)' },
      { type: 'flow', name: 'qa_digest_clone', packageId: null },
    ];
    await publishAt('/studio/~org/automations', 2);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const description = (vi.mocked(toast.success).mock.calls[0][1] as { description?: string } | undefined)?.description;
    expect(description).toBe('QA alert (copy), qa_digest_clone');
  });

  it('none pending by the time of the read: no success claimed', async () => {
    orgDrafts = [];
    await publishAt('/studio/~org/automations', 0);
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(toasts()).toEqual({ success: [], info: [t('engine.studio.publishNoneTitle', 'en')], error: [] });
  });
});

// objectstack#27521 (Studio row 35) — a published app or object reaches
// members only through a permission set, and nothing said so: the author found
// out when a member reported an empty app. The toast now says it and offers
// the way to Access.
describe('a publish that put an app or object live points the author to Access (objectstack#27521)', () => {
  function LocationProbe() {
    return <div data-testid="location">{useLocation().pathname}</div>;
  }

  it('an object went live: the hint, and "Open Access" leads to the Access pillar', async () => {
    batchBody = batch({
      outcome: 'published',
      publishedCount: 1,
      failedCount: 0,
      published: published('visit'),
      failed: [],
    });
    render(
      <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/data`]}>
        <Routes>
          <Route path="/studio/:packageId/:tab" element={<><StudioDesignSurface /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByTestId('publish-all-drafts'));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [title, options] = vi.mocked(toast.success).mock.calls[0] as [
      string,
      { description?: string; action?: { label: string; onClick: () => void } },
    ];
    expect(title).toBe(tFormat('engine.studio.publishedAllCountOne', 'en', { count: 1 }));
    expect(options.description).toBe(t('engine.studio.publishedAccessHint', 'en'));
    expect(options.action?.label).toBe(t('engine.studio.publishedOpenAccess', 'en'));
    options.action!.onClick();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/studio/${PACKAGE_ID}/access`));
  });

  it('CONTROL — only a flow went live: the plain toast, no Access hint', async () => {
    batchBody = batch({
      outcome: 'published',
      publishedCount: 1,
      failedCount: 0,
      published: [{ type: 'flow', name: 'visit_reminder', version: 'sha256:0' }],
      failed: [],
    });
    await publishAt(`/studio/${PACKAGE_ID}/automations`, 1);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(vi.mocked(toast.success).mock.calls[0]).toEqual([tFormat('engine.studio.publishedAllCountOne', 'en', { count: 1 })]);
  });
});
