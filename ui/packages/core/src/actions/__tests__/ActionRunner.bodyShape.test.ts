/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `bodyShape` on the runner's OWN api path (objectstack#6938).
 *
 * The card's face is the four declared-action renderer whitelists, which dropped
 * the key before it reached any runner. Fixing only those would have left a
 * second, narrower version of the same defect in place: the console `apiHandler`
 * (`useConsoleActionRuntime`) and `RecordDetailView.apiHandler` both wrapped, and
 * the runner's fallback `executeAPI` — the path taken when no host registered an
 * `api` handler — did not read `bodyShape` at all. The same action would then
 * change body shape depending on which host executed it, which is the "declared ≠
 * enforced" trap one hop further down.
 *
 * The semantics are the spec's, not invented here. `packages/spec/src/ui/action.zod.ts`
 * documents the key as: "`'flat'` (default) sends collected params at the top
 * level. `{ wrap: 'data' }` nests the user-collected params under that key (used
 * by better-auth `organization/update`), while `recordIdParam` and other
 * top-level keys stay flat." Both console read-sites implement exactly that
 * ordering, so there was one reading to mirror rather than a choice to make.
 */

import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
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

describe('ActionRunner.executeAPI — bodyShape', () => {
  beforeEach(() => {
    resetActionKeyWarnings();
    okFetch();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('nests the collected params under the declared wrap key', async () => {
    const runner = new ActionRunner({});
    const result = await runner.execute({
      type: 'api',
      target: '/api/v1/auth/organization/update',
      method: 'POST',
      params: { name: 'Acme Inc', slug: 'acme' },
      bodyShape: { wrap: 'data' },
    });

    expect(result.success).toBe(true);
    expect(sentBody()).toEqual({ data: { name: 'Acme Inc', slug: 'acme' } });
  });

  it('wraps the context record when the action carries no params', async () => {
    // `context.data` is the runner's documented fallback payload source; the wrap
    // covers whatever the flat path would have sent, not `params` specifically.
    const runner = new ActionRunner({ data: { id: 7, status: 'draft' } });
    await runner.execute({
      type: 'api',
      target: '/api/v1/order/7',
      method: 'PATCH',
      bodyShape: { wrap: 'data' },
    });

    expect(sentBody()).toEqual({ data: { id: 7, status: 'draft' } });
  });

  it('keeps bodyExtra FLAT beside the wrap', async () => {
    // The spec's "other top-level keys stay flat" clause, and what both console
    // read-sites do (`Object.assign(body, action.bodyExtra)` AFTER the wrap is
    // built). A `bodyExtra` swallowed into the wrapped object would be red here.
    const runner = new ActionRunner({});
    await runner.execute({
      type: 'api',
      target: '/api/v1/auth/organization/update',
      params: { name: 'Acme Inc' },
      bodyExtra: { organizationId: 'org_1' },
      bodyShape: { wrap: 'data' },
    });

    expect(sentBody()).toEqual({
      data: { name: 'Acme Inc' },
      organizationId: 'org_1',
    });
  });

  it('wraps on the ApiConfig branch too', async () => {
    // Second call site of the same assembly (`api` as an object, not a string).
    const runner = new ActionRunner({ data: { id: 7 } });
    await runner.execute({
      type: 'api',
      api: { url: '/api/v1/order/7', method: 'PATCH' },
      bodyShape: { wrap: 'data' },
    });

    expect(sentBody()).toEqual({ data: { id: 7 } });
  });

  it('sends a flat body for bodyShape: "flat"', async () => {
    const runner = new ActionRunner({});
    await runner.execute({
      type: 'api',
      target: '/api/v1/order/close',
      params: { note: 'from the user' },
      bodyShape: 'flat',
    });

    expect(sentBody()).toEqual({ note: 'from the user' });
  });

  it('sends a flat body when no bodyShape is declared (regression pin)', async () => {
    // The unchanged default. Pinned so the wrap branch cannot start applying to
    // every action unnoticed.
    const runner = new ActionRunner({ data: { id: 1, name: 'Test' } });
    await runner.execute({ type: 'api', target: '/api/v1/thing' });

    expect(sentBody()).toEqual({ id: 1, name: 'Test' });
  });

  it('degrades to flat for an off-spec bodyShape instead of inventing a key', async () => {
    // `{ wrap: 42 }` and `{}` are parse REJECTIONS at the producer (the spec's
    // `bodyShape` is `'flat' | { wrap: string }` under a strictObject), so this is
    // not a tolerated dialect — it is the shape an unvalidated host could hand the
    // runner directly. The read-site predicate is the console's, so such a value
    // produces the documented default rather than a literal `{"undefined": …}` key
    // on the wire. Fixing bad metadata stays the producer's job.
    const runner = new ActionRunner({});
    await runner.execute({
      type: 'api',
      target: '/api/v1/order/close',
      params: { note: 'n' },
      bodyShape: { wrap: 42 } as any,
    });

    expect(sentBody()).toEqual({ note: 'n' });
  });
});
