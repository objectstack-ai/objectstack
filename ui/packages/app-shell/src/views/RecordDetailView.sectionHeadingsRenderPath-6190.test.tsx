/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6190 — the record page's section HEADINGS, measured on the tree
 * app-shell actually renders (`renderedPage`), not on `buildDefaultPageSchema`
 * called bare.
 *
 * ## ⭐ The lesson this file exists to record: a guard's assertion is
 * ## ONE-DIRECTIONAL
 *
 * `plugin-detail/src/__tests__/defaultFieldGroupsPage.sectionHeadings.test.tsx`
 * (#6241) pins the same seam and was named, in this card's own dispatch, as the
 * signal that the producer and the consumer are in sync. It is not that signal.
 * Measured on 2026-08-30: with the synthesizer moved to the declared slot and
 * the renderer's alias limb dropped — the two-step edit set that was pinned at
 * the time — that pin stayed **GREEN** while the "More details" heading
 * degraded to the literal `details` on every default record detail page.
 * Re-measured here while landing the fix: put the "More details" producer alone
 * back on `title` and the #6241 pin passes 3/3 while this file fails 4/4 on a
 * heading a tenant reads.
 *
 * **A red pin proves the ends are out of sync. A green pin does NOT prove they
 * are in sync.** The #6241 pin renders `buildDefaultPageSchema(objectDef)` with
 * no explicit sections — the plugin-detail-internal derivation. A tenant gets a
 * different tree: `RecordDetailView` builds its OWN section array
 * (`synthParts.sections`) and passes it INTO `buildDefaultPageSchema`, where
 * `resolveDetailSections` returns the caller's array verbatim and the internal
 * derivation is never consulted. Two of the three heading producers live in
 * that app-shell array and are unreachable from the #6241 pin by construction.
 * The pin is sound for what it covers; it simply does not cover them.
 *
 * ⇒ This file closes that hole by mounting `RecordDetailView` itself, so the
 * assertions run over `renderedPage` — the tree the component's own comment
 * calls "the tree actually rendered — NOT `effectivePage`".
 *
 * ## ⛔ What this file must never assert
 *
 * NOT a key spelling. Nothing below may read `sections[i].title` or
 * `sections[i].label`; the expectation is the rendered heading TEXT, so this
 * pin stays invariant under any future move of the heading slot — the same
 * discipline #6241 adopted, and the reason it survived this card's convergence
 * untouched.
 *
 * ## The failure shape, named precisely
 *
 * It is not a blank heading. When a declared heading stops reaching the
 * renderer, `sectionLabel(objectName, s.name, rawTitle ?? s.name)` falls back
 * to the section's internal NAME: a tenant reads `basic_info` where
 * `Basic Information` belongs, and the literal `details` where `More details`
 * belongs. A plausible-looking wrong heading, in every shipped locale — the
 * "More details" fallback is load-bearing in all 10 of them, since
 * `detail.sectionMoreDetails` ships in every locale file while no locale ships
 * a `_sections.details.label` override (that key is per-object and
 * tenant-authored only).
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));
vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));
// Orthogonal chrome — stubbed so the only thing this file observes is the
// details body's headings.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';

const REC = 'rec-1';

/** What the AUTHOR declared — the only source of the expected heading text. */
const DECLARED_GROUPS = [
  { key: 'basic_info', label: 'Basic Information' },
  { key: 'financials', label: 'Financial Details' },
];

/** The literal the "More details" bucket must render, and the name it must never show instead. */
const MORE_DETAILS_HEADING = 'More details';
const MORE_DETAILS_SECTION_NAME = 'details';

/**
 * Shape B — an object declaring `fieldGroups` AND leaving fields ungrouped.
 *
 * Two things happen on one page: the declared groups go through app-shell's
 * re-map of `deriveFieldGroupDetailSections`' output, and the ungrouped
 * trailing bucket goes through `splitPrimarySecondary`, which authors the
 * "More details" section in app-shell itself. `notes` is a `textarea`, which is
 * what makes the split produce a secondary half at all (`isSecondaryField`).
 *
 * `highlightFields` is declared on purpose: left undeclared, the heuristic
 * strip claims up to four fields and hands them to `record:details` as
 * `hideFields`, which would empty the very sections this file measures.
 */
const GROUPED_OBJECT = 'os_6190_grouped';
const groupedDef = {
  name: GROUPED_OBJECT,
  label: 'Account',
  managedBy: 'platform',
  highlightFields: ['website'],
  fieldGroups: DECLARED_GROUPS,
  fields: {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Account Name', type: 'text' },
    website: { label: 'Website', type: 'url' },
    industry: { label: 'Industry', type: 'text', group: 'basic_info' },
    phone: { label: 'Phone', type: 'text', group: 'basic_info' },
    credit_terms: { label: 'Credit Terms', type: 'text', group: 'financials' },
    // Ungrouped: one primary + one secondary, so the trailing bucket splits.
    owner_name: { label: 'Owner Name', type: 'text' },
    notes: { label: 'Notes', type: 'textarea' },
  },
};

/** Shape C — no `fieldGroups` at all: the pure auto-grouping fallback path. */
const FLAT_OBJECT = 'os_6190_flat';
const flatDef = {
  name: FLAT_OBJECT,
  label: 'Ticket',
  managedBy: 'platform',
  highlightFields: ['subject'],
  fields: {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Ticket Name', type: 'text' },
    subject: { label: 'Subject', type: 'text' },
    priority: { label: 'Priority', type: 'text' },
    notes: { label: 'Notes', type: 'textarea' },
  },
};

const GROUPED_RECORD = {
  id: REC,
  name: 'Acme Corporation',
  website: 'https://acme.test',
  industry: 'Manufacturing',
  phone: '555-0100',
  credit_terms: 'Net 30',
  owner_name: 'Ada Lovelace',
  notes: 'Long form remarks',
};

const FLAT_RECORD = {
  id: REC,
  name: 'Printer jam',
  subject: 'Printer jam',
  priority: 'High',
  notes: 'Long form remarks',
};

function makeDataSource(objectName: string, record: any, def: any) {
  return {
    find: vi.fn(async () => ({ data: [], total: 0, hasMore: false, pageSize: 50 })),
    findOne: vi.fn(async (name: string, id: string) =>
      name === objectName ? { ...record, id } : null),
    create: vi.fn(async (_o: string, row: any) => row),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: async (name: string) => ({ name, fields: def.fields }),
  } as any;
}

function makeMetadata() {
  const pages: any[] = [];
  return {
    objects: [], pages, loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => pages, getItem: async () => null,
    getItemsByType: () => pages,
  } as any;
}

/**
 * Mount the record page the way a tenant with NO assigned page gets it — the
 * metadata context carries no pages, so `RecordDetailView` synthesizes
 * `renderedPage` — and hand back the rendered `record:details` block so the
 * assertions are scoped to the body rather than to page chrome that happens to
 * carry similar text.
 */
async function renderDetailsBlock(objectName: string, def: any, record: any): Promise<HTMLElement> {
  const { container } = render(
    <MemoryRouter initialEntries={[`/app/demo/${objectName}/${REC}`]}>
      <MetadataCtx.Provider value={makeMetadata()}>
        <RecordDetailView
          dataSource={makeDataSource(objectName, record, def)}
          objects={[def]}
          onEdit={() => {}}
          objectNameOverride={objectName}
          recordIdOverride={REC}
          embedded
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );

  // Harness guard, not the pin: if the synthesized record page ever stops
  // carrying a `record:details` block, every assertion below would go red for a
  // reason that has nothing to do with headings. Fail here instead, loudly.
  await waitFor(() => {
    expect(
      container.querySelector('[data-obj-type="record:details"]'),
      'the synthesized record page must render a `record:details` block',
    ).not.toBeNull();
  });
  return container.querySelector('[data-obj-type="record:details"]') as HTMLElement;
}

beforeAll(() => {
  // useIsMobile() keys off innerWidth (< 768 == mobile); pin a desktop width so
  // the desktop rows render.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

beforeEach(() => {
  cleanup();
  // Unrelated chrome (approvals, favourites…) reaches for the platform API; in
  // jsdom that is a real socket. Answer it locally.
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ data: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })));
});

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("app-shell's rendered record page — section headings reach the DOM (#6190)", () => {
  it('renders every declared group heading, and the "More details" heading beside them', async () => {
    const block = await renderDetailsBlock(GROUPED_OBJECT, groupedDef, GROUPED_RECORD);

    for (const group of DECLARED_GROUPS) {
      expect(
        within(block).getByText(group.label),
        `the declared heading "${group.label}" must be on screen`,
      ).toBeInTheDocument();
    }

    // The third producer: authored in app-shell, not emitted by the
    // synthesizer, and therefore invisible to the plugin-detail-internal pin.
    expect(
      within(block).getByText(MORE_DETAILS_HEADING),
      'the ungrouped trailing bucket must render its "More details" heading',
    ).toBeInTheDocument();
  });

  it('never surfaces a section\'s internal name in place of its declared heading', async () => {
    const block = await renderDetailsBlock(GROUPED_OBJECT, groupedDef, GROUPED_RECORD);

    // The observed shape of the break, not a hypothetical one.
    for (const group of DECLARED_GROUPS) {
      expect(
        within(block).queryByText(group.key),
        `the group key "${group.key}" must never stand in for its heading`,
      ).not.toBeInTheDocument();
    }
    expect(
      within(block).queryByText(MORE_DETAILS_SECTION_NAME),
      'the literal `details` must never stand in for the "More details" heading',
    ).not.toBeInTheDocument();
  });

  it('renders the "More details" heading on the pure fallback path too (no `fieldGroups`)', async () => {
    // Shape C reaches `splitPrimarySecondary` directly rather than through the
    // ungrouped trailing bucket — a different call site of the same producer,
    // and the one every object without `fieldGroups` takes.
    const block = await renderDetailsBlock(FLAT_OBJECT, flatDef, FLAT_RECORD);

    expect(within(block).getByText(MORE_DETAILS_HEADING)).toBeInTheDocument();
    expect(
      within(block).queryByText(MORE_DETAILS_SECTION_NAME),
      'the literal `details` must never stand in for the "More details" heading',
    ).not.toBeInTheDocument();
  });

  it('keeps every group member under its own heading, in declared order', async () => {
    const block = await renderDetailsBlock(GROUPED_OBJECT, groupedDef, GROUPED_RECORD);

    // Heading, then that group's field labels, then the next heading. Asserted
    // on rendered text order, so it pins BOTH that each heading is on screen
    // and that it heads the group it was declared for.
    const expectedReadingOrder = [
      'Basic Information', 'Industry', 'Phone',
      'Financial Details', 'Credit Terms',
      MORE_DETAILS_HEADING,
    ];
    const text = block.textContent ?? '';
    const positions = expectedReadingOrder.map((needle) => text.indexOf(needle));

    expect(
      expectedReadingOrder.filter((_, i) => positions[i] < 0),
      'every heading and group member must be on screen',
    ).toEqual([]);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
