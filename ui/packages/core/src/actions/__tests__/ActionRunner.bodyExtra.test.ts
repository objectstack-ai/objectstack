/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `bodyExtra` on the runner's own API path, and the object-form `params`
 * deprecation window (objectstack#6837, the objectui half of #5777).
 *
 * Two facts under test, and they are different facts:
 *
 * 1. **Merge order** — `bodyExtra` is merged LAST, so a constant always beats a
 *    same-named user param. That is spec's documented semantics for the key
 *    ("merged last (overrides user params)") and what the console `apiHandler`
 *    already did on both branches; `ActionRunner.executeAPI` — the path taken
 *    when no host registered an `api` handler — never read the key at all, so an
 *    action whose payload lives only in `bodyExtra` POSTed an empty body.
 * 2. **The compat window is scoped** — the deprecation warning fires for exactly
 *    the shape `@objectstack/spec`'s `inline-action-api-params-to-body-extra`
 *    conversion rewrites (non-array `params` on `type: 'api'`), and for nothing
 *    else. The negative cases carry as much weight as the positive one: a
 *    warning on a `type: 'url'` action would prescribe `bodyExtra` for
 *    objectstack#6828's third meaning, and a warning on a host's `_rowRecord`
 *    stash would fire on nearly every declared-action click.
 */

import { afterAll, describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { ActionRunner } from '../ActionRunner';
import { resetActionKeyWarnings } from '../actionKeys';

/** The body the runner handed to `fetch`, parsed. */
function sentBody(): any {
  const init = (global.fetch as any).mock.calls[0][1];
  return JSON.parse(init.body);
}

function okFetch() {
  // `vi.stubGlobal` rather than `global.fetch = ...`: this file runs in the
  // `unit` project, which is `isolate: false`, so a raw assignment to a shared
  // global outlives the file and every later file in the worker inherits it
  // (objectui#8500). Only a stub can be handed back.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({}) }));
}

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('ActionRunner.executeAPI — bodyExtra', () => {
  beforeEach(() => {
    resetActionKeyWarnings();
    okFetch();
  });

  it('sends bodyExtra as the payload when the action has no other body source', async () => {
    // The shape the ADR-0087 conversion produces from an old object-form
    // `params` page. Before #6837 this POSTed the context record (or `{}`) and
    // the author's payload never left the browser.
    const runner = new ActionRunner({});
    const result = await runner.execute({
      type: 'api',
      target: '/api/v1/forms/contact-us/submit',
      bodyExtra: { name: 'Ada', email: 'ada@example.com' },
    });

    expect(result.success).toBe(true);
    expect(sentBody()).toEqual({ name: 'Ada', email: 'ada@example.com' });
  });

  it('merges bodyExtra LAST — a constant beats a same-named collected param', async () => {
    // The merge-order fact. `status` is present in BOTH places with different
    // values, so a reversed merge is a red test rather than a silent tie.
    const runner = new ActionRunner({});
    await runner.execute({
      type: 'api',
      target: '/api/v1/sys_api_key/k1',
      method: 'PATCH',
      params: { status: 'draft', note: 'from the user' },
      bodyExtra: { status: 'closed', revoked: true },
    });

    expect(sentBody()).toEqual({
      status: 'closed',      // bodyExtra won
      note: 'from the user', // untouched param survives
      revoked: true,
    });
  });

  it('merges bodyExtra over the context record on the ApiConfig branch too', async () => {
    // Same assembly, second call site (`api` as an object rather than a string).
    const runner = new ActionRunner({ data: { id: 7, status: 'draft' } });
    await runner.execute({
      type: 'api',
      api: { url: '/api/v1/order/7', method: 'PATCH' },
      bodyExtra: { status: 'closed' },
    });

    expect(sentBody()).toEqual({ id: 7, status: 'closed' });
  });

  it('leaves the body untouched when no bodyExtra is declared (back-compat)', async () => {
    const runner = new ActionRunner({ data: { id: 1, name: 'Test' } });
    await runner.execute({ type: 'api', target: '/api/v1/thing' });

    expect(sentBody()).toEqual({ id: 1, name: 'Test' });
  });

  it('ignores an ARRAY params — it is a definition list, never a payload', async () => {
    // Reachable only with no paramCollectionHandler mounted. POSTing the
    // ActionParam[] definitions as the request body was never a payload any
    // endpoint wanted; it now falls through to the context record, and
    // `bodyExtra` still lands.
    const runner = new ActionRunner({ data: { id: 3 } });
    await runner.execute({
      type: 'api',
      target: '/api/v1/thing',
      params: [{ name: 'reason', label: 'Reason', type: 'text' }] as any,
      bodyExtra: { archived: true },
    });

    expect(sentBody()).toEqual({ id: 3, archived: true });
  });
});

describe('ActionRunner — object-form params deprecation window (#5777)', () => {
  // `MockInstance<typeof console.warn>`, not `ReturnType<typeof vi.spyOn>`:
  // the latter is the un-instantiated `MockInstance<Procedure | Constructable>`,
  // whose `mock.calls` carries no argument types — so the `(c) => c.join(' ')`
  // callbacks below were implicit `any` (objectui#4040).
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    resetActionKeyWarnings();
    okFetch();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  /** Every `console.warn` argument list, flattened to one searchable string. */
  const warnings = () => warn.mock.calls.map((c) => c.join(' ')).join('\n');

  it('warns and names bodyExtra for a non-array params on a type:api action', async () => {
    const runner = new ActionRunner({});
    await runner.execute({
      type: 'api',
      name: 'submit_inquiry',
      target: '/api/v1/forms/contact-us/submit',
      params: { name: '{{page.inquiryName}}' },
    });

    expect(warnings()).toMatch(/bodyExtra/);
    expect(warnings()).toMatch(/submit_inquiry/);
    // …and it still WORKS. That is what makes it a window rather than a break.
    expect(sentBody()).toEqual({ name: '{{page.inquiryName}}' });
  });

  it('warns once per action, not once per click', async () => {
    const runner = new ActionRunner({});
    const action = { type: 'api', name: 'a1', target: '/api/v1/x', params: { k: 1 } };
    await runner.execute({ ...action });
    await runner.execute({ ...action });
    await runner.execute({ ...action });

    const hits = warn.mock.calls.filter((c) => c.join(' ').includes('bodyExtra'));
    expect(hits).toHaveLength(1);
  });

  it('stays SILENT for a type:url action — #6828 is a third meaning, not this one', async () => {
    // `interpolateTarget`'s `${param.X}` scope reads object-form params on a url
    // action. `bodyExtra` is not its replacement, so prescribing it here would be
    // wrong advice. The `api` guard mirrors the ADR-0087 conversion's own guard.
    //
    // The `params.newTab` half of that pair is now RETIRED (objectui#4097,
    // objectstack#6828 ruling) — `openIn` is the sanctioned spelling and the
    // fallback is gone. `newTab` stays in this fixture on purpose: it is now an
    // inert key on the retired shape, and this test's claim is about the
    // bodyExtra warning's TYPE GUARD, which is unaffected either way.
    const runner = new ActionRunner({});
    await runner.execute({
      type: 'url',
      name: 'open_report',
      target: '/reports/x?id=${param.reportId}',
      params: { reportId: 'r1', newTab: true },
    });

    expect(warnings()).not.toMatch(/bodyExtra/);
  });

  it('stays SILENT for an ARRAY params — that is the surviving meaning of the key', async () => {
    const runner = new ActionRunner({});
    await runner.execute({
      type: 'api',
      name: 'close_order',
      target: '/api/v1/order/close',
      params: [{ name: 'reason', label: 'Reason', type: 'text' }] as any,
    });

    expect(warnings()).not.toMatch(/bodyExtra/);
  });

  it('stays SILENT for a host-stashed params object (_rowRecord / recordId)', async () => {
    // DeclaredActionsBar dispatches `params: { _rowRecord: record }` and the api
    // handler lifts `recordId` out of the field values. Neither is an authored
    // payload, and warning on them would fire on nearly every declared action.
    const runner = new ActionRunner({});
    await runner.execute({
      type: 'api',
      name: 'approve',
      target: '/api/v1/approvals/approve',
      params: { _rowRecord: { id: 'rec1' }, _selectedIds: ['rec1'], recordId: 'rec1' },
    });

    expect(warnings()).not.toMatch(/bodyExtra/);
  });

  it('still warns when an authored key rides ALONGSIDE the host stash', async () => {
    // Discrimination proof for the filter above: it must not become a blanket
    // "params object with any underscore key is fine".
    const runner = new ActionRunner({});
    await runner.execute({
      type: 'api',
      name: 'approve_with_payload',
      target: '/api/v1/approvals/approve',
      params: { _rowRecord: { id: 'rec1' }, decision: 'approved' },
    });

    expect(warnings()).toMatch(/bodyExtra/);
  });
});
