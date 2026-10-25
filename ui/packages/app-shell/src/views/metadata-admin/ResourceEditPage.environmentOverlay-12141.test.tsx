// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12141 — the editor's write gate for a PACKAGED item reads the
 * `GET /meta/types` field `allowEnvironmentOverlay`, the name the server
 * writes after objectstack-ai/objectstack#22340 S2.
 *
 * ## Why the five overlay types are the population
 *
 * An item a code package ships sits in the editor's artifact tier, and that
 * tier opens on the overlay flag ALONE: `allowRuntimeCreate` authors new items
 * and says nothing about overwriting a shipped one. The registry grants the
 * overlay to five types — `view`, `dashboard`, `report`, `translation` and
 * `email_template` — so those five are the types whose packaged items go
 * read-only the moment this page reads a field the server does not write.
 * Nothing else would notice: objectui types the entry itself, so no build sees
 * a missed rename, and the item falls back to a lock banner that reads as
 * deliberate.
 *
 * ## What is pinned, each against a control
 *
 *  - each of the five, served the way the server writes it (both flags true),
 *    opens the packaged item for editing;
 *  - the same five served WITHOUT the field keep the packaged item locked:
 *    the field is what opens it, and the editor reads no other name;
 *  - the negative-control type the card names: `api`, which takes no overlay
 *    and no runtime create, stays read-only, and its banner names the
 *    `OS_METADATA_WRITABLE` hatch the server reads (with the hatch's reach,
 *    ADR-0131 D6) and no registry flip, in both locales.
 *
 * The entries carry the registry flags objectstack S2 declares for these types
 * (`DEFAULT_METADATA_TYPE_REGISTRY`, `@objectstack/spec`).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { RichMetadataTypeEntry } from './useMetadata';

const OVERLAY_TYPES = ['view', 'dashboard', 'report', 'translation', 'email_template'] as const;

const ITEM = 'showcase_item';
const SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' }, label: { type: 'string' } },
};

/** The type entries the mocked `/meta/types` read serves; set per case. */
let served: RichMetadataTypeEntry[] = [];
let localeFixture: 'en-US' | 'zh-CN' = 'en-US';

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => packagedItem()),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries: served }),
  };
});

vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => localeFixture,
}));

import { MetadataResourceEditPage } from './ResourceEditPage';

/** An item a code package ships, as the layered read serves it. */
function packagedItem() {
  const def = { name: ITEM, label: 'Showcase item' };
  return {
    code: { ...def, _packageId: 'com.example.showcase', _provenance: 'package' },
    overlay: null,
    overlayScope: null,
    effective: def,
    provenance: 'package',
    packageId: 'com.example.showcase',
    editable: true,
  };
}

/** The entry the S2 server writes for one of the five: both doors open. */
function overlayEntry(type: string): RichMetadataTypeEntry {
  return {
    type,
    label: type,
    allowEnvironmentOverlay: true,
    allowRuntimeCreate: true,
    overrideSource: 'registry',
    supportsOverlay: true,
    schema: SCHEMA,
  };
}

async function renderEditor(type: string) {
  render(
    <MemoryRouter initialEntries={[`/metadata/${type}/${ITEM}`]}>
      <MetadataResourceEditPage type={type} name={ITEM} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(mockClient.layered).toHaveBeenCalled());
}

function banner(): HTMLElement | null {
  return screen.queryByTestId('readonly-banner');
}

async function lockBanner(): Promise<HTMLElement> {
  return waitFor(() => {
    const b = banner();
    expect(b).not.toBeNull();
    return b as HTMLElement;
  });
}

beforeEach(() => {
  localeFixture = 'en-US';
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ResourceEditPage — a packaged item of an overlay type opens on `allowEnvironmentOverlay` (objectui#12141)', () => {
  it.each(OVERLAY_TYPES)('%s: the packaged item is editable when the server writes the field', async (type) => {
    served = [overlayEntry(type)];
    await renderEditor(type);

    // Edit is offered only when `canWrite` holds (the page draws it in more
    // than one place), and the lock banner is absent.
    expect((await screen.findAllByRole('button', { name: /^Edit$/ })).length).toBeGreaterThan(0);
    expect(banner()).toBeNull();
  });

  it.each(OVERLAY_TYPES)('%s: without the field the same packaged item stays locked', async (type) => {
    // A server that does not write `allowEnvironmentOverlay`: the runtime-create
    // door is still open, and it does not open an item a package ships.
    const { allowEnvironmentOverlay: _omitted, ...withoutField } = overlayEntry(type);
    served = [withoutField];
    await renderEditor(type);

    const el = await lockBanner();
    expect(el.textContent).toContain('provided by an installed package');
    expect(screen.queryAllByRole('button', { name: /^Edit$/ })).toHaveLength(0);
  });
});

describe('ResourceEditPage — the negative control: a type without the field stays read-only (objectui#12141)', () => {
  const API_ENTRY: RichMetadataTypeEntry = {
    type: 'api',
    label: 'API Endpoint',
    allowEnvironmentOverlay: false,
    allowRuntimeCreate: false,
    overrideSource: 'registry',
    supportsOverlay: false,
    schema: SCHEMA,
  };

  it('`api` is read-only, and its banner names OS_METADATA_WRITABLE and no registry flip', async () => {
    served = [API_ENTRY];
    await renderEditor('api');

    const el = await lockBanner();
    expect(screen.queryAllByRole('button', { name: /^Edit$/ })).toHaveLength(0);
    const text = el.textContent ?? '';
    expect(text).toContain('read-only for safety');
    // The one spelling the server reads, drawn as a code token…
    expect(el.querySelector('code')?.textContent).toBe('OS_METADATA_WRITABLE');
    expect(text).toContain('OS_METADATA_WRITABLE');
    // …with its reach (ADR-0131 D6): it never opens what a package ships.
    expect(text).toContain('never an item a package ships');
    // Not the legacy name, and no remedy nobody can perform.
    expect(text).not.toContain('OBJECTSTACK_METADATA_WRITABLE');
    expect(text).not.toMatch(/registry/i);
    expect(text).not.toContain('allowEnvironmentOverlay');
    expect(text).not.toContain('{');
  });

  it('zh-CN: the same banner names OS_METADATA_WRITABLE and no registry flip', async () => {
    localeFixture = 'zh-CN';
    served = [API_ENTRY];
    await renderEditor('api');

    const el = await lockBanner();
    const text = el.textContent ?? '';
    expect(text).toContain('出于安全考虑');
    expect(text).toContain('OS_METADATA_WRITABLE');
    expect(text).toContain('永远不会开放由包提供的条目');
    expect(text).not.toContain('OBJECTSTACK_METADATA_WRITABLE');
    expect(text).not.toContain('注册表');
    expect(text).not.toContain('{');
  });
});
