// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13339 — the package sheet's *Adopt loose items*, and the sheet's
 * one message line.
 *
 * Before: *Adopt loose items* asked with the browser's native
 * `window.confirm`, then said "Loose items adopted into this base." whatever
 * moved, so an adoption that found nothing read as one that did. And the
 * message line kept the previous action's answer: a Revert refusal still
 * stood under the Duplicate form opened after it.
 *
 * After, pinned here through the real `PackageDetailSheet`:
 *   - Adopt asks in an in-app dialog, never `window.confirm`; its Cancel sends
 *     nothing, and its confirm sends one `POST …/adopt-orphans`.
 *   - The answer reports the server's own `reassignedCount`
 *     (`ReassignOrphanedMetadataResponse`), 0 included, and a 0 (whose own
 *     `success` is false) is reported as a count, not as a failure.
 *   - Starting any action on the sheet clears the previous action's message,
 *     including the actions that first open a dialog or a form.
 *
 * Every request is recorded by the fetch stub, so "sends nothing" is read off
 * the wire, not off the UI.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { PackageDetailSheet, type InstalledPackageRow } from './PackagesPage';

const PKG_ID = 'com.acme.crm';
const PKG_NAME = 'Acme CRM';
const PKG: InstalledPackageRow = {
  manifest: { id: PKG_ID, name: PKG_NAME, version: '1.0.0', type: 'app' },
  enabled: true,
  status: 'installed',
  source: 'authored',
  writable: true,
};
const DRAFTS = [
  { type: 'object', name: 'acme_lead' },
  { type: 'view', name: 'acme_lead_list' },
];
const REVERT_REFUSAL = 'Nothing to revert on this package';

type Call = { url: string; method: string };
let calls: Call[];
/** What `POST /adopt-orphans` answers; a test may replace it. */
let adoptAnswer: unknown;
let confirmSpy: ReturnType<typeof vi.fn>;
let savedConfirm: PropertyDescriptor | undefined;

function respond(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response;
}

/** The adopt door's answer: the envelope around `ReassignOrphanedMetadataResponse`. */
function adopted(items: Array<{ type: string; name: string }>) {
  return {
    success: true,
    data: {
      // The producer's own verdict: true exactly when something moved.
      success: items.length > 0,
      reassignedCount: items.length,
      reassigned: items,
      targetPackageId: PKG_ID,
    },
  };
}

beforeEach(() => {
  calls = [];
  adoptAnswer = adopted([
    { type: 'object', name: 'loose_a' },
    { type: 'view', name: 'loose_b' },
    { type: 'flow', name: 'loose_c' },
  ]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const method = (init.method ?? 'GET').toUpperCase();
      calls.push({ url: input, method });
      if (input.startsWith('/api/v1/meta/_drafts')) {
        return respond({ success: true, data: { drafts: DRAFTS } });
      }
      if (input.endsWith('/adopt-orphans')) return respond(adoptAnswer);
      if (input.endsWith('/revert')) {
        return respond({ success: false, error: { code: 'NOTHING_TO_REVERT', message: REVERT_REFUSAL } }, 409);
      }
      return respond({ success: true, data: {} });
    }),
  );
  // happy-dom implements no `confirm`; a spy observes (and answers OK to) a
  // native call, so a regression would send the POST and still be caught.
  savedConfirm = Object.getOwnPropertyDescriptor(window, 'confirm');
  confirmSpy = vi.fn(() => true);
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: confirmSpy });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (savedConfirm) Object.defineProperty(window, 'confirm', savedConfirm);
  else delete (window as unknown as Record<string, unknown>).confirm;
});

function renderSheet() {
  const onChanged = vi.fn();
  render(
    <MemoryRouter>
      <PackageDetailSheet pkg={PKG} open onOpenChange={vi.fn()} onChanged={onChanged} />
    </MemoryRouter>,
  );
  return { onChanged };
}

const adoptPosts = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/adopt-orphans'));

/** Let any handler the click scheduled run before reading the wire. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function openAdoptDialog() {
  fireEvent.click(await screen.findByRole('button', { name: 'Adopt loose items' }));
  return screen.findByTestId('pkg-detail-adopt-dialog');
}

async function adoptAndConfirm() {
  const dialog = await openAdoptDialog();
  fireEvent.click(within(dialog).getByTestId('pkg-detail-adopt-confirm'));
  await settle();
}

describe('PackageDetailSheet — Adopt loose items asks in-app (objectui#13339)', () => {
  it('opens an in-app dialog naming the package, never window.confirm, and sends nothing yet', async () => {
    renderSheet();
    const dialog = await openAdoptDialog();
    expect(within(dialog).getByText(`Adopt loose items into "${PKG_NAME}"?`)).toBeInTheDocument();
    await settle();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(adoptPosts()).toEqual([]);
  });

  it('its Cancel sends no request and reports nothing', async () => {
    const { onChanged } = renderSheet();
    const dialog = await openAdoptDialog();
    fireEvent.click(within(dialog).getByTestId('pkg-detail-adopt-cancel'));
    await waitFor(() => expect(screen.queryByTestId('pkg-detail-adopt-dialog')).toBeNull());
    await settle();
    expect(adoptPosts()).toEqual([]);
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.queryByText(/adopted into this base/)).toBeNull();
  });

  it('its confirm sends one POST and closes the dialog', async () => {
    const { onChanged } = renderSheet();
    await adoptAndConfirm();
    expect(adoptPosts()).toHaveLength(1);
    expect(adoptPosts()[0].url).toBe(`/api/v1/packages/${encodeURIComponent(PKG_ID)}/adopt-orphans`);
    await waitFor(() => expect(screen.queryByTestId('pkg-detail-adopt-dialog')).toBeNull());
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe('PackageDetailSheet — Adopt reports the server count (objectui#13339)', () => {
  it('reports the answer’s reassignedCount', async () => {
    renderSheet();
    await adoptAndConfirm();
    expect(await screen.findByText('3 items adopted into this base.')).toBeInTheDocument();
  });

  it('reports 0 when nothing moved: a count, not "adopted" and not a failure', async () => {
    adoptAnswer = adopted([]);
    renderSheet();
    await adoptAndConfirm();
    expect(await screen.findByText('0 items adopted into this base.')).toBeInTheDocument();
    expect(screen.queryByText('Loose items adopted into this base.')).toBeNull();
  });

  it('says "1 item" for one', async () => {
    adoptAnswer = adopted([{ type: 'object', name: 'loose_a' }]);
    renderSheet();
    await adoptAndConfirm();
    expect(await screen.findByText('1 item adopted into this base.')).toBeInTheDocument();
  });
});

describe('PackageDetailSheet — starting an action clears the previous message (objectui#13339)', () => {
  async function showRevertRefusal() {
    fireEvent.click(await screen.findByRole('button', { name: 'Revert' }));
    expect(await screen.findByText(REVERT_REFUSAL, { exact: false })).toBeInTheDocument();
  }

  // Each opens a dialog or a form before anything runs: the press that opens
  // it is where the action starts.
  it.each([
    ['Duplicate'],
    ['Delete app'],
    ['Adopt loose items'],
    [`Discard changes (${DRAFTS.length})`],
    ['View info'],
    ['Edit'],
  ])('a Revert refusal is gone once %s is pressed', async (label) => {
    renderSheet();
    await showRevertRefusal();
    fireEvent.click(await screen.findByRole('button', { name: label }));
    await settle();
    expect(screen.queryByText(REVERT_REFUSAL, { exact: false })).toBeNull();
  });

  it('an Adopt count is gone once Duplicate is pressed', async () => {
    renderSheet();
    await adoptAndConfirm();
    expect(await screen.findByText('3 items adopted into this base.')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate' }));
    await settle();
    expect(screen.queryByText('3 items adopted into this base.')).toBeNull();
    expect(screen.getByTestId('pkg-detail-dup-form')).toBeInTheDocument();
  });
});
