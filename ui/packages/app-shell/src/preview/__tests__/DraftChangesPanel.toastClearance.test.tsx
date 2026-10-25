// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The publish panel's primary button is not allowed to open underneath a toast
 * — objectui#5416 defect 3.
 *
 * Measured on the card's own walk: 发布 → 待发布的变更 opens this sheet, whose
 * `mt-auto` footer carries 全部发布 at the bottom of a `side="right"` panel,
 * while the console mounts its toaster bottom-right (`apps/console/src/App.tsx`)
 * — so a save toast raised on the way here (`对象「…」已存为草稿`, 4s default)
 * sat directly on top of the button until it timed out.
 *
 * The fix is a lifetime, not a corner: opening the review surface clears the
 * stack the surface the author just left had raised. Repositioning the toaster
 * was measured and rejected — every other corner of this console is occupied
 * (the draft preview bar is `sticky top-0` and carries its own publish
 * actions, `NotificationSnackbar` anchors bottom-centre, the nav rail owns the
 * left edge), so a move only relocates the same collision.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

// `vi.mock` is hoisted above every top-level statement, so the spy the factory
// closes over has to be hoisted with it — a plain `const dismiss = vi.fn()`
// here is still in its temporal dead zone when the factory runs.
const { dismiss } = vi.hoisted(() => ({ dismiss: vi.fn() }));
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: Object.assign(vi.fn(), { dismiss, success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/i18n')>();
  return {
    ...mod,
    useObjectTranslation: () => ({
      t: (k: string, o?: { defaultValue?: string; count?: number }) =>
        (o?.defaultValue ?? k).replace('{{count}}', String(o?.count ?? '')),
    }),
  };
});

import { DraftChangesPanel } from '../DraftChangesPanel';

function stubDrafts() {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/_drafts')) {
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => [] } as unknown as Response;
  }) as typeof fetch;
}

afterEach(() => {
  dismiss.mockClear();
  vi.restoreAllMocks();
});

describe('DraftChangesPanel — toast clearance (objectui#5416)', () => {
  it('leaves the toast stack alone while it is closed', () => {
    stubDrafts();
    render(<DraftChangesPanel open={false} onOpenChange={vi.fn()} packageId="com.acme.crm" />);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('clears the stack when the panel opens', () => {
    stubDrafts();
    render(<DraftChangesPanel open onOpenChange={vi.fn()} packageId="com.acme.crm" />);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('clears again on the next open, not on every render in between', () => {
    stubDrafts();
    const { rerender } = render(
      <DraftChangesPanel open={false} onOpenChange={vi.fn()} packageId="com.acme.crm" />,
    );
    rerender(<DraftChangesPanel open onOpenChange={vi.fn()} packageId="com.acme.crm" />);
    expect(dismiss).toHaveBeenCalledTimes(1);

    // A re-render while open must NOT keep wiping the stack — a toast this
    // panel's own publish raises has to survive.
    rerender(<DraftChangesPanel open onOpenChange={vi.fn()} packageId="com.acme.crm" />);
    expect(dismiss).toHaveBeenCalledTimes(1);

    rerender(<DraftChangesPanel open={false} onOpenChange={vi.fn()} packageId="com.acme.crm" />);
    rerender(<DraftChangesPanel open onOpenChange={vi.fn()} packageId="com.acme.crm" />);
    expect(dismiss).toHaveBeenCalledTimes(2);
  });
});
