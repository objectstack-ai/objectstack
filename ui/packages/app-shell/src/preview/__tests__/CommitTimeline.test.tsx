/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3529 — the PRESENTATION half. A better error object is worth nothing
 * if the panel still shows the operator a number, so the distinction is pinned
 * where they actually read it.
 *
 * The `t` mock returns each call site's `defaultValue`, which the i18n
 * call-site gate (objectui#3810) holds byte-equal to the `en` pack value — so
 * asserting on these strings is asserting on what ships.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Partial mock: only `useObjectTranslation` is replaced. `@object-ui/components`
// (Sheet -> dialog -> close-label) reaches for `createSafeTranslation` from this
// same module, so a wholesale mock fails the suite at import time.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/i18n')>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
  }),
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
  },
}));

import { CommitTimeline } from '../CommitTimeline';

afterEach(() => {
  vi.restoreAllMocks();
  toastError.mockReset();
});

const OUTAGE_ENVELOPE = {
  success: false,
  error: { code: 'SERVICE_UNAVAILABLE', message: 'Internal server error', httpStatus: 503 },
};

function mockCommitsResponse(status: number, body: unknown | null) {
  global.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === null) throw new SyntaxError('not JSON');
      return body;
    },
  })) as unknown as typeof fetch;
}

function renderTimeline() {
  return render(<CommitTimeline open onOpenChange={() => {}} packageId="com.x" />);
}

describe('CommitTimeline — a 503 reads as a retryable outage, not a number', () => {
  it('shows the unreachable copy for the real outage envelope', async () => {
    mockCommitsResponse(503, OUTAGE_ENVELOPE);

    renderTimeline();

    const box = await screen.findByTestId('commit-history-error');
    expect(box).toHaveTextContent(
      'Commit store temporarily unreachable — this read did not happen, so no history is shown. Retry in a moment.',
    );
  });

  it('never shows the operator the bare status code, nor the withheld prose', async () => {
    mockCommitsResponse(503, OUTAGE_ENVELOPE);

    renderTimeline();

    const box = await screen.findByTestId('commit-history-error');
    expect(box.textContent).not.toContain('commits HTTP 503');
    expect(box.textContent).not.toContain('503');
    // The producer's withheld sentence must not be what the operator reads.
    expect(box.textContent).not.toContain('Internal server error');
  });

  it('a BARE 503 still produces the retryable presentation (status alone)', async () => {
    mockCommitsResponse(503, null);

    renderTimeline();

    const box = await screen.findByTestId('commit-history-error');
    expect(box).toHaveTextContent(
      'Commit store temporarily unreachable — this read did not happen, so no history is shown. Retry in a moment.',
    );
  });
});

describe('CommitTimeline — 404 and 500 keep their own presentation', () => {
  it('a 404 does not claim the store is unreachable', async () => {
    mockCommitsResponse(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: 'Package not found', httpStatus: 404 },
    });

    renderTimeline();

    const box = await screen.findByTestId('commit-history-error');
    expect(box).toHaveTextContent('Could not load history: Package not found');
    expect(box.textContent).not.toContain('unreachable');
  });

  it('a 500 does not claim the store is unreachable either', async () => {
    mockCommitsResponse(500, null);

    renderTimeline();

    const box = await screen.findByTestId('commit-history-error');
    expect(box).toHaveTextContent('Could not load history: commits HTTP 500');
    expect(box.textContent).not.toContain('unreachable');
  });

  it('the three classes render three different sentences', async () => {
    const rendered: string[] = [];
    for (const [status, body] of [
      [404, null],
      [500, null],
      [503, null],
    ] as const) {
      mockCommitsResponse(status, body);
      const view = renderTimeline();
      const box = await screen.findByTestId('commit-history-error');
      rendered.push(box.textContent ?? '');
      view.unmount();
    }
    expect(new Set(rendered).size).toBe(3);
  });
});

describe('CommitTimeline — fail-loud: an error is never an empty history', () => {
  it.each([
    ['503', 503],
    ['404', 404],
    ['500', 500],
  ])('%s never renders the "no history yet" copy', async (_label, status) => {
    mockCommitsResponse(status, null);

    renderTimeline();

    await screen.findByTestId('commit-history-error');
    expect(screen.queryByText('No history yet for this app.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('commit-row')).not.toBeInTheDocument();
  });

  it('an empty history from a SUCCESSFUL read still reads as empty', async () => {
    mockCommitsResponse(200, { commits: [] });

    renderTimeline();

    await waitFor(() =>
      expect(screen.getByText('No history yet for this app.')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('commit-history-error')).not.toBeInTheDocument();
  });
});
