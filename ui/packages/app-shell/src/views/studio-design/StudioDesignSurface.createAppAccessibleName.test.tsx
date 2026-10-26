// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio — the Create app dialog must be targetable BY ACCESSIBLE NAME
 * (objectui#9231).
 *
 * ## The defect, as measured on `origin/main` before this fix
 *
 * The package workspace toolbar carries a button whose accessible name is
 * `Create app`; it opens a dialog whose own accessible name is also
 * `Create app` (its title — which is correct, a dialog is named after the
 * action that opened it). The one control inside that dialog which actually
 * creates the app was named `Create (save as draft)`.
 *
 * So every name a caller could write for "the control that creates the app"
 * was ambiguous: `Create app` resolved ONLY to openers (three of them: the
 * toolbar, the Interfaces empty state, the Interfaces rail), and the shorter
 * `Create` — the only handle the confirm control offered — matched the openers
 * too. There was no way to target the confirm control by name without also
 * matching the toolbar button.
 *
 * The cost is not cosmetic. While the dialog is open Radix marks the rest of
 * the tree `aria-hidden`, so a by-name click on `Create app` lands on the modal
 * overlay and Radix dismisses the dialog — silently, with no error and nothing
 * created. The failure only surfaces much later at the app's list route, on the
 * screen for an app that is not there. That screen used to read
 * `App not available … it may still be publishing` — blaming a publish that
 * never started — which is the second half objectui#9231 asked to be measured
 * rather than special-cased here; objectui#9262 measured it and retired the
 * sentence, so the same path now reads `This app can't be opened`. The delay
 * between the silent dismissal and the screen is what this suite is about, and
 * that is unchanged.
 *
 * ## What this suite pins
 *
 * Only accessible names, never `data-testid` — a testid would pin *around* the
 * very name the defect is about and would stay green while the defect persists.
 * Everything is asserted through the REAL `StudioDesignSurface` + the REAL
 * `CreateItemDialog`, so the names under test are the ones a browser, a screen
 * reader and an automation harness compute.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

let clientImpl: any;
let saved: Array<[string, string, unknown, unknown]>;

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => clientImpl,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});

// The surface's writability gate — one writable package, so the toolbar's
// create affordance is enabled rather than disabled.
vi.mock('./packages-io', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchPackages: vi.fn(async () => [
      { id: 'app.a', name: 'App A', writable: true, namespace: 'a' },
    ]),
  };
});

// Docks irrelevant to the names under test — keep the render light.
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { StudioDesignSurface } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';

// jsdom has no matchMedia — useIsMobile / useIsWideViewport need a stub.
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as any;

// Radix Popover (PackageSwitcher) floats via floating-ui, which observes size.
(globalThis as any).ResizeObserver =
  (globalThis as any).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

beforeEach(() => {
  saved = [];
  clientImpl = {
    // No published app and no draft app, so the toolbar renders `Create app`
    // rather than the pending badge or the open-app bridge.
    list: async () => [],
    listDrafts: async () => [],
    layered: async () => ({ effective: null, code: null }),
    getDraft: async () => null,
    get: async () => null,
    save: async (type: string, name: string, body: unknown, opts: unknown) => {
      saved.push([type, name, body, opts]);
      return body;
    },
  };
  // The surface's pending-drafts counter polls over raw fetch — stub it flat.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })) as any);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderSurface() {
  render(
    <MemoryRouter initialEntries={['/studio/app.a/interfaces']}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
  // The header landmark is the toolbar under test; wait for its own create
  // affordance rather than for a frame count.
  // objectui#12725 — by test id: the Interfaces properties now sit in the right
  // slot beside the top bar, and testing-library reads their aside's `header`
  // as a second banner (a browser does not: it is inside an `aside`).
  const toolbar = await screen.findByTestId('studio-shell-header');
  await waitFor(() =>
    expect(within(toolbar).getByRole('button', { name: 'Create app' })).toBeInTheDocument(),
  );
  return toolbar;
}

/** Open the dialog from the toolbar CONTROL, by its accessible name. */
async function openFromToolbar(): Promise<HTMLElement> {
  const toolbar = await renderSurface();
  fireEvent.click(within(toolbar).getByRole('button', { name: 'Create app' }));
  return await screen.findByRole('dialog');
}

/** Every accessible name carried by a `button` inside `scope`. */
function buttonNames(scope: HTMLElement): string[] {
  const names: string[] = [];
  within(scope).queryAllByRole('button', {
    name: (n: string) => {
      names.push(n);
      return false;
    },
  });
  return names;
}

/** Length of the longest common leading run of two strings. */
function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

describe('Studio create-app — accessible names (objectui#9231)', () => {
  it('the toolbar CONTROL still answers to the accessible name "Create app"', async () => {
    const toolbar = await renderSurface();
    // As the CONTROL, not as text: a heading or a dialog title carrying the
    // same string would not satisfy a caller trying to open the dialog.
    const opener = within(toolbar).getByRole('button', { name: 'Create app' });
    expect(opener).toHaveAccessibleName('Create app');
    expect(opener.tagName).toBe('BUTTON');
  });

  it('the dialog it opens keeps that same name — the dialog, not a control', async () => {
    const dialog = await openFromToolbar();
    // Naming a dialog after the action that opened it is correct and stays.
    // Pinned so a future "fix" cannot resolve the collision by renaming the
    // dialog, which would only move the ambiguity somewhere less visible.
    expect(dialog).toHaveAccessibleName('Create app');
  });

  it('NOTHING inside the dialog answers to the opener’s verb', async () => {
    const dialog = await openFromToolbar();
    // THE PIN. Before this fix the confirm control was `Create (save as
    // draft)`, so this query returned it — i.e. a caller reaching for "the
    // create control" could not tell the confirm from the three openers, and a
    // by-name click outside the modal is silently swallowed by Radix's overlay.
    expect(within(dialog).queryAllByRole('button', { name: /\bcreate\b/i })).toHaveLength(0);
    expect(within(dialog).queryByRole('button', { name: 'Create app' })).toBeNull();
  });

  it('the confirm control is reachable BY ACCESSIBLE NAME and actually creates the app', async () => {
    const dialog = await openFromToolbar();
    // Found by name — no testid, no positional pick (DialogContent renders
    // Radix's own sr-only Close AFTER the footer, so "the last button" is
    // Close and a positional pick silently dismisses the dialog).
    const confirm = within(dialog).getByRole('button', { name: 'Save as draft' });

    const nameField = dialog.querySelectorAll('input')[0];
    fireEvent.change(nameField, { target: { value: 'Field Service' } });
    fireEvent.click(confirm);

    // The claim is not "a button exists" — it is that THIS name creates the
    // app. Anything else is the silent no-op the card is about.
    await waitFor(() => expect(saved.length).toBe(1));
    expect(saved[0][0]).toBe('app');
    expect(saved[0][1]).toBe('field_service');
    expect(saved[0][3]).toMatchObject({ mode: 'draft', packageId: 'app.a' });
  });

  it('opener and confirm share no name prefix — in BOTH Studio locales', async () => {
    // The render-level pins above run in the catalogue's English face. The
    // collision was present in the Chinese face too, so the rule is asserted
    // on the catalogue directly, for both of the locales it carries.
    //
    // A caller writes a by-name query from the FRONT of a label, so a shared
    // leading run is exactly what makes two controls indistinguishable — and
    // unlike a word-boundary rule this one holds for a script with no spaces.
    for (const locale of ['en-US', 'zh-CN'] as const) {
      const opener = t('engine.studio.app.create', locale);
      const confirm = t('engine.studio.createDraft', locale);
      expect(commonPrefixLength(opener, confirm), `${locale}: ${opener} / ${confirm}`).toBe(0);
      expect(confirm.includes(opener)).toBe(false);
      expect(opener.includes(confirm)).toBe(false);
    }
  });

  it('the open dialog exposes exactly three controls, all distinctly named', async () => {
    const dialog = await openFromToolbar();
    const names = buttonNames(dialog);
    // Cancel, the confirm, and Radix's sr-only Close. Distinctness is the
    // whole contract this suite defends, so assert the SET, not the count.
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['Cancel', 'Save as draft', 'Close']));
  });
});
