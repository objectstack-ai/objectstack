// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12141 — the metadata directory's type tiles and the page header's
 * writability badge read `/meta/types` `allowEnvironmentOverlay`, the name the
 * server writes after objectstack-ai/objectstack#22340 S2, and the badge for a
 * hatch-elevated type names `OS_METADATA_WRITABLE`.
 *
 * Two surfaces draw the same badge from the same entry: the directory's tile
 * (`DirectoryPage`) and the header of every list and edit page (`PageShell`).
 * Both are pinned, because each holds its own copy of the badge.
 *
 * What is pinned, each against a control:
 *
 *  - the five overlay types (`view`, `dashboard`, `report`, `translation`,
 *    `email_template`), served as the S2 server writes them, are badged
 *    writable and counted by "Writable only";
 *  - a type whose ONLY open door is the overlay flag — `agent` elevated by the
 *    `OS_METADATA_WRITABLE` hatch, which grants no runtime create — is badged
 *    writable and counted, so the disjunction reads the new field and not just
 *    `allowRuntimeCreate`; its tooltip names `OS_METADATA_WRITABLE` (never the
 *    legacy `OBJECTSTACK_`-prefixed name) and what the hatch opens;
 *  - the negative control: `api`, without the field, is badged read-only and
 *    not counted; and the same `agent` entry served without the field drops to
 *    read-only, so nothing else opens it.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { RichMetadataTypeEntry } from './useMetadata';

const PKG = 'com.example.showcase';
const OVERLAY_TYPES = ['view', 'dashboard', 'report', 'translation', 'email_template'] as const;
const HATCH_TITLE_FRAGMENT = 'OS_METADATA_WRITABLE';

/** The entry the S2 server writes for one of the five: both doors open, from the registry. */
function overlayEntry(type: string): RichMetadataTypeEntry {
  return {
    type,
    label: type,
    domain: 'ui',
    allowEnvironmentOverlay: true,
    allowRuntimeCreate: true,
    overrideSource: 'registry',
  };
}

/** `agent` with `OS_METADATA_WRITABLE=agent`: the overlay flag is its only open door. */
const HATCHED_AGENT: RichMetadataTypeEntry = {
  type: 'agent',
  label: 'Agent',
  domain: 'ai',
  allowEnvironmentOverlay: true,
  allowRuntimeCreate: false,
  overrideSource: 'env',
};

const API: RichMetadataTypeEntry = {
  type: 'api',
  label: 'API Endpoint',
  domain: 'system',
  allowEnvironmentOverlay: false,
  allowRuntimeCreate: false,
  overrideSource: 'registry',
};

let served: RichMetadataTypeEntry[] = [];

/** Stable singleton: the page's package load effect keys on the client identity. */
const CLIENT = {
  list: async (type: string) =>
    type === 'package' ? [{ manifest: { id: PKG, scope: 'project', name: 'Showcase' } }] : [],
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => CLIENT,
    useMetadataTypes: () => ({ loading: false, error: null, entries: served }),
    // Every served type is contributed by the one project package, so the
    // directory's package scope keeps all of them.
    useGlobalDiagnostics: () => ({
      loading: false,
      error: null,
      summary: { entries: [], total: 0, scannedTypes: 0, scannedItems: 0 },
      byType: {},
      warnByType: {},
      countsByType: {},
      lockedByType: {},
      packagesByType: Object.fromEntries(served.map((e) => [e.type, [PKG]])),
      allPackages: [PKG],
      reload: () => {},
    }),
  };
});

import { MetadataDirectoryPage } from './DirectoryPage';
import { PageShell } from './PageShell';

afterEach(() => {
  cleanup();
});

function renderDirectory() {
  return render(
    <MemoryRouter initialEntries={[`/metadata?package=${PKG}`]}>
      <MetadataDirectoryPage />
    </MemoryRouter>,
  );
}

/** The directory tile for one type, addressed by the machine name it prints. */
async function tile(type: string): Promise<HTMLElement> {
  const code = await screen.findByText(type, { selector: 'code' });
  return code.closest('a') as HTMLElement;
}

describe('DirectoryPage — the type tiles read `allowEnvironmentOverlay` (objectui#12141)', () => {
  it('the five overlay types and a hatch-elevated type are writable; `api` is not', async () => {
    served = [...OVERLAY_TYPES.map(overlayEntry), HATCHED_AGENT, API];
    renderDirectory();

    for (const type of OVERLAY_TYPES) {
      const badge = within(await tile(type)).getByText('writable');
      expect(badge).toHaveAttribute('title', 'Writable per ADR-0005 overlay opt-in');
    }

    const hatched = within(await tile('agent')).getByText('writable');
    const title = hatched.getAttribute('title') ?? '';
    expect(title).toContain(HATCH_TITLE_FRAGMENT);
    expect(title).toContain('never an item a package ships');
    expect(title).not.toContain('OBJECTSTACK_METADATA_WRITABLE');

    expect(within(await tile('api')).getByText('read-only')).toBeInTheDocument();
    expect(within(await tile('api')).queryByText('writable')).toBeNull();

    // "Writable only" counts the five and the hatched type: six of seven.
    expect(screen.getByRole('button', { name: /Writable only \(6\)/ })).toBeInTheDocument();
  });

  it('the hatch-elevated type served WITHOUT the field is read-only and not counted', async () => {
    const { allowEnvironmentOverlay: _omitted, ...withoutField } = HATCHED_AGENT;
    served = [withoutField, API];
    renderDirectory();

    expect(within(await tile('agent')).getByText('read-only')).toBeInTheDocument();
    expect(within(await tile('agent')).queryByText('writable')).toBeNull();
    expect(screen.getByRole('button', { name: /Writable only \(0\)/ })).toBeInTheDocument();
  });
});

describe('PageShell — the header badge reads `allowEnvironmentOverlay` (objectui#12141)', () => {
  function renderShell(entry: RichMetadataTypeEntry) {
    return render(
      <MemoryRouter initialEntries={[`/metadata/${entry.type}`]}>
        <PageShell entry={entry}>
          <div />
        </PageShell>
      </MemoryRouter>,
    );
  }

  it.each(OVERLAY_TYPES)('%s: badged writable from the registry opt-in', (type) => {
    renderShell(overlayEntry(type));
    expect(screen.getByText('writable')).toHaveAttribute('title', 'Writable per ADR-0005 overlay opt-in');
  });

  it('a hatch-elevated type: the tooltip names OS_METADATA_WRITABLE and what it opens', () => {
    renderShell(HATCHED_AGENT);
    const title = screen.getByText('writable').getAttribute('title') ?? '';
    expect(title).toContain(HATCH_TITLE_FRAGMENT);
    expect(title).toContain('never an item a package ships');
    expect(title).not.toContain('OBJECTSTACK_METADATA_WRITABLE');
  });

  it('negative control: `api` without the field is badged read-only', () => {
    renderShell(API);
    expect(screen.getByText('read-only')).toBeInTheDocument();
    expect(screen.queryByText('writable')).toBeNull();
  });

  it('the hatch-elevated entry served WITHOUT the field is not badged writable', () => {
    const { allowEnvironmentOverlay: _omitted, ...withoutField } = HATCHED_AGENT;
    renderShell(withoutField);
    expect(screen.queryByText('writable')).toBeNull();
    expect(screen.getByText('read-only')).toBeInTheDocument();
  });
});
