// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The OWD panel's package-scoped save carries no read decorations
 * (objectui#8181).
 *
 * ## Why this site and not one of the other three
 *
 * `doSave` here is the shortest complete round trip in the sweep, and the only
 * one with no mitigating arm: it re-reads `layered` ∪ `getDraft`, spreads the
 * DRAFT BODY over the baseline, applies the OWD pair, and PUTs the result —
 * `{ ...baseline, ...draftBody }` straight into `client.save('object', ...)`.
 * `PermissionMatrixEditor` re-bases on a fresh RAW layered read first (so it
 * leaks only when that read fails), and the two `StudioDesignSurface` writes
 * go through the same hoisted reader this file exercises. So this is the
 * cheapest honest proof that the hoist reaches a WRITE, not just a helper.
 *
 * ## What "reaches a write" does and does not mean here
 *
 * ⚠️ Measured, and stated so nobody re-derives it from this file's existence:
 * today's server does NOT 400 on this. `saveMetaItem` strips read decorations
 * on ingress, deliberately placed before its schema gate, so the body is
 * laundered on the far side of the wire. That is a mitigation in the framework,
 * not a licence for this client to emit a body its own spec calls invalid —
 * `ObjectSchema.safeParse(body + _diagnostics)` answers `unrecognized_keys` at
 * the root. AGENTS.md #0.1: one strict contract, fixed at the producer.
 *
 * ## The control
 *
 * The panel must still save the OWD edit and still carry the author's own
 * keys. Both are asserted alongside the absences — without them a `save` that
 * shipped `{}` would pass every `not.toHaveProperty` in this file.
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

/** Exactly what the framework attaches to a `?state=draft` read. */
const DECORATIONS = { _diagnostics: { valid: true, errors: [] }, _draft: true };
/** ADR-0010 carriers: declared by the schemas, must survive the strip. */
const PROTECTION = { _provenance: 'package', _packageId: 'com.example.showcase' };

const PUBLISHED = {
  crm_contact: { name: 'crm_contact', label: 'Contact', sharingModel: 'private' },
};

/** The pending draft the server serves, decorated the way it really is. */
const SERVED_DRAFT = {
  name: 'crm_contact',
  label: 'Contact',
  description: 'authored in the draft', // the author's own key — must survive
  sharingModel: 'private',
  ...PROTECTION,
  ...DECORATIONS,
};

const saved: Array<{ name: string; body: Record<string, unknown> }> = [];

function makeClient() {
  return {
    list: async (type: string) =>
      type === 'object'
        ? Object.entries(PUBLISHED).map(([name, b]) => ({ name, label: b.label }))
        : [],
    listDrafts: async () => [],
    layered: async (_t: string, name: string) => ({
      effective: PUBLISHED[name as keyof typeof PUBLISHED] ?? {},
      code: null,
    }),
    // The decorated envelope, on BOTH the load read and the save-time re-read.
    getDraft: async () => ({ type: 'object', name: 'crm_contact', item: SERVED_DRAFT }),
    save: async (_t: string, name: string, body: Record<string, unknown>) => {
      saved.push({ name, body });
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

describe('PackageOwdOverviewPanel — read decorations never reach the save (objectui#8181)', () => {
  it('writes the authored body without `_diagnostics` / `_draft`', async () => {
    render(
      <PackageOwdOverviewPanel
        client={makeClient()}
        packageId="com.example.showcase"
        locale="en-US"
      />,
    );
    await screen.findByTestId('owd-row-crm_contact');

    await pickOwd('owd-internal-crm_contact', t('engine.studio.settings.sharingPublicRead', 'en-US'));
    fireEvent.click(screen.getByTestId('owd-save'));

    // CONTROL: the save really happened, and really carried the edit. Every
    // absence assertion below is meaningless without this.
    await waitFor(() => expect(saved).toHaveLength(1));
    const body = saved[0]!.body;
    expect(saved[0]!.name).toBe('crm_contact');
    expect(body.sharingModel).toBe('public_read');
    // …and the draft's own authored key rode along, which is the whole reason
    // the draft body is merged in at all.
    expect(body.description).toBe('authored in the draft');

    // The decorations did not.
    expect(body).not.toHaveProperty('_diagnostics');
    expect(body).not.toHaveProperty('_draft');

    // The protection envelope is not collateral damage — the schemas declare
    // these, and dropping them would lose provenance on every OWD save.
    expect(body._provenance).toBe('package');
    expect(body._packageId).toBe('com.example.showcase');
  });
});
