// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10585 — the Hook inspector's object picker makes its two claims
 * only from a roster that ANSWERED.
 *
 * The picker makes two claims from the object catalog `useObjectOptions`
 * fetches: a selected object the catalog does not list is flagged
 * `(not published)`, and an empty list prints "No objects found — publish an
 * object, then pick it here." Both used to be read off `options` alone, and
 * `options` is `[]` while the fetch is in flight and after it failed — exactly
 * what a catalog with no objects leaves. So every selected object was called
 * unpublished, and the author was told to publish one, before the catalog had
 * spoken and, on a failed fetch, permanently.
 *
 * The rule is the one objectui#8862 / objectui#9651 set for the designer's
 * pickers, and the arms are the ones `ViewColumnInspector.rosterFailure.test.tsx`
 * pins for that inspector:
 *
 *   • in flight   → no flag, no "publish" copy, no failure notice
 *   • FAILED      → no flag, no "publish" copy, plus a notice naming the cause,
 *                   and the selection stays editable
 *   • answered, object genuinely absent → flag, and an empty answered catalog
 *                   still prints the "publish" copy (the controls that the
 *                   claims still fire when they are true)
 *
 * The real `useObjectOptions` runs; only the metadata client is stubbed, and
 * its `list` is settled by the test.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor, fireEvent } from '@testing-library/react';

const state = vi.hoisted(() => {
  let settle = {
    resolve: (_d: unknown) => {},
    reject: (_e: unknown) => {},
  };
  const pending = { current: new Promise<unknown>(() => {}) };
  return {
    metadataClient: {
      get: vi.fn(async () => undefined),
      withPreviewDrafts() { return this; },
      list: vi.fn(() => pending.current),
    },
    /** Arm a fresh unsettled `list` response; call before mounting. */
    hold() {
      pending.current = new Promise<unknown>((resolve, reject) => {
        settle = { resolve, reject };
      });
      // The hook attaches its own handler only after mount; without this the
      // rejection is "unhandled" for one turn and fails the test itself.
      pending.current.catch(() => {});
    },
    land(docs: unknown) {
      settle.resolve(docs);
    },
    fail(err: unknown) {
      settle.reject(err);
    },
  };
});

vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { HookDefaultInspector } from './HookDefaultInspector';

afterEach(cleanup);

const FLAGGED = 'ghost_object (not published)';
const PUBLISH_COPY = /publish an object/;

function mount(object?: string) {
  state.hold();
  const onPatch = vi.fn();
  render(
    <HookDefaultInspector
      type="hook"
      name="audit_hook"
      draft={{ name: 'audit_hook', events: ['beforeInsert'], ...(object ? { object } : {}) }}
      onPatch={onPatch}
      readOnly={false}
      locale="en-US"
    />,
  );
  return { onPatch };
}

/** The failure notice the picker renders for a failed roster, if any. */
const failureNotice = () => screen.queryByTestId('hook-object-roster-failure');

/**
 * Reject the in-flight request and flush the hook's `catch` plus the re-render
 * it schedules — explicitly, not by waiting for the notice, so the flag and
 * empty-copy rows do not depend on the notice existing.
 */
async function failRequest(err: unknown): Promise<void> {
  await act(async () => {
    state.fail(err);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('HookDefaultInspector — the object roster FAILED to load (objectui#10585)', () => {
  it('does not call a selected object "not published" after the fetch failed', async () => {
    mount('ghost_object');
    await failRequest(new Error('503 Service Unavailable'));

    expect(
      screen.getByRole('checkbox', { name: 'ghost_object' }),
      'the selection stays on screen, bare',
    ).toBeTruthy();
    expect(
      screen.queryByText(FLAGGED),
      'a roster that never answered cannot testify that the object is unpublished',
    ).toBeNull();
  });

  it('does not tell the author to publish an object after the fetch failed', async () => {
    mount();
    await failRequest(new Error('503 Service Unavailable'));

    expect(screen.queryByText(PUBLISH_COPY)).toBeNull();
    expect(
      screen.queryByText('Loading options…'),
      'a failed request is no longer in flight — it must not read as one',
    ).toBeNull();
  });

  it('tells the author the roster failed, and names the cause', async () => {
    mount('ghost_object');
    await failRequest(new Error('503 Service Unavailable'));

    expect(failureNotice(), 'the failure reached the picker').not.toBeNull();
    expect(failureNotice()?.getAttribute('role')).toBe('status');
    expect(failureNotice()?.textContent).toContain('Options could not be loaded');
    expect(failureNotice()?.textContent).toContain('503 Service Unavailable');
  });

  it('leaves the selection EDITABLE after the failure — un-ticking it reaches the draft', async () => {
    const { onPatch } = mount('ghost_object');
    await failRequest(new Error('boom'));

    fireEvent.click(screen.getByRole('checkbox', { name: 'ghost_object' }));
    expect(
      onPatch,
      'a failed catalog must not also block authoring',
    ).toHaveBeenCalledWith({ object: [] });
  });
});

describe('HookDefaultInspector — the object roster is IN FLIGHT (objectui#10585)', () => {
  it('shows a selected object bare, unflagged, with no failure notice', () => {
    // No `waitFor`: waiting is what hides the in-flight window.
    mount('ghost_object');
    expect(screen.getByRole('checkbox', { name: 'ghost_object' })).toBeTruthy();
    expect(screen.queryByText(FLAGGED)).toBeNull();
    expect(failureNotice(), 'an unanswered request is not a failed one').toBeNull();
  });

  it('does not tell the author to publish an object while loading', () => {
    mount();
    expect(screen.queryByText(PUBLISH_COPY)).toBeNull();
    expect(screen.getByText('Loading options…')).toBeTruthy();
  });
});

describe('HookDefaultInspector — CONTROLS: an ANSWERED roster still makes its claims', () => {
  it('flags a selected object the answered catalog does not list, with no notice', async () => {
    mount('ghost_object');
    await act(async () => {
      state.land([{ name: 'account', label: 'Account' }]);
    });

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: FLAGGED })).toBeTruthy();
    });
    expect(failureNotice(), 'a completed load is not a failure').toBeNull();
  });

  it('prints the "publish an object" copy for a catalog that answered empty', async () => {
    mount();
    await act(async () => {
      state.land([]);
    });

    await waitFor(() => {
      expect(screen.getByText(PUBLISH_COPY)).toBeTruthy();
    });
    expect(failureNotice()).toBeNull();
  });
});
