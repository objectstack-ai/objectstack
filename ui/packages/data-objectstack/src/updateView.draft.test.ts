/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';

/**
 * `updateView` read/write addressing (#4139).
 *
 * ADR-0034 routes a runtime-created view through the per-item DRAFT seam
 * (`createRuntimeMetadata` → `metadataClient.save(..., { mode: 'draft' })`),
 * so a view made from the `+` tab exists ONLY as a draft row until an
 * explicit Publish. `updateView` used to read *and* write the published
 * overlay on both halves: the read 404ed, a `catch {}` labelled
 * "treat missing as create-equivalent" substituted `current = {}`, and the
 * merge degenerated into a `{label, name, object}` partial that the server
 * rejects (422) — while the draft row the UI actually reads back through
 * `?preview=draft` kept the old label. The rename was silently lost.
 *
 * These pins fix the addressing on BOTH halves: whichever row the read
 * resolved is the row the write updates.
 */

/** The canonical ViewItem envelope `viewEnvelope()` stages as a draft. */
const DRAFT_VIEW = {
  name: 'crm_activity.kanban_board',
  object: 'crm_activity',
  viewKind: 'list',
  label: 'Kanban Board',
  config: {
    type: 'kanban',
    columns: ['subject', 'status', 'due_date'],
    kanban: { columns: ['subject', 'status', 'due_date'], groupBy: 'status' },
    data: { provider: 'object', object: 'crm_activity' },
  },
};

interface Harness {
  ds: any;
  /** Published-overlay writes (`client.meta.saveItem`) — the wrong address for a draft. */
  saveItem: ReturnType<typeof vi.fn>;
  /** Draft-addressed writes: `[url, parsedBody]` per `PUT ...?mode=draft`. */
  draftPuts: Array<[string, any]>;
  /** Every metadata URL the adapter fetched, in order. */
  urls: string[];
}

/**
 * Build an adapter whose two metadata addresses answer independently.
 *
 * @param opts.draft      body served at `GET /meta/view/:name?state=draft`
 *                        (`null` → 404, i.e. nothing pending), wrapped in the
 *                        `{type,name,item}` envelope the framework sends for
 *                        draft reads.
 * @param opts.published  what `client.meta.getItem` (the published read) does:
 *                        a body to resolve, or an Error to throw.
 */
function makeDS(opts: { draft: any | null; published: any | Error }): Harness {
  const draftPuts: Array<[string, any]> = [];
  const urls: string[] = [];

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    if (url.includes('/meta/view/')) {
      urls.push(url);
      if ((init?.method ?? 'GET') === 'PUT') {
        draftPuts.push([url, JSON.parse(String(init?.body ?? '{}'))]);
        return json({ success: true, version: 2 });
      }
      if (url.includes('state=draft')) {
        if (opts.draft == null) return json({ error: 'not found' }, 404);
        // Draft reads answer the `{type,name,item}` envelope (unlike the
        // bare-body published read) — the asymmetry `unwrapDraftBody` exists for.
        return json({ type: 'view', name: opts.draft.name, item: opts.draft });
      }
      return json({ error: 'not found' }, 404);
    }
    return json({ success: true, data: { capabilities: {}, routes: {} } });
  });

  const ds: any = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchImpl });
  ds.connected = true;
  ds.connectionState = 'connected';
  const saveItem = vi.fn(async () => ({ success: true }));
  ds.client = {
    meta: {
      getItem: vi.fn(async () => {
        if (opts.published instanceof Error) throw opts.published;
        return { item: opts.published };
      }),
      saveItem,
    },
  };
  return { ds, saveItem, draftPuts, urls };
}

/** A published read that 404s, decorated the way the SDK client decorates. */
function notFound(): Error {
  return Object.assign(new Error('Metadata item not found'), { httpStatus: 404 });
}

describe('ObjectStackDataSource.updateView — draft addressing (#4139)', () => {
  it('renames a draft-only view by merging onto the DRAFT body and writing the draft back', async () => {
    const { ds, saveItem, draftPuts } = makeDS({ draft: DRAFT_VIEW, published: notFound() });

    await ds.updateView('crm_activity', DRAFT_VIEW.name, { label: 'Pipeline Board' });

    // The write must be draft-addressed — the published overlay is the wrong
    // row, and writing it would publish a view the user never published.
    expect(saveItem).not.toHaveBeenCalled();
    expect(draftPuts).toHaveLength(1);
    const [url, body] = draftPuts[0];
    expect(url).toContain('mode=draft');
    expect(url).toContain(encodeURIComponent(DRAFT_VIEW.name));

    // …and it must carry the FULL merged document, not the
    // `{label, name, object}` partial the create-equivalent path produced.
    expect(body.label).toBe('Pipeline Board');
    expect(body.viewKind).toBe('list');
    expect(body.name).toBe(DRAFT_VIEW.name);
    expect(body.object).toBe('crm_activity');
    expect(body.config).toEqual(DRAFT_VIEW.config);
    // The pre-fix partial had exactly these three keys — pin the shape so a
    // regression cannot pass by carrying the label alone.
    expect(Object.keys(body).sort()).toEqual(
      ['config', 'label', 'name', 'object', 'viewKind'].sort(),
    );
  });

  it('probes the draft BEFORE the published overlay, so a pending draft is never shadowed', async () => {
    // A view with both a published overlay and a pending draft: the edit
    // belongs to the draft. Writing the published row instead would be
    // overwritten at publish time — the rename would vanish on Publish.
    const published = { ...DRAFT_VIEW, label: 'Old Published Label' };
    const { ds, saveItem, draftPuts } = makeDS({ draft: DRAFT_VIEW, published });

    await ds.updateView('crm_activity', DRAFT_VIEW.name, { label: 'Pipeline Board' });

    expect(saveItem).not.toHaveBeenCalled();
    expect(draftPuts).toHaveLength(1);
    expect(draftPuts[0][1].label).toBe('Pipeline Board');
  });

  it('carries the full document for a set-default patch too, not just renames', async () => {
    // `handleSetDefaultView` drives the same read-merge-write cycle with
    // `{isDefault}`, so it degraded into the same partial write (#4139).
    const { ds, draftPuts } = makeDS({ draft: DRAFT_VIEW, published: notFound() });

    await ds.updateView('crm_activity', DRAFT_VIEW.name, { isDefault: true });

    expect(draftPuts).toHaveLength(1);
    const body = draftPuts[0][1];
    expect(body.isDefault).toBe(true);
    expect(body.label).toBe('Kanban Board');
    expect(body.config).toEqual(DRAFT_VIEW.config);
  });

  it('CONTROL — a published view with no pending draft still updates the published overlay', async () => {
    const published = {
      name: 'crm_activity.all',
      object: 'crm_activity',
      viewKind: 'list',
      label: 'All Activities',
      config: { type: 'grid', data: { object: 'crm_activity' } },
    };
    const { ds, saveItem, draftPuts } = makeDS({ draft: null, published });

    await ds.updateView('crm_activity', 'crm_activity.all', { label: 'Everything' });

    // No draft row → the published path is unchanged.
    expect(draftPuts).toHaveLength(0);
    expect(saveItem).toHaveBeenCalledTimes(1);
    const [type, name, body] = saveItem.mock.calls[0];
    expect(type).toBe('view');
    expect(name).toBe('crm_activity.all');
    expect(body.label).toBe('Everything');
    expect(body.viewKind).toBe('list');
    expect(body.config).toEqual(published.config);
  });

  it('surfaces a genuinely-missing view instead of writing a create-equivalent partial', async () => {
    const { ds, saveItem, draftPuts } = makeDS({ draft: null, published: notFound() });

    await expect(
      ds.updateView('crm_activity', 'crm_activity.ghost', { label: 'Nope' }),
    ).rejects.toThrow(/crm_activity\.ghost/);

    // The whole point: no partial write is emitted on the way out.
    expect(saveItem).not.toHaveBeenCalled();
    expect(draftPuts).toHaveLength(0);
  });

  it('surfaces a transport failure on the published read rather than degrading to a partial write', async () => {
    const boom = Object.assign(new Error('Internal Server Error'), { httpStatus: 500 });
    const { ds, saveItem, draftPuts } = makeDS({ draft: null, published: boom });

    await expect(
      ds.updateView('crm_activity', 'crm_activity.all', { label: 'Nope' }),
    ).rejects.toThrow('Internal Server Error');

    expect(saveItem).not.toHaveBeenCalled();
    expect(draftPuts).toHaveLength(0);
  });

  it('surfaces a transport failure on the DRAFT probe rather than falling through to the published row', async () => {
    // A 500 on the draft probe is not "no draft pending" — falling through
    // would write the published overlay while a draft may still shadow it.
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/meta/view/') && url.includes('state=draft')) {
        return new Response(JSON.stringify({ error: 'boom' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const ds: any = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchImpl });
    ds.connected = true;
    ds.connectionState = 'connected';
    const saveItem = vi.fn(async () => ({ success: true }));
    ds.client = { meta: { getItem: vi.fn(async () => ({ item: DRAFT_VIEW })), saveItem } };

    await expect(
      ds.updateView('crm_activity', DRAFT_VIEW.name, { label: 'Nope' }),
    ).rejects.toThrow();
    expect(saveItem).not.toHaveBeenCalled();
  });
  /**
   * objectui#8181 — the merged draft written back carries no read decorations.
   *
   * The draft-addressed limb READS a served body and WRITES the merge of it
   * straight back, so it is a complete read->edit->write round trip. The
   * framework decorates the read (`_diagnostics` for any type with a
   * registered schema, plus `_draft: true` on the draft branch), and the spec
   * names those keys precisely so they do not go back out: `ViewSchema` and
   * every other closed schema refuse them by name.
   *
   * ⚠️ Today's server absorbs this — `saveMetaItem` strips read decorations on
   * ingress before its own schema gate — so the leak is invisible from the
   * response. That is a mitigation on the far side of the wire, not a reason
   * for this client to put them on it (AGENTS.md #0.1: one strict contract,
   * fixed at the producer). What this pin defends is the body this adapter
   * SENDS.
   */
  it('does not write the framework read decorations back onto the draft', async () => {
    const decorated = {
      ...DRAFT_VIEW,
      _diagnostics: { valid: true, errors: [] },
      _draft: true,
      // ADR-0010 protection carriers ride along and MUST survive: the schemas
      // declare them, and dropping them would lose provenance on every write.
      _provenance: 'package',
      _packageId: 'com.test.crm',
    };
    const { ds, draftPuts } = makeDS({ draft: decorated, published: new Error('unused') });

    const merged = await ds.updateView('crm_activity', DRAFT_VIEW.name, { label: 'Renamed' });

    // CONTROL: the draft limb really ran and really wrote (a published-limb
    // run, or no write at all, would satisfy every absence check below).
    expect(draftPuts).toHaveLength(1);
    const [url, body] = draftPuts[0]!;
    expect(url).toContain('mode=draft');
    expect(body.label).toBe('Renamed');

    // The decorations are not on the wire…
    expect(body).not.toHaveProperty('_diagnostics');
    expect(body).not.toHaveProperty('_draft');
    // …nor in what the caller is handed back to render.
    expect(merged).not.toHaveProperty('_diagnostics');
    expect(merged).not.toHaveProperty('_draft');

    // …and the protection envelope was NOT collateral damage.
    expect(body._provenance).toBe('package');
    expect(body._packageId).toBe('com.test.crm');
  });
});
