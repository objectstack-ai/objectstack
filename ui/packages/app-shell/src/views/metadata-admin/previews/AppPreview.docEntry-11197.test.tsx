// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11197 — the app designer's preview draws a `doc` navigation entry.
 *
 * Its kind list was a hand list of the nine types the spec had before 17.5.0
 * added `doc` (ADR-0046). A `doc` entry therefore had no kind: a label-less one
 * was DROPPED from the read-only preview (no label, no target, no children), a
 * labelled one drew with no kind and no route, and the design canvas badged it
 * in the amber `untyped` tone that means "AppSchema will reject this". The kind
 * list is now keyed by the spec-derived `NavigationItemType`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AppPreview } from './AppPreview';

afterEach(cleanup);

const DRAFT = {
  name: 'crm',
  label: 'CRM',
  navigation: [
    // First on purpose: a `doc` entry is never the landing (see below).
    { id: 'nav_help', type: 'doc', book: 'crm_manual' },
    { id: 'accounts', type: 'object', label: 'Accounts', objectName: 'account' },
  ],
} satisfies Record<string, unknown>;

describe('objectui#11197 — AppPreview (read-only) draws a `doc` entry', () => {
  it('keeps a label-less `doc` entry, badged `doc`, with its target and its portal route', () => {
    render(<AppPreview type="app" name="crm" draft={DRAFT} />);
    expect(screen.getByText('doc')).toBeTruthy();
    // Twice: as its target, and as its text — a label-less entry reads what it
    // inherits, here its book (objectui#11196).
    expect(screen.getAllByText('crm_manual')).toHaveLength(2);
    // The route comes from `resolveHref`, so it is the one the shell follows.
    expect(screen.getByText('/apps/crm/docs/crm_manual')).toBeTruthy();
  });

  it('never names a `doc` entry as the landing — the runtime lands on object / page / dashboard / report / component only', () => {
    render(<AppPreview type="app" name="crm" draft={DRAFT} />);
    expect(screen.getByText('→ Accounts')).toBeTruthy();
  });

  // objectstack-ai/objectstack#29678 — the runtime lands on a `doc` entry when
  // no other entry lands, so the preview names it as the landing then.
  it('names the first `doc` entry as the landing when no other entry lands', () => {
    render(
      <AppPreview
        type="app" name="crm"
        draft={{
          name: 'crm',
          label: 'CRM',
          navigation: [
            { id: 'nav_site', type: 'url', label: 'Website', url: 'https://example.com' },
            { id: 'nav_help', type: 'doc', label: 'Help Centre', book: 'crm_manual' },
            { id: 'nav_guide', type: 'doc', label: 'Lead guide', doc: 'crm_lead_guide' },
          ],
        }}
      />,
    );
    expect(screen.getByText('→ Help Centre')).toBeTruthy();
  });
});

describe('objectui#11197 — AppNavCanvas (design mode) draws a `doc` entry', () => {
  it('badges it `doc`, not `untyped`, and shows the page it opens', () => {
    render(
      <AppPreview
        type="app" name="crm"
        draft={{ name: 'crm', label: 'CRM', navigation: [{ id: 'nav_guide', type: 'doc', book: 'crm_manual', doc: 'crm_lead_guide' }] }}
        editing
        selection={null}
        onSelectionChange={() => {}}
      />,
    );
    expect(screen.getByText('doc')).toBeTruthy();
    expect(screen.queryByText('untyped')).toBeNull();
    // The card's inherited text is the page it opens (objectui#11196), and the
    // card's title names that page as its target (objectui#12519).
    expect(screen.getAllByText('crm_lead_guide')).toHaveLength(1);
    expect(screen.getByRole('button', { pressed: false, name: /crm_lead_guide/ }).getAttribute('title')).toBe(
      'crm_lead_guide · crm_lead_guide',
    );
  });
});
