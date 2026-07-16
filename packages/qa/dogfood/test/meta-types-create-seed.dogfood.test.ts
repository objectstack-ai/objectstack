// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Phase 2 of the spec-derived create-shape contract: the authoritative minimal
// create seeds (packages/spec/src/kernel/metadata-create-seeds.ts) must reach
// the Studio designer / CLI / API clients through the real `/meta/types`
// registry response, so consumers derive their create defaults from the spec
// instead of re-inventing them (the drift that produced the dashboard-`layout`
// and action-`body` create-save 422s). Exercised end-to-end over real HTTP.

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
    const res = await stack.apiAs(token, 'GET', '/meta'); // GET {prefix} lists all metadata types (entries[])
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
});
