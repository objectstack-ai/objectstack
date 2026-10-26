// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The designer's save->publish loop states ONE package, in BOTH steps —
 * objectui#5420, the consumer half of objectstack#10354.
 *
 * ## The loop this pins
 *
 * `MetadataResourceEditPage` is the designer whose Save writes a draft
 * (`PUT ?mode=draft&package=<id>`) and whose Publish seals it
 * (`POST .../publish`). Before this card the second call named no package at
 * all, so #9612's package-closure narrowing at the runtime publish gate could
 * never fire on an HTTP-driven promotion. Now both steps read the binding from
 * `readActivePackageBinding()` — one derivation, so the two calls of one loop
 * cannot drift apart.
 *
 * ## The acceptance criterion, restated
 *
 * "The designer states the binding it already knows, so the narrowing is
 * REACHABLE." Explicitly NOT "publishing got faster": narrowing has a second,
 * independent gate this does not touch (`narrowObjectsToPackageClosure` keeps
 * every object carrying no `_packageId` provenance, unconditionally, and a
 * tenant-authored overlay corpus carries none), so on such a corpus stating the
 * package narrows nothing. Nothing here asserts a latency claim.
 *
 * ## Which assertions survive a revert, and why the pair is needed
 *
 * The BOUND case fails on a revert — reverted, `doPublish` calls
 * `client.publish(type, name)` with no third argument at all, so both the
 * "options is an object" and the "packageId equals the save's value" pins go
 * red.
 *
 * The UNBOUND case's key-absence pin (`not.toHaveProperty('packageId')`) would
 * ALSO pass on a revert — absence is exactly what the old door did, and no
 * absence assertion can distinguish those two worlds by itself. It is not
 * aimed at the revert: it is the counter-probe for the other failure mode, the
 * one a lone "publish now sends the package" test is trivially satisfiable by,
 * namely always sending it. Its revert-sensitive companion sits beside it in
 * the same case: `expect(options).toBeTypeOf('object')` is red on a revert
 * (undefined) and green on both correct and always-send, so the two together
 * separate all three worlds. Both directions run in the same file, as the card
 * requires.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PAGE = {
  name: 'home',
  label: 'Home',
  type: 'home',
  template: 'default',
  regions: [{ name: 'main', components: [{ type: 'text', id: 'b1' }] }],
};

/**
 * The two option bags this suite reads. Spelled out (rather than letting
 * `vi.fn(async () => ...)` infer a zero-argument mock) because the assertions
 * index into `mock.calls[0]` — an inferred zero-arg mock types that as `[]`,
 * and every index into it is a compile error the vitest run would never show.
 */
type SaveOpts = { force?: boolean; mode?: string; packageId?: string };
type PublishOpts = { message?: string; packageId?: string };

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (_type: string, _name: string, _opts?: { packageId?: string }) => ({
    effective: PAGE,
    code: PAGE,
    editable: true,
  })),
  // A pending draft is what makes the Publish button exist at all.
  getDraft: vi.fn(async (_type: string, _name: string, _opts?: { packageId?: string }) => ({ item: PAGE })),
  get: vi.fn(async () => null),
  save: vi.fn(async (_type: string, _name: string, _item: unknown, _opts?: SaveOpts) => ({})),
  publish: vi.fn(async (_type: string, _name: string, _opts?: PublishOpts) => ({
    success: true,
    version: 4,
  })),
  reset: vi.fn(async () => ({})),
  references: vi.fn(async () => []),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      entries: [{ type: 'page', name: 'page', label: 'Page', allowEnvironmentOverlay: true }],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerMetadataPreview, getMetadataPreview } from './preview-registry';

/**
 * Canvas stand-in. Only job: hand the test a way to dirty the draft, which is
 * what arms the real save door. Turning a canvas gesture into a patch is
 * `PageBlockCanvas`'s own concern and is tested there.
 */
function StubPageCanvas({ onPatch }: { onPatch?: (patch: Record<string, unknown>) => void }) {
  return (
    <button type="button" onClick={() => onPatch?.({ label: 'Edited in the designer' })}>
      patch the draft
    </button>
  );
}

const realPagePreview = getMetadataPreview('page');

/** Put the package scope on the real URL — the same place the loop reads it. */
function atPackageScope(search: string) {
  window.history.replaceState(null, '', `/metadata/page/home${search}`);
  return `/metadata/page/home${search}`;
}

beforeEach(() => {
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  registerMetadataPreview('page', StubPageCanvas as never);
});

afterEach(() => {
  cleanup();
  if (realPagePreview) registerMetadataPreview('page', realPagePreview);
  window.history.replaceState(null, '', '/');
});

function renderAt(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <MetadataResourceEditPage type="page" name="home" />
    </MemoryRouter>,
  );
}

/**
 * Two doors call the SAME `doPublish` — the toolbar button and the
 * "pending changes" banner button. Both are asserted present so a future
 * refactor cannot quietly leave one of them on a second publish path.
 */
function publishButtons() {
  const all = screen.getAllByRole('button', { name: /^Publish$/ });
  expect(all.length).toBe(2);
  return all;
}
const publishButton = () => publishButtons()[0]!;

/** Dirty the draft and let the real save door fire (autosave, 1500 ms). */
async function saveOnce() {
  fireEvent.click(await screen.findByRole('button', { name: 'patch the draft' }));
  await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 8000 });
}

describe('MetadataResourceEditPage — save and publish state ONE package (#5420)', () => {
  it('bound: publish states the SAME id the save states, from the same source', async () => {
    renderAt(atPackageScope('?package=com.example.showcase'));
    await waitFor(() => expect(publishButton()).toBeInTheDocument(), { timeout: 8000 });

    await saveOnce();
    const saveOpts = mockClient.save.mock.calls[0]![3];
    expect(saveOpts).toMatchObject({ mode: 'draft', packageId: 'com.example.showcase' });

    await waitFor(() => expect(publishButton()).toBeEnabled(), { timeout: 8000 });
    fireEvent.click(publishButton());
    await waitFor(() => expect(mockClient.publish).toHaveBeenCalled(), { timeout: 8000 });

    const [type, name, publishOpts] = mockClient.publish.mock.calls[0]!;
    expect([type, name]).toEqual(['page', 'home']);
    // One value, one spelling: byte-identical to what the save stated.
    expect(publishOpts).toEqual({ packageId: 'com.example.showcase' });
    expect(publishOpts?.packageId).toBe(saveOpts?.packageId);
  });

  it('unbound: no package on the URL — the key is ABSENT on the publish, not empty', async () => {
    renderAt(atPackageScope(''));
    await waitFor(() => expect(publishButton()).toBeInTheDocument(), { timeout: 8000 });
    await waitFor(() => expect(publishButton()).toBeEnabled(), { timeout: 8000 });

    fireEvent.click(publishButton());
    await waitFor(() => expect(mockClient.publish).toHaveBeenCalled(), { timeout: 8000 });

    const publishOpts = mockClient.publish.mock.calls[0]![2];
    // Revert-sensitive half: reverted, there is no third argument at all.
    expect(publishOpts).toBeTypeOf('object');
    // Always-send-sensitive half: the key must be absent, never `''`.
    expect(publishOpts).not.toHaveProperty('packageId');
    expect(Object.keys(publishOpts!)).toEqual([]);
  });

  it("unbound: `?package=all` is the show-everything scope, not a package id", async () => {
    renderAt(atPackageScope('?package=all'));
    await waitFor(() => expect(publishButton()).toBeInTheDocument(), { timeout: 8000 });

    // The save folds `all` away too — pin both halves of the fold in one run so
    // the two calls cannot disagree about what `all` means.
    await saveOnce();
    expect(mockClient.save.mock.calls[0]![3]).not.toHaveProperty('packageId');

    await waitFor(() => expect(publishButton()).toBeEnabled(), { timeout: 8000 });
    fireEvent.click(publishButton());
    await waitFor(() => expect(mockClient.publish).toHaveBeenCalled(), { timeout: 8000 });

    const publishOpts = mockClient.publish.mock.calls[0]![2];
    expect(publishOpts).toBeTypeOf('object');
    expect(publishOpts).not.toHaveProperty('packageId');
  });
});
