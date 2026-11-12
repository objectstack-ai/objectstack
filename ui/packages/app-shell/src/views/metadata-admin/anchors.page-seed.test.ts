// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
// `createSeed` reaches the page synthesizer through a dynamic
// `await import('@object-ui/plugin-detail')` (anchors.ts), so the cold transform
// of that whole package graph is billed to whichever test first awaits the hook
// — inside the test body, against the 15s `testTimeout`. The `unit` project runs
// `isolate: false`, so whether the module is already warm depends on what else
// the worker happened to run first; when it wasn't, the seeding test blew the
// budget. (It surfaced as a timeout rather than a wrong result because
// `createSeed` swallows failures.)
//
// Importing it here moves that cost into the file's import phase, which no test
// or hook timeout applies to, so it can never land inside a timed window again.
// Keep the specifier identical to the one in anchors.ts — ESM caches by resolved
// specifier, so this makes the hook's own dynamic import resolve immediately.
import '@object-ui/plugin-detail';
// The same for the three packages `validateMetadataDraft` reaches through the
// CEL authoring helpers' dynamic imports (`check:test-source-alias`).
import '@objectstack/formula';
import '@objectstack/lint';
import '@object-ui/core';

// The synthesizer the hook imports, passed through to the real one unless a
// test names what it returns (a synthesized page that places no component).
const synth = vi.hoisted(() => ({ returns: undefined as Record<string, unknown> | undefined }));
vi.mock('@object-ui/plugin-detail', async (importOriginal) => {
  const real = await importOriginal<typeof import('@object-ui/plugin-detail')>();
  return {
    ...real,
    buildDefaultPageSchema: (...args: Parameters<typeof real.buildDefaultPageSchema>) =>
      synth.returns ?? real.buildDefaultPageSchema(...args),
  };
});

import { registerBuiltinAnchors } from './anchors';
import { resolveResourceConfig } from './registry';
import { applyTransform } from './createDerive';
import { buildCreateModeBody } from './createBody';
import { validateMetadataDraft } from './clientValidation';
import { getMetadataCreateSeed } from '@objectstack/spec/kernel';
import { PageSchema, ComponentPropsMap } from '@objectstack/spec/ui';

/**
 * The `page` resource's create-time seeding.
 *
 * A record page is created `kind: 'slotted'` with no slots — the synthesized
 * default page, which keeps following the object until the author overrides a
 * slot. The synthesized regions are copied (#1541's seed) only when the author
 * explicitly creates a `full` record page; the create form's `kind` follows the
 * page type (`page-kind` derive), so `full` on a record page is the author's
 * own pick.
 */
registerBuiltinAnchors();

const objectDef = {
  name: 'showcase_invoice',
  label: 'Invoice',
  fields: {
    name: { type: 'text', label: 'Invoice Number' },
    status: { type: 'select', label: 'Status', options: [{ value: 'draft', label: 'Draft' }, { value: 'paid', label: 'Paid' }] },
    account: { type: 'lookup', label: 'Account', reference: 'showcase_account' },
    total: { type: 'currency', label: 'Total' },
  },
};

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

function clientReturning(def: any) {
  return { get: async (_type: string, _name: string) => def };
}

describe('page createSeed (record-page region seeding)', () => {
  const cfg = resolveResourceConfig('page');

  it('is registered on the page resource', () => {
    expect(typeof cfg.createSeed).toBe('function');
  });

  it('creates a record page slotted with no slots and no copied regions', async () => {
    const get = vi.fn(async () => objectDef);
    for (const kind of ['slotted', undefined]) {
      const seeded = await cfg.createSeed!({ type: 'record', object: 'showcase_invoice', kind }, { client: { get } });
      expect(seeded).toEqual({ kind: 'slotted' });
    }
    // The object is never read: nothing is synthesized to be copied.
    expect(get).not.toHaveBeenCalled();
  });

  it('saves a new record page as kind slotted with empty slots, a body the spec accepts', async () => {
    // The save path of `ResourceEditPage` in create mode: the spec create seed
    // under the author's draft (whose `kind` the `page-kind` derive set), then
    // the async seed on top.
    const draft = { label: 'Invoice page', name: 'invoice_page', type: 'record', object: 'showcase_invoice', kind: 'slotted' };
    const specSeed = getMetadataCreateSeed('page') as Record<string, unknown>;
    expect(specSeed.kind).toBe('full'); // the seed alone would make a full page
    const body = {
      ...buildCreateModeBody(cfg, draft, specSeed),
      ...(await cfg.createSeed!(draft, { client: clientReturning(objectDef) })),
    } as Record<string, unknown>;
    expect(body.kind).toBe('slotted');
    expect(body.slots).toBeUndefined();
    expect(body.regions).toEqual([]);
    const parsed = PageSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('copies the synthesized regions when the author explicitly creates a full record page', async () => {
    const seeded = await cfg.createSeed!({ type: 'record', object: 'showcase_invoice', kind: 'full' }, { client: clientReturning(objectDef) });
    expect(Array.isArray((seeded as any).regions)).toBe(true);
    expect((seeded as any).regions.length).toBeGreaterThan(0);
    expect((seeded as any).kind).toBeUndefined();
    // The copied regions are authored metadata the console's own page check accepts.
    const body = { name: 'invoice_full', label: 'Invoice', type: 'record', object: 'showcase_invoice', kind: 'full', ...(seeded as object) };
    const verdict = await validateMetadataDraft('page', body, undefined, { mode: 'edit' });
    expect(verdict.issues, JSON.stringify(verdict.issues.slice(0, 3))).toEqual([]);
    const blocks = blockPropsVerdict((seeded as any).regions);
    expect(blocks.detailsJudged).toBeGreaterThan(0);
    expect(blocks.refused).toEqual([]);
  });

  it('derives the create form kind from the page type (record → slotted, else full)', () => {
    expect(cfg.createDerive).toContainEqual({ from: 'type', to: 'kind', transform: 'page-kind', untilUserEdits: true });
    expect(applyTransform('page-kind', 'record')).toBe('slotted');
    for (const type of ['list', 'app', 'home', 'utility', undefined]) {
      expect(applyTransform('page-kind', type)).toBe('full');
    }
  });

  it('returns {} for a non-record page (no object binding to synth from)', async () => {
    const seeded = await cfg.createSeed!({ type: 'app', object: 'showcase_invoice' }, { client: clientReturning(objectDef) });
    expect(seeded).toEqual({});
  });

});

/**
 * objectstack#32478 — an explicit `full` record page that cannot start as a copy
 * of the default page's regions starts `slotted` instead: the same default page
 * on the day it is created, and a body the save door accepts.
 *
 * The four paths had no regions to seed — no object chosen, an object read that
 * comes back empty, a synthesized page that places no component, and a read
 * that fails — and seeded nothing, so the draft's `kind: 'full'` saved with the
 * create defaults' empty `regions`. The spec refuses that body at `regions`
 * (`checkPageRecordPlacesComponent`), so each save answered 422. Each path is
 * pinned on the body `ResourceEditPage` saves in create mode, judged by the
 * spec's own `PageSchema`, beside the body the path saved before, which the
 * spec still refuses.
 */
describe('page createSeed — a full record page with nothing to copy starts slotted (objectstack#32478)', () => {
  const cfg = resolveResourceConfig('page');
  const failing = { get: async () => { throw new Error('boom'); } };
  const draft = (extra: Record<string, unknown>) =>
    ({ label: 'Invoice page', name: 'invoice_page', type: 'record', kind: 'full', ...extra });

  /** The save path of `ResourceEditPage` in create mode, with the seed it applied. */
  async function createBody(d: Record<string, unknown>, client: { get: (type: string, name: string) => Promise<unknown> }) {
    const seed = await cfg.createSeed!(d, { client });
    const body = { ...buildCreateModeBody(cfg, d, getMetadataCreateSeed('page') as Record<string, unknown>), ...seed } as Record<string, unknown>;
    return { seed, body };
  }

  const refusedAtRegions = (body: unknown) => {
    const r = PageSchema.safeParse(body);
    return !r.success && r.error.issues.some((i) => i.code === 'custom' && i.path.join('.') === 'regions');
  };

  it.each([
    ['no object is chosen', draft({}), clientReturning(objectDef)],
    ['the object read comes back empty', draft({ object: 'showcase_invoice' }), clientReturning(null)],
    ['the object read fails (the seed stays best-effort)', draft({ object: 'showcase_invoice' }), failing],
  ])('%s: the seed is `kind: slotted`, and the body saves', async (_label, d, client) => {
    const { seed, body } = await createBody(d, client);
    expect(seed).toEqual({ kind: 'slotted' });
    const parsed = PageSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    // The body this path saved before, with the draft's `full` kind: refused at `regions`.
    expect(refusedAtRegions({ ...body, kind: 'full' })).toBe(true);
  });

  it.each([
    ['no `regions`', {}],
    ['a region that places nothing', { regions: [{ name: 'main', components: [] }], template: 'default' }],
  ])('a synthesized page with %s: the seed is `kind: slotted`, not the regions, and the body saves', async (_label, synthesized) => {
    synth.returns = synthesized;
    try {
      const { seed, body } = await createBody(draft({ object: 'showcase_invoice' }), clientReturning(objectDef));
      expect(seed).toEqual({ kind: 'slotted' });
      const parsed = PageSchema.safeParse(body);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      // What this path seeded before: the synthesized regions (or none) under `full`.
      const { kind: _kind, ...before } = body;
      expect(refusedAtRegions({ ...before, kind: 'full', ...synthesized })).toBe(true);
    } finally {
      synth.returns = undefined;
    }
  });

  it('CONTROL: a synthesized page that places components is copied as before, and the full body saves', async () => {
    const { seed, body } = await createBody(draft({ object: 'showcase_invoice' }), clientReturning(objectDef));
    expect((seed as { kind?: unknown }).kind).toBeUndefined();
    expect(Array.isArray((seed as { regions?: unknown }).regions)).toBe(true);
    expect(body.kind).toBe('full');
    const parsed = PageSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});
