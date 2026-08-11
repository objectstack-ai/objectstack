// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Phase 2 of the spec-derived create-shape contract: the authoritative minimal
// create seeds (packages/spec/src/kernel/metadata-create-seeds.ts) must reach
// the Studio designer / CLI / API clients through the real `/meta/types`
// registry response, so consumers derive their create defaults from the spec
// instead of re-inventing them (the drift that produced the dashboard-`layout`
// and action-`body` create-save 422s). Exercised end-to-end over real HTTP.
//
// [#7526] This header said `/meta/types` from the day it was written while the
// call below asked `/meta` — so the file documented coverage of a path it never
// touched, and `/meta/types` was in fact dead (swallowed by the `/meta/:type`
// catch-all, answering `{"type":"types","items":[]}` for anyone who called it).
// A test whose comment describes a route it does not call is worse than no
// test: it is what someone reads when they ask "is this covered?". It reads
// `/meta/types` now, and pins the two paths against each other so the alias
// cannot rot back apart.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { getMetadataCreateSeed, listMetadataCreateSeedTypes } from '@objectstack/spec/kernel';

describe('dogfood: /meta/types exposes authoritative create seeds (spec-derived create-shape contract)', () => {
  let stack: VerifyStack;
  let token: string;
  let entries: Array<Record<string, unknown>>;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    token = await stack.signIn();
    const res = await stack.apiAs(token, 'GET', '/meta/types');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries?: Array<Record<string, unknown>> };
    entries = body.entries ?? [];
    expect(entries.length).toBeGreaterThan(0);
  }, 90_000);

  afterAll(async () => {
    await stack?.stop();
  });

  const entryFor = (type: string) => entries.find((e) => e.type === type);

  it('carries the dashboard create seed (widgets: [])', () => {
    const seed = entryFor('dashboard')?.createSeed as Record<string, unknown> | undefined;
    expect(seed).toBeDefined();
    expect(seed).toMatchObject({ widgets: [] });
  });

  it('carries the action create seed with a valid executable body', () => {
    const seed = entryFor('action')?.createSeed as Record<string, unknown> | undefined;
    expect(seed).toBeDefined();
    expect(seed?.type).toBe('script');
    expect((seed?.body as Record<string, unknown>)?.language).toBe('js');
  });

  it('omits a seed for report (a canvas-create type whose dataset is picked interactively)', () => {
    // report IS a registered type but is intentionally absent from the seed
    // registry — its minimal valid shape needs a dataset chosen on the canvas,
    // not a static literal. The designer falls back / uses canvas create.
    expect(entryFor('report')).toBeDefined();
    expect(entryFor('report')?.createSeed).toBeUndefined();
  });

  it('every seeded type that is also a registered /meta/types entry exposes its exact seed', () => {
    for (const type of listMetadataCreateSeedTypes()) {
      const entry = entryFor(type);
      if (!entry) continue; // type may not be registered in this app — skip
      expect(entry.createSeed, `${type} entry is missing its create seed`).toEqual(getMetadataCreateSeed(type));
    }
  });

  // [#7526] `/meta/types` and `/meta` are ONE handler at two paths, and this is
  // the assertion that keeps that true. It is also the regression pin for the
  // defect: before the fix `/meta/types` answered `{type:'types', items:[]}` —
  // the `/meta/:type` catch-all's shape, with no `entries` at all — so this
  // comparison could not have passed no matter how the bodies were compared.
  it('answers the same body as GET /meta — the two paths are one handler', async () => {
    const [viaTypes, viaBase] = await Promise.all([
      stack.apiAs(token, 'GET', '/meta/types'),
      stack.apiAs(token, 'GET', '/meta'),
    ]);
    expect(viaTypes.status).toBe(200);
    expect(viaBase.status).toBe(200);
    expect(await viaTypes.json()).toEqual(await viaBase.json());
  }, 30_000);

  // The disguise, pinned: an unknown type answers the catch-all's shape, and
  // `/meta/types` must NOT look like that. Without this, a future registration
  // that puts `/meta/types` back under `/meta/:type` would still return 200 and
  // every assertion above would fail with a confusing "entries is empty".
  it('is not the /meta/:type catch-all wearing a 200', async () => {
    const bogus = await stack.apiAs(token, 'GET', '/meta/zzz_not_a_type');
    expect(bogus.status).toBe(200);
    expect(await bogus.json()).toEqual({ type: 'zzz_not_a_type', items: [] });

    const real = await stack.apiAs(token, 'GET', '/meta/types');
    const body = (await real.json()) as Record<string, unknown>;
    expect(body.items).toBeUndefined();
    expect(Array.isArray(body.entries)).toBe(true);
  }, 30_000);
});
