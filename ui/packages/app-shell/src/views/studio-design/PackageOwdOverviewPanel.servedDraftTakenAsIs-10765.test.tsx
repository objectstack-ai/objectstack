// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10765 — the package OWD overview reads and re-saves an object's
 * pending draft AS-IS. It never spreads the draft over `layered.effective`.
 *
 * `effective` is the PUBLISHED layer and a spread cannot express deletion, so
 * an OWD model the author had set back to unset in the draft (a real authored
 * state — `PackageOwdOverviewPanel.test.tsx` pins that clearing a model DROPS
 * the key) read as still set from the published row, and the next OWD save
 * wrote that published value, plus every other key the draft had deleted,
 * back into the object's draft. Same host-level cause as the metadata-admin
 * editor's merge; the panel has two sites — the list load that derives each
 * row's values and the save that splices the edit into the body — and both
 * are pinned here, one assertion each, red on base.
 *
 * The client is a server double: `effective` is the active row, `getDraft`
 * serves the stored draft row raw, `save` records the wire body.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { t } from '../metadata-admin/i18n';
import { PackageOwdOverviewPanel } from './PackageOwdOverviewPanel';

/** Pick a dial's option by its label, through the trigger, as a user does; the dials are the shared Select (objectui#11865). */
async function pickOwd(testId: string, label: string): Promise<void> {
  fireEvent.keyDown(screen.getByTestId(testId), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: label }));
}

/** The published object: its OWD model set, plus a description. */
const PUBLISHED = {
  name: 'crm_contact',
  label: 'Contact',
  sharingModel: 'private',
  description: 'published description — the draft deleted this key',
};

/** The pending draft as the author left it: the model unset, description deleted. */
const SERVED_DRAFT = {
  name: 'crm_contact',
  label: 'Contact',
  _diagnostics: { valid: true, errors: [] },
};

const saved: Array<{ name: string; body: Record<string, unknown>; opts: Record<string, unknown> | undefined }> = [];

function makeClient() {
  return {
    list: async (type: string) => (type === 'object' ? [{ name: PUBLISHED.name, label: PUBLISHED.label }] : []),
    listDrafts: async () => [],
    layered: async (_t: string, name: string) => ({
      effective: name === PUBLISHED.name ? PUBLISHED : {},
      code: null,
    }),
    getDraft: async (_t: string, name: string) =>
      name === PUBLISHED.name ? { type: 'object', name, item: SERVED_DRAFT } : null,
    save: async (_t: string, name: string, body: Record<string, unknown>, opts?: Record<string, unknown>) => {
      saved.push({ name, body: JSON.parse(JSON.stringify(body)) as Record<string, unknown>, opts });
      return body;
    },
  } as any;
}

beforeEach(() => {
  saved.length = 0;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PackageOwdOverviewPanel — the pending draft is read and re-saved as-is (objectui#10765)', () => {
  it('LIST LOAD: a model the draft cleared reads as unset, not as the published value', async () => {
    render(<PackageOwdOverviewPanel client={makeClient()} packageId="com.example.showcase" locale="en-US" />);
    await screen.findByTestId('owd-row-crm_contact');

    const internal = screen.getByTestId('owd-internal-crm_contact');
    // Red on base: the spread over `effective` showed `private` from the published row.
    // The dial is the shared Select's trigger (objectui#11865), so its text is what it shows.
    expect(internal.textContent).toBe(t('engine.studio.settings.sharingUnset', 'en-US'));
    expect(internal).not.toHaveTextContent(t('engine.studio.settings.sharingPrivate', 'en-US'));
  });

  it('SAVE: an edit lands on the draft alone — the published model and description the draft deleted do not come back', async () => {
    render(<PackageOwdOverviewPanel client={makeClient()} packageId="com.example.showcase" locale="en-US" />);
    await screen.findByTestId('owd-row-crm_contact');

    await pickOwd('owd-internal-crm_contact', t('engine.studio.settings.sharingPublicRead', 'en-US'));
    fireEvent.click(screen.getByTestId('owd-save'));

    await waitFor(() => expect(saved).toHaveLength(1));
    const { name, body, opts } = saved[0]!;
    expect(name).toBe('crm_contact');
    expect(opts).toMatchObject({ mode: 'draft', packageId: 'com.example.showcase' });
    expect(body.sharingModel).toBe('public_read');
    // Red on base: it came back from `effective` through the spread.
    expect(body).not.toHaveProperty('description');
    // The draft's own keys travel; the read decorations do not (objectui#8181).
    expect(body.label).toBe('Contact');
    expect(body).not.toHaveProperty('_diagnostics');
  });
});
