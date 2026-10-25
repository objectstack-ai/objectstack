// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The lock banner must never render a headline-less amber box — objectui#5024.
 *
 * ## The defect
 *
 * The banner's title was three independent `&&` branches with no `else` and no
 * fallback:
 *
 *   {layered?.lock === 'full' && t('engine.edit.lockFull', locale)}
 *   {layered?.lock === 'no-overlay' && t('engine.edit.lockNoOverlay', locale)}
 *   {layered?.lock === 'no-delete' && t('engine.edit.lockNoDelete', locale)}
 *
 * while the switch that OPENS the banner is `layered?.lock && lock !== 'none'`
 * — true for *any* non-`none` value. So a lock state outside the ADR-0010 §3.6
 * four opens the amber box, draws the padlock and the border, and leaves the
 * title `<div>` empty: a locked-looking banner that never says what is locked
 * or why.
 *
 * ## Why this is reachable today, not only "the day a fifth state lands"
 *
 * The card framed it as dormant, on the reading that both hand-written unions
 * list the same four values. The unions are not the gate. `MetadataClient.
 * layered()` passes the wire value through with an unchecked cast —
 *
 *   ...(body.lock !== undefined ? { lock: body.lock as MetadataLayered['lock'] } : {}),
 *
 * — over a `res.json()` body. There is no Zod parse, no allowlist, no default
 * on this path. The union constrains what this repo may *write*; it constrains
 * nothing about what a server may *send*. A backend that grows a fifth state
 * reaches this banner with zero code change here, which is why the fix has to
 * be a runtime fallback and not only a compile-time exhaustiveness check: a
 * `satisfies` assertion is satisfied by the current four either way and would
 * have left the blank banner exactly as it was.
 *
 * ## What this suite pins
 *
 * The four known states keep their existing sentences (this half passes before
 * the fix — it is the control that says a red fifth-value case is the defect
 * and not a broken harness), and an out-of-vocabulary state renders a loud,
 * non-empty fallback that also surfaces the raw token so the state a server
 * actually sent is diagnosable from the screen.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const objectDef = {
  name: 'showcase_account',
  label: 'Account',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
};

const layeredImpl = { current: vi.fn() };

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async (...args: unknown[]) => layeredImpl.current(...args)),
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
          allowEnvironmentOverlay: false,
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Mount the editor over a layered envelope carrying `lock`. `provenance: 'org'`
 * keeps the separate installed-package notice out of the way so the assertions
 * below read the LOCK banner and nothing else.
 */
async function renderWithLock(lock: unknown) {
  layeredImpl.current = vi.fn(async () => ({
    code: { ...objectDef, _packageId: 'com.example.base', _provenance: 'org' },
    overlay: null,
    overlayScope: null,
    effective: objectDef,
    provenance: 'org',
    packageId: 'com.example.base',
    editable: true,
    lock,
  }));
  render(
    <MemoryRouter initialEntries={['/metadata/object/showcase_account']}>
      <MetadataResourceEditPage type="object" name="showcase_account" />
    </MemoryRouter>,
  );
  await waitFor(() => expect(mockClient.layered).toHaveBeenCalled());
  return waitFor(() => {
    const el = screen.queryByTestId('lock-banner-title');
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
}

describe('ResourceEditPage lock banner — every state that opens the banner also titles it (#5024)', () => {
  // The control half: these pass before the fix as well as after. If the
  // out-of-vocabulary case below goes red while these stay green, the red is
  // the defect rather than a harness that cannot mount the page.
  it.each([
    ['full', 'This item is locked and cannot be edited or deleted.'],
    ['no-overlay', 'This item is locked and cannot be edited.'],
    ['no-delete', 'This item is locked and cannot be deleted.'],
  ])('known state %s keeps its existing sentence', async (lock, sentence) => {
    const el = await renderWithLock(lock);
    expect(el.textContent?.trim()).toBe(sentence);
  });

  it('an out-of-vocabulary state from the wire still gets a title', async () => {
    // The whole defect in one assertion: pre-fix this element exists (the
    // banner opened) and is EMPTY.
    const el = await renderWithLock('no-publish');
    expect(el.textContent?.trim()).not.toBe('');
  });

  it('an out-of-vocabulary state names the raw token it could not read', async () => {
    // "Loudly", per the triage ruling: a generic "this is locked" that hides
    // WHICH state arrived would leave an operator with nothing to report.
    const el = await renderWithLock('no-publish');
    expect(el.textContent).toContain('no-publish');
  });

  it('a non-string lock value cannot crash or blank the banner', async () => {
    // `layered()` casts whatever JSON held; a malformed body is the same class
    // of unchecked input as an unknown state name.
    const el = await renderWithLock(42);
    expect(el.textContent?.trim()).not.toBe('');
  });
});
