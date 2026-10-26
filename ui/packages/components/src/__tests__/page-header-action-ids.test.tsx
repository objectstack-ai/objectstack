/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `page:header` resolves `actions` as ACTION IDS (objectui#6252, implementing
 * the objectstack#11592 ruling — maintainer, 2026-08-25, 「全部同意」 on
 * recommendation B).
 *
 * `@objectstack/spec`'s `PageHeaderProps.actions` is
 * `z.array(z.string()).describe('Action IDs to show in header')`. This renderer
 * used to read that array as `ActionDef` OBJECTS and resolve nothing, so
 * metadata satisfying the published contract rendered ZERO buttons — the defect
 * the parent issue reports.
 *
 * The shape of the proof is deliberate: the same action metadata is authored
 * TWICE — once as ids, once as the inline objects authors write today — and the
 * two renders are compared. That is what makes "renders the same buttons" a
 * measurement rather than a restatement, and the object-shape render is the
 * LIVE CONTROL: every equivalence case asserts it is non-empty first, so an
 * id-side green can never come from two empty headers agreeing.
 *
 * Population covers each filter the acceptance criterion names, so one
 * equivalence assertion measures all of them at once:
 *   - `actionRendersAt` placement — `list_only` (list_item) must not render;
 *     `archive` (record_more) must land in the ⋯ menu, not inline
 *   - `requiredPermissions` — `gated` is denied for this user
 *   - `visible` — `closed_only` is a CEL predicate that is false for this record
 *   - `order` — `qualify` (order 1) renders BEFORE `convert` (order 2), which is
 *     the reverse of the order both authorings list them in
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, MetadataCtx, RecordContextProvider } from '@object-ui/react';
import type { MetadataContextValue } from '@object-ui/react';

/**
 * A script body on one of the resolved actions. The id path must never carry
 * this into anything serialized — see the `body.source` case at the bottom.
 */
const BODY_MARKER = 'OS6252_HANDLER_BODY_MARKER';

const ACTIONS: Record<string, any> = {
  convert: { name: 'convert', label: 'Convert Lead', type: 'flow', locations: ['record_header'], order: 2 },
  qualify: { name: 'qualify', label: 'Qualify', type: 'api', locations: ['record_header'], order: 1 },
  scripted: {
    name: 'scripted',
    label: 'Run Script',
    type: 'script',
    locations: ['record_header'],
    order: 3,
    body: { language: 'js', source: `return { marker: '${BODY_MARKER}' };` },
  },
  archive: { name: 'archive', label: 'Archive', type: 'api', locations: ['record_more'] },
  list_only: { name: 'list_only', label: 'List Only', type: 'api', locations: ['list_item'] },
  gated: {
    name: 'gated',
    label: 'Gated Action',
    type: 'api',
    locations: ['record_header'],
    requiredPermissions: ['nobody_holds_this'],
  },
  closed_only: {
    name: 'closed_only',
    label: 'Closed Only',
    type: 'api',
    locations: ['record_header'],
    visible: 'record.status == "closed"',
  },
};

/** Authoring order — deliberately NOT the rendered order (see `order` above). */
const AUTHORED = ['convert', 'qualify', 'scripted', 'archive', 'list_only', 'gated', 'closed_only'];

const OBJECT_META = { name: 'lead', label: 'Lead', actions: AUTHORED.map((n) => ACTIONS[n]) };

const RECORD = { id: 'rec-1', name: 'Ada', status: 'open' };
const USER = { id: 'u1', systemPermissions: ['setup.access'] };

const getItem = vi.fn(async (type: string, name: string) =>
  type === 'object' && name === 'lead' ? OBJECT_META : null,
);

/**
 * Hand-rolled context value held at MODULE level on purpose: `getItem` is an
 * effect dependency of `useMetadataItem`, so a value rebuilt per render spins
 * that hook forever (the loop `NO_METADATA_PROVIDER` was frozen to fix).
 */
const METADATA: MetadataContextValue = {
  apps: [],
  objects: [OBJECT_META] as any,
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: getItem as unknown as MetadataContextValue['getItem'],
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- registry component is stable
  return <Component schema={schema} />;
}

function mount(schema: any, metadata: MetadataContextValue = METADATA) {
  return render(
    <MetadataCtx.Provider value={metadata}>
      <ActionProvider context={{ user: USER } as any}>
        <RecordContextProvider
          objectName="lead"
          recordId={RECORD.id}
          data={RECORD}
          objectSchema={{ name: 'lead', label: 'Lead' }}
        >
          <PageHeader schema={schema} />
        </RecordContextProvider>
      </ActionProvider>
    </MetadataCtx.Provider>,
  );
}

/**
 * Ordered accessible names of the buttons in the header's ACTION ROW.
 *
 * Scoped to `role="toolbar"` — the record chrome (the copy-id and follow-star
 * buttons on the record chip) draws buttons of its own outside it, and those are
 * not what any of this is about. An action row with nothing in it is not
 * rendered at all, which reads here as `[]`.
 */
const buttonNames = (c: HTMLElement): string[] => {
  const toolbar = c.querySelector('[role="toolbar"]');
  if (!toolbar) return [];
  return Array.from(toolbar.querySelectorAll('button')).map(
    (b) => (b.getAttribute('aria-label') || b.textContent || '').trim(),
  );
};

/**
 * Structural projection of the rendered header, with the ids Radix mints per
 * mount (`id` / `aria-controls` / `aria-labelledby` / `aria-describedby`, and
 * the `:r0:`-style counters inside them) normalized away — those differ between
 * ANY two mounts and say nothing about which buttons the header drew.
 */
const shape = (c: HTMLElement): string =>
  c.innerHTML
    .replace(/\s(?:id|aria-controls|aria-labelledby|aria-describedby)="[^"]*"/g, '')
    .replace(/:r[0-9a-z]+:/g, ':rN:');

const idAuthored = { type: 'page:header', title: 'Lead', actions: [...AUTHORED] };
const objectAuthored = { type: 'page:header', title: 'Lead', actions: AUTHORED.map((n) => ACTIONS[n]) };

describe('page:header — declared action-id lookup (objectui#6252)', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  /** Every string this render passed to `console.warn`, first argument only. */
  const warnMessages = (): string[] =>
    (warn.mock.calls as unknown[][]).map((c) => String(c[0]));

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    vi.clearAllMocks();
  });

  it('renders the same buttons from ids as from the inline objects', async () => {
    // Live control FIRST: the object-shape authoring must draw a real header.
    // If this ever renders zero buttons the equivalence below measures nothing.
    const objectRender = mount(objectAuthored);
    const controlNames = buttonNames(objectRender.container);
    expect(controlNames).toContain('Convert Lead');
    expect(controlNames.length).toBeGreaterThan(1);
    const controlShape = shape(objectRender.container);
    objectRender.unmount();

    const idRender = mount(idAuthored);
    // Resolution runs through `useMetadataItem`, which settles in an effect.
    await screen.findByRole('button', { name: /Convert Lead/i });

    expect(buttonNames(idRender.container)).toEqual(controlNames);
    expect(shape(idRender.container)).toBe(controlShape);
  });

  it('honours order, placement, requiredPermissions and visible on the id path', async () => {
    const { container } = mount(idAuthored);
    await screen.findByRole('button', { name: /Convert Lead/i });
    const names = buttonNames(container);

    // `order`: qualify (1) before convert (2), the reverse of the authored order.
    expect(names.indexOf('Qualify')).toBeLessThan(names.indexOf('Convert Lead'));
    // `actionRendersAt`: list_item-only never renders on this surface.
    expect(screen.queryByRole('button', { name: /List Only/i })).toBeNull();
    // `requiredPermissions`: denied for this user.
    expect(screen.queryByRole('button', { name: /Gated Action/i })).toBeNull();
    // `visible`: the CEL predicate is false for a record with status "open".
    expect(screen.queryByRole('button', { name: /Closed Only/i })).toBeNull();
    // record_more is routed to the ⋯ overflow menu, never an inline slot.
    expect(screen.queryByRole('button', { name: /^Archive$/i })).toBeNull();
  });

  it('routes a record_more id into the overflow menu, never an inline slot', async () => {
    // Same evidence the sibling `record_more` pins in `page-header-actions.test.tsx`
    // take: the ⋯ trigger exists and the action is NOT among the inline buttons.
    // (The menu's own contents live behind a Radix portal that opens on
    // pointerdown; no test in this repo drives it open, and the routing claim is
    // fully carried by these two facts plus the equivalence case above.)
    const { container } = mount(idAuthored);
    await screen.findByRole('button', { name: /Convert Lead/i });
    expect(screen.getByRole('button', { name: /More actions/i })).toBeTruthy();
    expect(buttonNames(container)).not.toContain('Archive');
  });

  it('renders nothing but says so once when an id resolves to no action', async () => {
    const { container } = mount({
      type: 'page:header',
      title: 'Lead',
      actions: ['convert', 'covert_lead'], // second one is a typo of the first
    });
    // The control: the sibling id still resolves, so "nothing rendered" is about
    // the unresolvable id and not about a lookup that failed wholesale.
    await screen.findByRole('button', { name: /Convert Lead/i });
    expect(buttonNames(container)).toEqual(['Convert Lead']);

    await waitFor(() => expect(warn).toHaveBeenCalled());
    const hits = warnMessages().filter((m) => m.includes('covert_lead'));
    expect(hits.length).toBe(1);
    expect(hits[0]).toContain('[page:header]');
    // The message names what the object DOES declare — the fix is usually one
    // of them.
    expect(hits[0]).toContain('convert');
  });

  it('does not warn while the metadata lookup is still in flight', async () => {
    // A provider whose read never settles: `loading` stays true, so no id has
    // been shown to be unresolvable yet. Warning here would fire on the first
    // paint of every correctly-authored page.
    const pending: MetadataContextValue = {
      ...METADATA,
      getItem: (() => new Promise<never>(() => {})) as unknown as MetadataContextValue['getItem'],
    };
    const { container } = mount({ type: 'page:header', title: 'Lead', actions: ['convert'] }, pending);
    await Promise.resolve();
    await waitFor(() => expect(container.querySelector('h1, [data-page-actions-slot]')).toBeTruthy());
    expect(buttonNames(container)).toEqual([]);
    expect(warnMessages().filter((m) => m.includes('[page:header] action id'))).toEqual([]);
  });

  it('keeps the inline object shape working during the transition', async () => {
    // Renderer tolerance for the objectstack#11592 migration, still undeclared
    // (the spec's contract is ids). An ALL-object array passes through
    // `resolveDeclaredActionIds` untouched and never asks the metadata layer.
    getItem.mockClear();
    const { container } = mount({
      type: 'page:header',
      title: 'Lead',
      actions: [
        { name: 'adhoc', label: 'Ad Hoc', type: 'api', locations: ['record_header'] },
        { name: 'other', label: 'Other', type: 'api', locations: ['record_header'] },
      ],
    });
    expect(buttonNames(container)).toEqual(['Ad Hoc', 'Other']);
    expect(getItem).not.toHaveBeenCalled();
  });

  /**
   * objectui#7182 (maintainer ruling 2026-09-02, option C): a MIXED id/object
   * array is refused, not half-drawn. This case replaces the one that pinned
   * the opposite — "a mixed array resolves the id and passes the object
   * through" — which was this renderer's own choice under objectui#6252 and
   * exactly the divergence from `record:quick_actions` the ruling closes.
   */
  it('refuses a mixed id/object array — nothing authored renders, and the console names the offending index', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const adhoc = { name: 'adhoc', label: 'Ad Hoc', type: 'api', locations: ['record_header'] };
      // Live controls FIRST: each half renders on its own, so the refusal below
      // is about the MIX and not about either element.
      const idsOnly = mount({ type: 'page:header', title: 'Lead', actions: ['convert'] });
      await screen.findByRole('button', { name: /Convert Lead/i });
      idsOnly.unmount();
      const objectsOnly = mount({ type: 'page:header', title: 'Lead', actions: [adhoc] });
      expect(buttonNames(objectsOnly.container)).toEqual(['Ad Hoc']);
      objectsOnly.unmount();

      getItem.mockClear();
      const { container } = mount({ type: 'page:header', title: 'Lead', actions: ['convert', adhoc] });
      await waitFor(() => expect(container.querySelector('h1, [data-page-actions-slot]')).toBeTruthy());
      // Neither half: not the id the object metadata would resolve, not the
      // inline object that needs no lookup.
      expect(buttonNames(container)).toEqual([]);
      expect(screen.queryByRole('button', { name: /Convert Lead/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Ad Hoc/i })).toBeNull();
      // A refused array is refused BEFORE any lookup: the metadata layer is never asked.
      expect(getItem).not.toHaveBeenCalled();

      const hits = (error.mock.calls as unknown[][])
        .map((c) => String(c[0]))
        .filter((m) => m.includes('[page:header] actions refused'));
      expect(hits.length).toBe(1);
      expect(hits[0]).toContain('refused at index 1');
      expect(hits[0]).toContain('element 1 is an inline action object but element 0 is an action id');
      expect(hits[0]).toContain('mixed id/object action arrays are refused; use all ids or all objects');
    } finally {
      error.mockRestore();
    }
  });

  it('resolves ids authored under the spec-bridge `properties.actions` spelling', async () => {
    mount({ type: 'page:header', properties: { title: 'Lead', actions: ['convert'] } });
    expect(await screen.findByRole('button', { name: /Convert Lead/i })).toBeTruthy();
  });

  /**
   * Acceptance criterion 3 — "the id path carries no `body.source`".
   *
   * The authored node is what a page build serializes. Resolution must stay a
   * READ: nothing may write the resolved def (and with it the action's script
   * body) back onto the node. The object-shape authoring is the live control and
   * it fails this by construction — that is the whole point of the ids ruling,
   * and it is what proves the assertion below can fail at all.
   */
  it('never writes a resolved def — and so no body.source — back onto the authored node', async () => {
    const authored = { type: 'page:header', title: 'Lead', actions: ['convert', 'scripted'] };
    const before = JSON.stringify(authored);
    expect(before).not.toContain(BODY_MARKER);

    const { container } = mount(authored);
    await screen.findByRole('button', { name: /Run Script/i });

    expect(JSON.stringify(authored)).toBe(before);
    expect(container.innerHTML).not.toContain(BODY_MARKER);

    // Live control: the same action, authored inline, DOES carry its handler
    // body into the serialized node.
    expect(JSON.stringify(objectAuthored)).toContain(BODY_MARKER);
  });
});
