// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The publish-review diff reports what the AUTHOR changed, never what the
 * framework decorated (objectui#8181).
 *
 * ## The defect, and why it was live rather than latent
 *
 * `EntryDetail` fetches the item twice — published, then `?state=draft` — and
 * `computeChangeDetail` reports every top-level key whose value differs. The
 * framework decorates those two reads ASYMMETRICALLY: the draft branch stamps
 * `_draft: true` on the row before handing it to `decorateMetadataItem`, and
 * the published branch does not stamp anything. `unwrapItem` took the body
 * verbatim, so `_draft` differed on EVERY entry that has a published
 * counterpart, and the sheet listed it under "Also changed:" — a
 * framework-internal key rendered to the author as one of their own edits, on
 * the screen where they decide whether to publish. `_diagnostics` joins it
 * whenever the two reads' verdicts differ, which is the normal case for a
 * draft that changed anything.
 *
 * This is the half of objectui#8181 that needed no failure arm and no schema
 * gate to be wrong: it is wrong on the happy path, every time, in front of the
 * author.
 *
 * ## Why the fixture carries BOTH reads
 *
 * ⚠️ Drop the published read (make the entry NEW) and this passes with the
 * defect fully present: `computeChangeDetail` short-circuits `pub` to `{}` and
 * every key is "changed", so the decoration hides in a list that is expected to
 * be long. The published-vs-draft PAIR is the trigger.
 *
 * ## The control
 *
 * `label` differs between the two bodies on purpose. It MUST appear under
 * "Also changed:" — that is what proves the strip took the framework's keys and
 * not the diff itself. Without it, a `unwrapItem` that returned `null` for
 * everything would pass every "not.toContain" assertion in this file.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/i18n')>();
  return {
    ...mod,
    useObjectTranslation: () => ({
      t: (_k: string, o?: { defaultValue?: string; count?: number }) =>
        (o?.defaultValue ?? _k).replace('{{count}}', String(o?.count ?? '')),
    }),
  };
});

import { DraftChangesPanel } from '../DraftChangesPanel';

afterEach(() => {
  vi.restoreAllMocks();
});

const PUBLISHED = {
  name: 'crmext_visit',
  label: 'Visit',
  sharingModel: 'private',
  fields: { name: { type: 'text' } },
  // A published read is decorated too — only the `_draft` stamp is draft-only.
  _diagnostics: { valid: true, errors: [] },
};

const DRAFT = {
  name: 'crmext_visit',
  label: 'Customer Visit', // ← the CONTROL: a real authored change
  sharingModel: 'private',
  fields: { name: { type: 'text' } },
  _diagnostics: { valid: false, errors: [{ path: 'label', message: 'x' }] },
  _draft: true,
};

function mockRoutes() {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('/_drafts')) {
      return ok([{ type: 'object', name: 'crmext_visit', packageId: 'com.test.crmext' }]);
    }
    if (url.includes('state=draft')) {
      return ok({ type: 'object', name: 'crmext_visit', item: DRAFT });
    }
    if (/\/meta\/object\/crmext_visit/.test(url)) {
      return ok({ type: 'object', name: 'crmext_visit', item: PUBLISHED });
    }
    if (/\/meta\/object(\?|$)/.test(url)) return ok([{ name: 'crmext_visit' }]);
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

async function openEntryDetail() {
  render(
    <DraftChangesPanel open onOpenChange={() => {}} packageId="com.test.crmext" onPublish={vi.fn()} />,
  );
  const toggle = await screen.findByTestId('draft-entry-toggle');
  fireEvent.click(toggle);
  return screen.findByTestId('draft-entry-detail', undefined, { timeout: 4000 });
}

describe('DraftChangesPanel — read decorations never reach the review diff (objectui#8181)', () => {
  it('does not report `_draft` or `_diagnostics` as keys this publish changes', async () => {
    mockRoutes();
    const detail = await openEntryDetail();

    // The CONTROL first: the real authored change IS reported, so the diff ran
    // and this harness reaches the changed-keys strip.
    await waitFor(() => expect(detail.textContent).toContain('label'));

    // …and the framework's own keys are not sitting next to it. `_draft` is the
    // deterministic one — the server stamps it on the draft read and never on
    // the published read, so before the fix it was named on EVERY entry.
    expect(detail.textContent).not.toContain('_draft');
    expect(detail.textContent).not.toContain('_diagnostics');
  });

  it('still reports nothing at all when only the decorations differ', async () => {
    // The same body on both sides except for the framework's stamps: the honest
    // answer is "the draft matches the published version", and before the fix
    // it was "Also changed: _diagnostics, _draft".
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      const AUTHORED = { name: 'crmext_visit', label: 'Visit', fields: { name: { type: 'text' } } };
      if (url.includes('/_drafts')) {
        return ok([{ type: 'object', name: 'crmext_visit', packageId: 'com.test.crmext' }]);
      }
      if (url.includes('state=draft')) {
        return ok({
          type: 'object',
          name: 'crmext_visit',
          item: { ...AUTHORED, _draft: true, _diagnostics: { valid: false, errors: [{ x: 1 }] } },
        });
      }
      if (/\/meta\/object\/crmext_visit/.test(url)) {
        return ok({
          type: 'object',
          name: 'crmext_visit',
          item: { ...AUTHORED, _diagnostics: { valid: true, errors: [] } },
        });
      }
      if (/\/meta\/object(\?|$)/.test(url)) return ok([{ name: 'crmext_visit' }]);
      return { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as typeof fetch;

    render(
      <DraftChangesPanel open onOpenChange={() => {}} packageId="com.test.crmext" onPublish={vi.fn()} />,
    );
    fireEvent.click(await screen.findByTestId('draft-entry-toggle'));

    await waitFor(
      () => expect(screen.getByText(/No differences detected/)).toBeInTheDocument(),
      { timeout: 4000 },
    );
    // The strip is what produced that verdict, so the detail block — which only
    // renders when there IS something to report — must be absent.
    expect(screen.queryByTestId('draft-entry-detail')).not.toBeInTheDocument();
  });
});
