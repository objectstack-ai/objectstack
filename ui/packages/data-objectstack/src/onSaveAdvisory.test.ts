/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The SECOND client class's metadata save door must surface the runtime
 * authoring gate's advisory findings (objectui#4237; backend objectstack#7435).
 *
 * `ObjectStackClient.meta.saveItem` writes through the same
 * `PUT /api/v1/meta/:type/:name` as `MetadataClient.save`, but it is a
 * different class and #4133/#4236 only covered the other one — every caller
 * here awaited the call and discarded the response, so an `advisories[]` the
 * server attached was parsed off the wire and dropped. These pins are the
 * red-first evidence: with `installSaveAdvisoryInterceptor()` reverted, every
 * "emits" case below fails because no event is ever produced.
 *
 * ## Why these drive a REAL SDK client through a fake `fetch`
 *
 * The sibling `onWriteWarning.test.ts` replaces `ds.client` with a stub, which
 * is right for the data door. It would be wrong here: the whole premise of this
 * fix is a measurement about the wire — that the SDK's `unwrapResponse` hands
 * the save body back VERBATIM (it strips its `{ success, data }` envelope only
 * when the body has a `data` key, and this one does not), so `advisories` is
 * still at the top level where the shared `readSaveAdvisories` looks for it.
 * Stubbing `meta` would assume exactly the thing under test. Driving the real
 * client keeps that measured on every run.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';
import type {
  MetadataSaveAdvisoryEvent,
  RuntimeAuthoringIssue,
  WriteWarningEvent,
} from './index';

/** The measured `nightly_purge` finding, in the spec's D3 shape. */
const PURGE_ADVISORY: RuntimeAuthoringIssue = {
  severity: 'warning',
  rule: 'flow/delete-without-filter',
  where: 'flow "nightly_purge" · node "purge old rows"',
  path: 'flows[0].nodes[2].config.filters',
  message: 'this delete_record node sets multi: true with no filter, so it deletes every row',
  hint: 'add a filter, or set multi: false to delete a single record',
};

/**
 * The clean part of a real save response. `success`/`version`/`seq`/`state` are
 * REQUIRED by `SaveMetaItemResponseSchema` (#5745) — spelled out here because
 * their presence is what makes the `unwrapResponse` measurement above
 * meaningful: a `success` boolean with NO sibling `data` key.
 */
const CLEAN_BODY = { success: true, version: 'v2', seq: 4, state: 'active' as const };

/** A `fetch` that answers every metadata PUT with `body`, and records the calls. */
function fetchAnswering(body: unknown) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

/**
 * A connected adapter whose client talks to `fetchImpl`. `connected` is forced
 * rather than discovered, exactly as the sibling write-warning suite does — the
 * save door needs no discovery (`getRoute('metadata')` falls back to
 * `/api/v1/meta`), and skipping it keeps the module-level discovery cache out
 * of these tests.
 */
function makeAdapter(body: unknown) {
  const fetchImpl = fetchAnswering(body);
  const ds: any = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: fetchImpl as unknown as typeof fetch,
  });
  ds.connected = true;
  ds.connectionState = 'connected';
  return { ds, fetchImpl };
}

describe('ObjectStackAdapter.onSaveAdvisory — the second client class (#4237)', () => {
  it('emits the findings a successful save returned', async () => {
    const { ds } = makeAdapter({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] });
    const events: MetadataSaveAdvisoryEvent[] = [];
    ds.onSaveAdvisory((e: MetadataSaveAdvisoryEvent) => events.push(e));

    await ds.getClient().meta.saveItem('flow', 'nightly_purge', { name: 'nightly_purge' });

    expect(events).toEqual([
      {
        type: 'flow',
        name: 'nightly_purge',
        // #5026 — this interceptor wraps the SDK's `meta.saveItem`, so every
        // event it emits comes through the save door by construction.
        door: 'save',
        mode: 'publish',
        advisories: [PURGE_ADVISORY],
      },
    ]);
  });

  it('carries rule, message and hint through verbatim — they are server prose', async () => {
    const { ds } = makeAdapter({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] });
    const events: MetadataSaveAdvisoryEvent[] = [];
    ds.onSaveAdvisory((e: MetadataSaveAdvisoryEvent) => events.push(e));

    await ds.getClient().meta.saveItem('flow', 'nightly_purge', {});

    const finding = events[0]!.advisories[0]!;
    expect(finding.rule).toBe('flow/delete-without-filter');
    expect(finding.message).toBe(PURGE_ADVISORY.message);
    expect(finding.hint).toBe(PURGE_ADVISORY.hint);
    // Never `error` on this channel — an error-severity finding is a 422.
    expect(finding.severity).toBe('warning');
  });

  /**
   * The response-shape measurement the fix rests on, asserted rather than
   * assumed: this body is handed back whole. If a future SDK started wrapping
   * the save response in `{ success, data }`, THIS is the case that goes red
   * and says so, instead of the advisory channel quietly emitting nothing.
   */
  it('hands the caller the save response unchanged — the SDK does not unwrap this body', async () => {
    const body = { ...CLEAN_BODY, advisories: [PURGE_ADVISORY] };
    const { ds } = makeAdapter(body);

    const result = await ds.getClient().meta.saveItem('flow', 'nightly_purge', {});

    expect(result).toEqual(body);
    expect(result.version).toBe('v2');
    expect(result.advisories).toEqual([PURGE_ADVISORY]);
  });

  it('says nothing on a clean save — the server omits the key entirely', async () => {
    const { ds } = makeAdapter(CLEAN_BODY);
    const events: MetadataSaveAdvisoryEvent[] = [];
    ds.onSaveAdvisory((e: MetadataSaveAdvisoryEvent) => events.push(e));

    await ds.getClient().meta.saveItem('object', 'account', { name: 'account' });

    expect(events).toEqual([]);
  });

  it('says nothing when the array is present but empty', async () => {
    const { ds } = makeAdapter({ ...CLEAN_BODY, advisories: [] });
    const events: MetadataSaveAdvisoryEvent[] = [];
    ds.onSaveAdvisory((e: MetadataSaveAdvisoryEvent) => events.push(e));

    await ds.getClient().meta.saveItem('object', 'account', {});

    expect(events).toEqual([]);
  });

  it('drops half-shaped findings rather than rendering blanks at the author', async () => {
    const { ds } = makeAdapter({
      ...CLEAN_BODY,
      advisories: [PURGE_ADVISORY, { rule: 'only-a-rule' }, null, 'string'],
    });
    const events: MetadataSaveAdvisoryEvent[] = [];
    ds.onSaveAdvisory((e: MetadataSaveAdvisoryEvent) => events.push(e));

    await ds.getClient().meta.saveItem('flow', 'nightly_purge', {});

    // The SAME reader `MetadataClient.save` uses — one reader, two call sites.
    expect(events[0]!.advisories).toEqual([PURGE_ADVISORY]);
  });

  it('a throwing listener never fails a save the server already committed', async () => {
    const { ds } = makeAdapter({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: MetadataSaveAdvisoryEvent[] = [];
    ds.onSaveAdvisory(() => {
      throw new Error('renderer exploded');
    });
    // Registered second: a throwing listener must not starve the others.
    ds.onSaveAdvisory((e: MetadataSaveAdvisoryEvent) => seen.push(e));

    await expect(
      ds.getClient().meta.saveItem('flow', 'nightly_purge', {}),
    ).resolves.toBeTruthy();
    expect(seen).toHaveLength(1);
    warn.mockRestore();
  });

  it('unsubscribes', async () => {
    const { ds } = makeAdapter({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] });
    const events: MetadataSaveAdvisoryEvent[] = [];
    const off = ds.onSaveAdvisory((e: MetadataSaveAdvisoryEvent) => events.push(e));

    await ds.getClient().meta.saveItem('flow', 'a', {});
    off();
    await ds.getClient().meta.saveItem('flow', 'b', {});

    expect(events).toHaveLength(1);
  });

  /**
   * Control for the #4133/#4236 sibling channel: a metadata save is NOT a
   * record write, and must not appear on the dropped-fields channel. This is
   * what makes the "existing `onWriteWarning` consumers unchanged" claim
   * checkable rather than asserted.
   */
  it('does not leak onto the write-warning channel', async () => {
    const { ds } = makeAdapter({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] });
    const warnings: WriteWarningEvent[] = [];
    ds.onWriteWarning((e: WriteWarningEvent) => warnings.push(e));

    await ds.getClient().meta.saveItem('flow', 'nightly_purge', {});

    expect(warnings).toEqual([]);
  });
});

/**
 * Draft-door honesty (D1), carried over from #4236's finding.
 *
 * Drafts are never gated — the framework returns at
 * `runtime-authoring-gate.ts`'s early return:
 *
 *     // D1 — drafts are never gated. Publishing one runs this same function.
 *     if (args.state !== 'active') return null;
 *
 * so a draft save produces no findings at all rather than producing some that
 * get withheld. Unlike the other client class, THIS one has no draft door to
 * begin with: the SDK's `saveItem(type, name, item)` takes no mode, so every
 * caller enumerated on #4237 writes the active door and the gate does run for
 * all of them. `mode` is therefore read off the response's own `state`.
 */
describe('save-advisory mode reflects the door the server reports (D1)', () => {
  it('a draft-state response with no findings emits nothing — the gate never ran', async () => {
    const { ds } = makeAdapter({ ...CLEAN_BODY, state: 'draft' });
    const events: MetadataSaveAdvisoryEvent[] = [];
    ds.onSaveAdvisory((e: MetadataSaveAdvisoryEvent) => events.push(e));

    await ds.getClient().meta.saveItem('flow', 'nightly_purge', {});

    expect(events).toEqual([]);
  });

  it('labels the mode from the response state when a draft does somehow advise', async () => {
    // Not reachable through today's server (see D1 above), but the event must
    // tell the truth about which door it came through rather than hard-coding
    // one, so the field is pinned on its own.
    const { ds } = makeAdapter({
      ...CLEAN_BODY,
      state: 'draft',
      advisories: [PURGE_ADVISORY],
    });
    const events: MetadataSaveAdvisoryEvent[] = [];
    ds.onSaveAdvisory((e: MetadataSaveAdvisoryEvent) => events.push(e));

    await ds.getClient().meta.saveItem('flow', 'nightly_purge', {});

    expect(events[0]!.mode).toBe('draft');
  });
});

/**
 * Caller coverage. The point of putting ONE emitter at the client seam is that
 * the enumerated call sites need no edit — so the pins that matter are the ones
 * that never mention the interceptor.
 */
describe('the enumerated callers are covered without a per-site edit', () => {
  it("covers the adapter's own view save path (createView)", async () => {
    const { ds } = makeAdapter({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] });
    const events: MetadataSaveAdvisoryEvent[] = [];
    ds.onSaveAdvisory((e: MetadataSaveAdvisoryEvent) => events.push(e));

    await ds.createView('lead', { name: 'all_leads', object: 'lead' });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('view');
    expect(events[0]!.name).toBe('all_leads');
  });

  it("covers the adapter's own dashboard save path (updateDashboard)", async () => {
    const { ds } = makeAdapter({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] });
    const events: MetadataSaveAdvisoryEvent[] = [];
    ds.onSaveAdvisory((e: MetadataSaveAdvisoryEvent) => events.push(e));

    await ds.updateDashboard('crm_overview_dashboard', { widgets: [] });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('dashboard');
    expect(events[0]!.name).toBe('crm_overview_dashboard');
  });

  /**
   * `getClient()` hands back the adapter's own long-lived instance, which is
   * how every caller OUTSIDE this package reaches the save door
   * (`MetadataService`, `useNavigationSync`, plugin-designer's app wizard).
   * If that ever started returning a fresh or wrapped client, the interceptor
   * would stop covering them — so the identity is pinned here.
   */
  it('getClient() is the intercepted instance every external caller uses', async () => {
    const { ds } = makeAdapter({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] });
    const events: MetadataSaveAdvisoryEvent[] = [];
    ds.onSaveAdvisory((e: MetadataSaveAdvisoryEvent) => events.push(e));

    expect(ds.getClient()).toBe(ds.getClient());

    // The `saveItem('app', …)` shape `useNavigationSync` and the plugin-designer
    // app wizard both use.
    await ds.getClient().meta.saveItem('app', 'crm', { name: 'crm' });

    expect(events[0]).toMatchObject({ type: 'app', name: 'crm' });
  });
});
