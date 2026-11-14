// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A new record page is the synthesized default, and owning its whole layout is
 * an explicit act.
 *
 * Studio creates a record page `kind: 'slotted'` with no `slots` key (see
 * `anchors.page-seed.test.ts`). In the page designer such a page:
 *
 *  - says in one line that it IS the default record page;
 *  - opens on the slot editor with every slot inherited, never on a blank
 *    regions canvas (whose "Add region" would write regions a slotted page
 *    never reads);
 *  - offers "Convert to full page", which writes the regions the page renders
 *    right now, switches `kind` to `full` and drops `slots`. The action waits
 *    for the bound object's schema: copied before it, the regions carry no
 *    fields.
 *
 * The page body drawn by `SchemaRenderer` is not this file's subject, so it is
 * stubbed; the canvas and the synthesizer are the real ones.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

/** Stable stub identity — `PagePreview` carries `perms` in an effect dep list. */
const { permsStub } = vi.hoisted(() => ({
  permsStub: {
    isLoaded: true,
    checkField: () => true,
    check: () => ({ allowed: true }),
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    userId: null,
    systemPermissions: undefined,
    hasCapabilities: () => true,
    can: () => true,
    cannot: () => false,
  },
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub as any };
});

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SchemaRenderer: () => <div data-testid="mock-schema-renderer" />,
  RecordContextProvider: ({ children }: { children: any }) => <>{children}</>,
}));

// The source loads this lazily; pay that load at collection, not inside a
// case's clocked window.
import '@objectstack/lint';
// "Convert to full page" on a grouped object loads every catalogue for the
// ungrouped heading (objectstack#33377): resident at import, not in a clock.
import { builtInLocales, registerBuiltInLocales } from '@object-ui/i18n/locales';
import { BUILT_IN_LANGUAGE_CODES } from '@object-ui/i18n';
import { PagePreview } from './PagePreview';
import { t } from '../i18n';
import { validateMetadataDraft } from '../clientValidation';
import { ComponentPropsMap } from '@objectstack/spec/ui';

const OBJECT = 'showcase_invoice';
const FIELDS = {
  name: { type: 'text', label: 'Invoice Number' },
  status: { type: 'select', label: 'Status', options: [{ value: 'draft', label: 'Draft' }] },
  total: { type: 'currency', label: 'Total' },
};

/** The two endpoints `PagePreview` reads directly; `schemaGate` holds the schema read open. */
function stubFetch(schemaGate?: Promise<void>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/v1/meta/object/')) {
      if (schemaGate) await schemaGate;
      return { json: async () => ({ item: { name: OBJECT, fields: FIELDS } }) } as any;
    }
    return { json: async () => ({ records: [] }) } as any;
  }));
}

/**
 * Every block in `tree` judged by the spec's own props row for its type
 * (`ComponentPropsMap`) — the per-block check the save door runs, which the
 * page-level parse never reaches (`properties` is an open record there).
 * Returns the refusals and how many `record:details` blocks were judged, so a
 * walk that judged nothing cannot pass as clean.
 */
function blockPropsVerdict(tree: unknown): { refused: string[]; detailsJudged: number } {
  const map = ComponentPropsMap as Record<string, { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } }>;
  const refused: string[] = [];
  let detailsJudged = 0;
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (typeof n.type === 'string' && map[n.type] && n.properties && typeof n.properties === 'object') {
      const res = map[n.type].safeParse(n.properties);
      if (n.type === 'record:details') detailsJudged++;
      if (!res.success) {
        for (const i of res.error!.issues) refused.push(`${n.type} ${i.path.join('.')}: ${i.message}`);
      }
    }
    Object.values(n).forEach(walk);
  };
  walk(tree);
  return { refused, detailsJudged };
}

registerBuiltInLocales();

const newRecordPage = { name: 'invoice_page', label: 'Invoice page', type: 'record', object: OBJECT, kind: 'slotted', regions: [] };

function designer(draft: Record<string, unknown>, onPatch?: (p: Record<string, unknown>) => void) {
  return render(
    <PagePreview
      type="page"
      name="invoice_page"
      draft={draft}
      editing
      selection={null}
      onSelectionChange={() => {}}
      onPatch={onPatch as any}
      locale="en-US"
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PagePreview — a slotted record page is the default page; converting it is explicit', () => {
  it('says the page is the default record page and opens on the slot editor, every slot inherited', async () => {
    stubFetch();
    designer(newRecordPage, vi.fn());
    expect(screen.getByTestId('page-slotted-default-note').textContent)
      .toContain(t('engine.pagePreview.slottedDefault', 'en-US'));
    // The slot editor: the canvas draws its "inherited" placeholder for the
    // slots, not the empty-region text of a regions canvas.
    expect(screen.getAllByText(t('engine.pageBlockCanvas.slotInherited', 'en-US')).length).toBeGreaterThan(0);
    expect(screen.queryByText(t('engine.pageBlockCanvas.regionEmpty', 'en-US'))).toBeNull();
  });

  it('converts to a full page by copying the regions it renders, once the object schema has loaded', async () => {
    let open!: () => void;
    stubFetch(new Promise<void>((r) => { open = r; }));
    const onPatch = vi.fn();
    designer(newRecordPage, onPatch);
    const button = screen.getByTestId('page-convert-to-full') as HTMLButtonElement;
    expect(button.textContent).toBe(t('engine.pagePreview.convertToFull', 'en-US'));
    // Before the schema answers the synthesized regions carry no fields.
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onPatch).not.toHaveBeenCalled();

    open();
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    expect(onPatch).toHaveBeenCalledTimes(1);
    const patch = onPatch.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.kind).toBe('full');
    expect('slots' in patch && patch.slots === undefined).toBe(true);
    const regions = patch.regions as Array<{ components?: Array<{ type?: string }> }>;
    expect(Array.isArray(regions) && regions.length).toBeGreaterThan(0);
    // The copied body carries the object's details, not a bare shell.
    expect(JSON.stringify(regions)).toContain('record:details');
    expect(JSON.stringify(regions)).toContain('total');
    // And it is AUTHORED metadata: the converted page passes the page check
    // the console runs on a draft, and every block passes its own props row.
    // (The canvas's own render schema holds the runtime section shape, field
    // objects, which the `record:details` row refuses.)
    const converted = { ...newRecordPage, ...patch };
    delete (converted as Record<string, unknown>).slots;
    const verdict = await validateMetadataDraft('page', converted, undefined, { mode: 'edit' });
    expect(verdict.issues, JSON.stringify(verdict.issues.slice(0, 3))).toEqual([]);
    const blocks = blockPropsVerdict(regions);
    expect(blocks.detailsJudged).toBeGreaterThan(0);
    expect(blocks.refused).toEqual([]);
  });

  it('keeps an authored slot override when converting', async () => {
    stubFetch();
    const onPatch = vi.fn();
    const highlights = { type: 'record:highlights', properties: { fields: ['status'] }, id: 'my_strip' };
    designer({ ...newRecordPage, slots: { highlights } }, onPatch);
    const button = screen.getByTestId('page-convert-to-full') as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    expect(JSON.stringify(onPatch.mock.calls[0][0].regions)).toContain('my_strip');
  });

  it('offers no convert action on a read-only designer, and no note on a full page', () => {
    stubFetch();
    designer(newRecordPage, undefined);
    expect(screen.getByTestId('page-slotted-default-note')).toBeTruthy();
    expect(screen.queryByTestId('page-convert-to-full')).toBeNull();
    cleanup();
    designer({ ...newRecordPage, kind: 'full', regions: [{ name: 'main', components: [] }] }, vi.fn());
    expect(screen.queryByTestId('page-slotted-default-note')).toBeNull();
  });
});

/**
 * objectstack#33377 — converting a slotted page of a grouped object writes the
 * ungrouped bucket under the translated heading: the inline locale map of
 * `common.ungroupedSection` (a saved page cannot call `t()`), never a plain
 * string, and the written page still passes the save door's checks.
 */
describe('PagePreview — Convert to full page heads the ungrouped bucket, translated (objectstack#33377)', () => {
  const GROUPED = {
    name: OBJECT,
    fieldGroups: [{ key: 'billing', label: 'Billing' }],
    fields: { ...FIELDS, total: { ...FIELDS.total, group: 'billing' } },
  };

  function stubGroupedFetch() {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      json: async () => (url.startsWith('/api/v1/meta/object/') ? { item: GROUPED } : { records: [] }),
    }) as any));
  }

  /** The `record:details` sections of the written regions. */
  function writtenSections(regions: unknown): Array<Record<string, any>> {
    let found: Array<Record<string, any>> | undefined;
    const walk = (n: unknown) => {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      const rec = n as Record<string, any>;
      if (rec.type === 'record:details' && Array.isArray(rec.properties?.sections)) found = rec.properties.sections;
      Object.values(rec).forEach(walk);
    };
    walk(regions);
    expect(found, 'the written page carries record:details sections').toBeDefined();
    return found!;
  }

  it('writes the group reference and the bucket under the locale map of every shipped catalogue', async () => {
    stubGroupedFetch();
    const onPatch = vi.fn();
    designer(newRecordPage, onPatch);
    const button = screen.getByTestId('page-convert-to-full') as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    expect(onPatch).toHaveBeenCalledTimes(1);
    const patch = onPatch.mock.calls[0][0] as Record<string, unknown>;

    const sections = writtenSections(patch.regions);
    expect(sections[0]).toEqual(expect.objectContaining({ group: 'billing' }));
    expect(sections[0].label).toBeUndefined();
    const bucket = sections[sections.length - 1];
    expect(bucket.fields).toEqual(['name', 'status']);
    expect(typeof bucket.label).toBe('object');
    for (const code of BUILT_IN_LANGUAGE_CODES) {
      expect(bucket.label[code], code).toBe((builtInLocales as Record<string, any>)[code].common.ungroupedSection);
    }

    const converted = { ...newRecordPage, ...patch };
    delete (converted as Record<string, unknown>).slots;
    const verdict = await validateMetadataDraft('page', converted, undefined, { mode: 'edit' });
    expect(verdict.issues, JSON.stringify(verdict.issues.slice(0, 3))).toEqual([]);
    const blocks = blockPropsVerdict(patch.regions);
    expect(blocks.detailsJudged).toBeGreaterThan(0);
    expect(blocks.refused).toEqual([]);
  });
});
