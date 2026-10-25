// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
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

/**
 * #1541 — the `page` resource's `createSeed` hook seeds a record page's regions
 * from the bound object's synthesized default detail page, so authoring starts
 * from the auto-generated layout instead of a blank canvas.
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

  it('seeds regions from the bound object default for a record page', async () => {
    const seeded = await cfg.createSeed!({ type: 'record', object: 'showcase_invoice' }, { client: clientReturning(objectDef) });
    expect(Array.isArray((seeded as any).regions)).toBe(true);
    expect((seeded as any).regions.length).toBeGreaterThan(0);
  });

  it('returns {} for a non-record page (no object binding to synth from)', async () => {
    const seeded = await cfg.createSeed!({ type: 'app', object: 'showcase_invoice' }, { client: clientReturning(objectDef) });
    expect(seeded).toEqual({});
  });

  it('returns {} when no object is chosen', async () => {
    const seeded = await cfg.createSeed!({ type: 'record' }, { client: clientReturning(objectDef) });
    expect(seeded).toEqual({});
  });

  it('is best-effort — swallows a client/synth failure and returns {}', async () => {
    const failing = { get: async () => { throw new Error('boom'); } };
    const seeded = await cfg.createSeed!({ type: 'record', object: 'showcase_invoice' }, { client: failing });
    expect(seeded).toEqual({});
  });
});
