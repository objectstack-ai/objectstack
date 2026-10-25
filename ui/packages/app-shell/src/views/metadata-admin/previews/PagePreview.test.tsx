// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

// Capture the schema handed to the runtime SchemaRenderer so slotted-page
// tests can assert what was actually rendered (synthesized regions vs the raw
// empty draft). `vi.hoisted` lets the mock factory reference it despite hoisting.
const { schemaSpy } = vi.hoisted(() => ({ schemaSpy: vi.fn() }));

// Mock the heavy runtime/canvas children so the test isolates PagePreview's
// routing decision (which child it picks), not their internals.
vi.mock('../../InterfaceListPage', () => ({
  InterfaceListPage: () => <div data-testid="mock-interface-list" />,
}));
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SchemaRenderer: ({ schema }: { schema: any }) => {
    schemaSpy(schema);
    return <div data-testid="mock-schema-renderer" />;
  },
  RecordContextProvider: ({ children }: { children: any }) => <>{children}</>,
}));
vi.mock('./PageBlockCanvas', () => ({
  PageBlockCanvas: () => <div data-testid="mock-page-canvas" />,
}));

import { PagePreview } from './PagePreview';
import { buildDefaultPageSchema } from '@object-ui/plugin-detail';
import { deriveRecordDetailSections, MORE_DETAILS_DEFAULT_LABEL } from '../../recordDetailSections';

afterEach(cleanup);

const interfaceDraft = {
  name: 'wb',
  type: 'list',
  regions: [],
  interfaceConfig: { source: 'task', userFilters: { element: 'dropdown', fields: [{ field: 'status' }] } },
};
const regionDraft = {
  name: 'home',
  type: 'home',
  regions: [{ name: 'main', components: [{ type: 'container' }] }],
};

describe('PagePreview — interface-page routing (ADR-0047)', () => {
  it('renders the runtime InterfaceListPage for an interface page in preview mode', () => {
    // preview mode = no onSelectionChange (not editing the canvas)
    // `type` / `name` are the host-owned half of `MetadataPreviewProps` (the
    // metadata type and the item's primary key); every render site below has to
    // supply them now that this file is type-checked (objectui#4040).
    render(<PagePreview type="page" name={interfaceDraft.name} draft={interfaceDraft} />);
    expect(screen.getByTestId('mock-interface-list')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-schema-renderer')).not.toBeInTheDocument();
  });

  it('also renders the live InterfaceListPage in design mode (no canvas hint)', () => {
    render(
      <PagePreview
        type="page"
        name={interfaceDraft.name}
        draft={interfaceDraft}
        editing
        onSelectionChange={() => {}}
        onPatch={() => {}}
      />,
    );
    // Interface pages are config-driven: the design tab shows the live list
    // (mirroring the runtime), not the region canvas/placeholder.
    expect(screen.getByTestId('mock-interface-list')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-page-canvas')).not.toBeInTheDocument();
  });

  it('renders the generic SchemaRenderer for a region-composed page (not an interface page)', () => {
    render(<PagePreview type="page" name={regionDraft.name} draft={regionDraft} />);
    expect(screen.queryByTestId('mock-interface-list')).not.toBeInTheDocument();
    expect(screen.getByTestId('mock-schema-renderer')).toBeInTheDocument();
  });
});

describe('PagePreview — slotted record page synthesis', () => {
  beforeEach(() => {
    schemaSpy.mockClear();
    // Record binding fetches the object schema + sample records. Resolve both
    // to empty so the effect settles deterministically; synthesis falls back to
    // a def-less default page (structure only), which is all this test asserts.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({}) }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  // A slotted page overrides `highlights` + `tabs`; header/details/discussion
  // are omitted and must be filled by the synthesizer.
  const slottedDraft = {
    name: 'showcase_account_record',
    type: 'record',
    object: 'showcase_account',
    kind: 'slotted',
    regions: [], // slotted pages carry an empty regions[] — the blank-canvas trap
    slots: {
      highlights: [{ type: 'record:highlights', fields: ['industry', 'website'] }],
      tabs: [{ type: 'page:tabs', items: [{ label: 'Custom', children: [] }] }],
    },
  };

  it('renders synthesized default regions (not the empty draft) so the preview is not blank', async () => {
    render(<PagePreview type="page" name={slottedDraft.name} draft={slottedDraft} />);
    await waitFor(() => expect(schemaSpy).toHaveBeenCalled());
    const rendered = schemaSpy.mock.calls.at(-1)![0];

    // The raw draft has regions:[] — synthesis must replace it with the
    // canonical record layout so SchemaRenderer has something to walk.
    expect(rendered.type).toBe('record');
    const main = (rendered.regions ?? []).find((r: any) => r.name === 'main');
    expect(main).toBeTruthy();
    expect(main.components.length).toBeGreaterThan(0);
  });

  it('fills omitted slots with synthesized defaults and applies authored overrides', async () => {
    render(<PagePreview type="page" name={slottedDraft.name} draft={slottedDraft} />);
    await waitFor(() => expect(schemaSpy).toHaveBeenCalled());
    const rendered = schemaSpy.mock.calls.at(-1)![0];
    const main = rendered.regions.find((r: any) => r.name === 'main');
    const comps: any[] = main.components;
    const types = comps.map((c) => c.type);

    // Omitted slots → synthesized defaults.
    expect(types).toContain('page:header');
    expect(types).toContain('record:discussion');

    // Authored highlights override is applied verbatim (replaces the default
    // chips + chevron path).
    const highlights = comps.find((c) => c.type === 'record:highlights');
    expect(highlights?.fields).toEqual(['industry', 'website']);

    // Authored tabs override wins — the custom tab is present.
    const tabs = comps.find((c) => c.type === 'page:tabs');
    expect(tabs?.items?.[0]?.label).toBe('Custom');
  });

  it('renders the authored schema unchanged for a non-slotted (full) record page', async () => {
    const fullDraft = {
      name: 'acct_full',
      type: 'record',
      object: 'showcase_account',
      kind: 'full',
      regions: [{ name: 'main', components: [{ type: 'record:details' }] }],
    };
    render(<PagePreview type="page" name={fullDraft.name} draft={fullDraft} />);
    await waitFor(() => expect(schemaSpy).toHaveBeenCalled());
    const rendered = schemaSpy.mock.calls.at(-1)![0];
    // No synthesis — the authored single-region layout passes through as-is.
    expect(rendered.regions).toHaveLength(1);
    expect(rendered.regions[0].components).toEqual([{ type: 'record:details' }]);
  });
});

/**
 * objectui#12442 — the slotted preview draws the running app's detail sections.
 *
 * `RecordDetailView` passes `buildDefaultPageSchema` explicit sections (the
 * object's field groups, else the visible-field split); the preview passed
 * none, so on an object with no `fieldGroups` it drew a bare `record:details`.
 * It now takes them from the same derivation, `deriveRecordDetailSections`.
 * The seed's half and the one-derivation source pin are in
 * `recordDetailSections.agreement-12442.test.ts`.
 */
describe('PagePreview — slotted record page detail sections (objectui#12442)', () => {
  const flatDef = {
    name: 'os_12442_ticket',
    fields: {
      name: { label: 'Ticket Name', type: 'text' },
      subject: { label: 'Subject', type: 'text' },
      notes: { label: 'Notes', type: 'textarea' },
    },
  };
  const groupedDef = {
    name: 'os_12442_account',
    fieldGroups: [{ key: 'basic_info', label: 'Basic Information' }],
    fields: {
      name: { label: 'Account Name', type: 'text' },
      industry: { label: 'Industry', type: 'text', group: 'basic_info' },
      notes: { label: 'Notes', type: 'textarea' },
    },
  };
  const slots = { highlights: [{ type: 'record:highlights', fields: ['name'] }] };
  const draftFor = (object: string) => ({ name: `${object}_record`, type: 'record', object, kind: 'slotted', regions: [], slots });

  beforeEach(() => { schemaSpy.mockClear(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  /** Serve `def` as the object schema; no sample records. */
  function serve(def: unknown) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      json: async () => (url.startsWith('/api/v1/meta/object/') ? { item: def } : { records: [] }),
    })));
  }

  /** The `record:details` node of the last schema the preview rendered once the schema has loaded. */
  async function previewDetails(def: { name: string }) {
    serve(def);
    render(<PagePreview type="page" name={`${def.name}_record`} draft={draftFor(def.name)} />);
    let node: any;
    await waitFor(() => {
      const rendered = schemaSpy.mock.calls.at(-1)?.[0];
      const tabs = rendered?.regions?.find((r: any) => r.name === 'main')?.components?.find((c: any) => c.type === 'page:tabs');
      node = tabs?.properties?.items?.[0]?.children?.find((c: any) => c.type === 'record:details');
      // Before the schema read settles the preview synthesizes with no object
      // (a bare node); both fixtures carry sections once it has loaded.
      expect(node?.properties?.sections).toBeDefined();
    });
    return node;
  }

  /** The same node, synthesized with no preview in between. */
  function synthesizedDetails(def: unknown, sections?: unknown) {
    const page = buildDefaultPageSchema(def as any, sections ? { slots, sections: sections as any } : { slots }) as any;
    const tabs = page.regions.find((r: any) => r.name === 'main').components.find((c: any) => c.type === 'page:tabs');
    return tabs.properties.items[0].children.find((c: any) => c.type === 'record:details');
  }

  it('an object with no fieldGroups: the preview carries the runtime sections, not a bare record:details', async () => {
    const runtimeSections = deriveRecordDetailSections(flatDef, { moreDetails: MORE_DETAILS_DEFAULT_LABEL });
    // Firing control: the split really yields two sections for this fixture.
    expect(runtimeSections).toHaveLength(2);
    const node = await previewDetails(flatDef);
    expect(node.properties.sections).toEqual(runtimeSections);
    expect(node).toEqual(synthesizedDetails(flatDef, runtimeSections));
  });

  it('CONTROL: an object with fieldGroups previews exactly what the synthesizer alone writes', async () => {
    const node = await previewDetails(groupedDef);
    expect(node).toEqual(synthesizedDetails(groupedDef));
    expect(node.properties.sections[0]).toEqual(expect.objectContaining({ group: 'basic_info' }));
  });
});
