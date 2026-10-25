// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The References panel must tell three facts apart — objectui#5110.
 *
 * ## The defect
 *
 * `loadReferences()` held two pieces of state, `refs: MetadataReference[] |
 * null` and `refsLoading: boolean`, and the panel read `refs == null` as
 * "still loading". That left no value to mean "the check failed", so the
 * catch wrote `setRefs([])` — the SAME state a successful scan finding
 * nothing produces — and the panel rendered it as, verbatim:
 *
 *     "Nothing in the metadata graph points at this item. Safe to delete."
 *
 * Every failure took that path: a refused request, a dropped connection, an
 * expired session, an unparseable body, and (after objectstack#9326 / PR
 * #9425 made the wire honest) a truthful `501 NOT_IMPLEMENTED`. The producer
 * fix converted "we cannot answer" from a lying `200 {references: []}` into
 * a correct refusal, and this catch converted it straight back into the lie.
 * The only trace was a `console.error`. The operator is on this panel
 * *because* they are about to delete something.
 *
 * ## What is pinned here
 *
 * One test per arm of the union that replaced the pair, because the defect
 * was precisely that two of the three arms were the same value:
 *
 *   1. loading  — in flight, scanning indicator, no verdict of any kind
 *   2. empty    — a COMPLETED scan that found nothing still says "Safe to
 *                 delete"; the fix must not buy honesty by deleting the one
 *                 case where that sentence is true
 *   3. error    — the failure is shown as a failure, the "Safe to delete"
 *                 sentence is absent from the document, the count badge does
 *                 not render a false `0`, and Retry re-runs the same loader
 *
 * Case 2 is what makes case 3 an assertion rather than a tautology: without
 * it, deleting the empty state entirely would also make "Safe to delete"
 * unreachable and every error assertion would pass for the wrong reason.
 *
 * ## Why the retry pin asserts the SECOND call, not just the button
 *
 * The pre-fix re-entry guard was `if (refs != null || refsLoading) return;`.
 * Under the old shape a failure left `refs = []`, i.e. non-null — so even if
 * the old code had grown a retry button, the loader would have refused to run
 * again and the button would have been decorative. The guard now falls
 * through on `idle` and `error` and holds on `loading` and `loaded`, so the
 * suite asserts both directions: retry after an error DOES re-request, and
 * reopening the sheet after a success does NOT.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { MetadataReference } from '@object-ui/data-objectstack';
import { t } from './i18n';

/** The exact sentence this card exists to keep off a failed check. */
const SAFE_TO_DELETE = /Safe to delete/i;

const objectDef = {
  name: 'showcase_account',
  label: 'Account',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
};

/** A plain packaged entry — this suite is about the References sheet only. */
const LAYERED = {
  code: { ...objectDef, _packageId: 'com.example.showcase', _provenance: 'package' },
  overlay: null,
  effective: { ...objectDef },
  provenance: 'package',
  packageId: 'com.example.showcase',
  editable: true,
  deletable: true,
  resettable: true,
};

/** Swapped per case; `mockClient.references` forwards to whatever is current. */
const referencesImpl = { current: vi.fn() };

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  layered: vi.fn(async () => LAYERED),
  reset: vi.fn(async () => ({ success: true })),
  references: vi.fn(async (...args: unknown[]) => referencesImpl.current(...args)),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [
        {
          type: 'object',
          name: 'object',
          label: 'Object',
          allowEnvironmentOverlay: true,
          allowRuntimeCreate: true,
          schema: {
            type: 'object',
            properties: { name: { type: 'string' }, label: { type: 'string' } },
          },
        },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';

const START_PATH = '/metadata/object/showcase_account';

function editorUnderRoute() {
  return (
    <MemoryRouter initialEntries={[START_PATH]}>
      <Routes>
        <Route
          path="/metadata/:type/:name"
          element={<MetadataResourceEditPage type="object" name="showcase_account" />}
        />
      </Routes>
    </MemoryRouter>
  );
}

/**
 * Mount the editor and open the References sheet, which is what triggers the
 * lazy load. Returns the trigger so a case can close and reopen it.
 */
async function openReferencesSheet() {
  render(editorUnderRoute());
  await waitFor(() => expect(mockClient.layered).toHaveBeenCalled());
  const trigger = await screen.findByTitle('References');
  await userEvent.click(trigger);
  return trigger;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // objectui#12496 — the page now reopens the sheet a `?tab=` in the window
  // URL names, and opening one writes it there; reset it so a sheet one test
  // opened does not open in the next test's mount.
  window.history.replaceState({}, '', '/');
});

describe('References panel — error ≠ empty ≠ loading (#5110)', () => {
  it('loading: while the scan is in flight, neither verdict is rendered', async () => {
    // A promise held open on purpose: this is the state `refs == null` used
    // to mean, and it must stay reachable after the union replaced the pair.
    let release!: (v: MetadataReference[]) => void;
    referencesImpl.current = vi.fn(
      () => new Promise<MetadataReference[]>((res) => { release = res; }),
    );

    await openReferencesSheet();

    expect(await screen.findByTestId('refs-scanning')).toBeInTheDocument();
    // No verdict of any kind while the question is still open.
    expect(screen.queryByText(SAFE_TO_DELETE)).toBeNull();
    expect(screen.queryByTestId('refs-error')).toBeNull();
    expect(screen.queryByTestId('refs-count-badge')).toBeNull();

    // Settle it so the test does not leave a pending promise behind.
    release([]);
    await screen.findByTestId('refs-empty');
  });

  it('empty: a scan that COMPLETED and found nothing still says "Safe to delete"', async () => {
    // The one case where the sentence is true. Keeping it is what makes the
    // error case's absence assertion meaningful rather than vacuous.
    referencesImpl.current = vi.fn(async () => []);

    await openReferencesSheet();

    expect(await screen.findByTestId('refs-empty')).toBeInTheDocument();
    expect(screen.getByText(SAFE_TO_DELETE)).toBeInTheDocument();
    expect(screen.queryByTestId('refs-error')).toBeNull();
    // A completed scan MAY show its count, and it is a real zero.
    expect(screen.getByTestId('refs-count-badge')).toHaveTextContent('0');
  });

  it('error: the failure is shown as a failure, asserts nothing about deleting, and Retry re-runs the check', async () => {
    // The honest `501` from objectstack PR #9425 — the exact payload the old
    // catch turned back into "Safe to delete."
    referencesImpl.current = vi.fn(async () => {
      throw new Error('NOT_IMPLEMENTED: this protocol cannot resolve references');
    });

    await openReferencesSheet();

    const panel = await screen.findByTestId('refs-error');
    expect(panel).toBeInTheDocument();

    // 1. The claim that must not appear — anywhere in the document, not just
    //    inside the panel: this is the whole card. Asserted against the empty
    //    state's own string, read from the table, so a reword of that copy
    //    cannot quietly narrow what this test forbids.
    expect(screen.queryByText(SAFE_TO_DELETE)).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(SAFE_TO_DELETE);
    expect(document.body.textContent ?? '').not.toContain(
      t('engine.edit.refsEmptyDesc', 'en-US'),
    );
    expect(screen.queryByTestId('refs-empty')).toBeNull();

    // 2. What IS said: the check failed, and the copy makes no claim in
    //    either direction about deletion safety.
    expect(screen.getByText('Reference check failed')).toBeInTheDocument();
    expect(
      screen.getByText(/did not complete, so what depends on this item is unknown/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId('refs-error-cause')).toHaveTextContent(
      'NOT_IMPLEMENTED: this protocol cannot resolve references',
    );

    // 3. No count badge: a `0` over a failed check is the same false
    //    measurement in miniature.
    expect(screen.queryByTestId('refs-count-badge')).toBeNull();

    // 4. Retry re-runs the SAME loader — under the old `refs != null` guard a
    //    failure left `refs = []` and this second call was unreachable.
    expect(mockClient.references).toHaveBeenCalledTimes(1);
    referencesImpl.current = vi.fn(async () => [
      { fromType: 'view', fromName: 'account_list', path: 'objectName' },
    ]);
    await userEvent.click(screen.getByTestId('refs-retry'));

    await waitFor(() => expect(mockClient.references).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('account_list')).toBeInTheDocument();
    expect(screen.queryByTestId('refs-error')).toBeNull();
    expect(screen.getByTestId('refs-count-badge')).toHaveTextContent('1');
  });

  it('the lazy-load contract survives: a completed scan is not re-requested when the sheet reopens', async () => {
    // The other half of the re-entry guard. `error` falls through so Retry
    // works; `loaded` must still hold, or every reopen re-hits the server.
    referencesImpl.current = vi.fn(async () => []);

    const trigger = await openReferencesSheet();
    await screen.findByTestId('refs-empty');
    expect(mockClient.references).toHaveBeenCalledTimes(1);

    await userEvent.keyboard('{Escape}');
    await userEvent.click(trigger);
    await screen.findByTestId('refs-empty');

    expect(mockClient.references).toHaveBeenCalledTimes(1);
  });

  /**
   * The designer table carries `en` and `zh` in one file and is deliberately
   * out of reach of the pack gates (see `metadata-admin/i18n.ts`'s header and
   * `packages/i18n/README.md`, "Scope — the `engine.*` carve-out"), so a new
   * key added to only one of the two tables fails nowhere. This is that file's
   * parity check for the three keys this card adds.
   *
   * The semantic property — the error copy asserts nothing about deletion
   * safety — is NOT mechanically checkable and is not claimed to be: no gate
   * can read a sentence's meaning. What is checkable is the fact that made the
   * defect, and it is asserted: the error copy is not the empty copy, in
   * either locale.
   */
  it('i18n: the three error-state keys exist in both locales and are not the empty copy', () => {
    for (const key of [
      'engine.edit.refsErrorTitle',
      'engine.edit.refsErrorDesc',
      'engine.edit.refsRetry',
    ] as const) {
      const en = t(key, 'en-US');
      const zh = t(key, 'zh-CN');
      // `t()` echoes the key back when the table has no entry for it.
      expect(en, `EN missing ${key}`).not.toBe(key);
      expect(zh, `ZH missing ${key}`).not.toBe(key);
      expect(en, `${key} is untranslated`).not.toBe(zh);
    }

    for (const locale of ['en-US', 'zh-CN'] as const) {
      const errorCopy = t('engine.edit.refsErrorDesc', locale);
      const emptyCopy = t('engine.edit.refsEmptyDesc', locale);
      expect(errorCopy, `${locale} error copy collapsed into the empty copy`)
        .not.toBe(emptyCopy);
      expect(errorCopy).not.toContain(emptyCopy);
      expect(
        t('engine.edit.refsErrorTitle', locale),
        `${locale} error title collapsed into the empty title`,
      ).not.toBe(t('engine.edit.refsEmptyTitle', locale));
    }
  });
});
