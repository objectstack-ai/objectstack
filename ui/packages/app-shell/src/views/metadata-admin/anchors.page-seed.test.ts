// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
// `createSeed` reaches the page synthesizer through a dynamic
// `await import('@object-ui/plugin-detail')` (anchors.ts), so the cold transform
// of that whole package graph is billed to whichever test first awaits the hook
// — inside the test body, against the 15s `testTimeout`. The `unit` project runs
// `isolate: false`, so whether the module is already warm depends on what else
// the worker happened to run first; when it wasn't, the seeding test blew the
// budget. (It surfaced as a timeout rather than a wrong result because
// `createSeed` swallows failures and returns `{}`.)
//
// Importing it here moves that cost into the file's import phase, which no test
// or hook timeout applies to, so it can never land inside a timed window again.
// Keep the specifier identical to the one in anchors.ts — ESM caches by resolved
// specifier, so this makes the hook's own dynamic import resolve immediately.
import '@object-ui/plugin-detail';
import { registerBuiltinAnchors } from './anchors';
import { resolveResourceConfig } from './registry';
import { applyTransform } from './createDerive';
import { buildCreateModeBody } from './createBody';
import { validateMetadataDraft } from './clientValidation';
import { getMetadataCreateSeed } from '@objectstack/spec/kernel';
import { PageSchema } from '@objectstack/spec/ui';

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

  it('returns {} for an explicit full record page when no object is chosen', async () => {
    const seeded = await cfg.createSeed!({ type: 'record', kind: 'full' }, { client: clientReturning(objectDef) });
    expect(seeded).toEqual({});
  });

  it('is best-effort — swallows a client/synth failure and returns {}', async () => {
    const failing = { get: async () => { throw new Error('boom'); } };
    const seeded = await cfg.createSeed!({ type: 'record', object: 'showcase_invoice', kind: 'full' }, { client: failing });
    expect(seeded).toEqual({});
  });
});
