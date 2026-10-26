// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13459 — the designer forms' spec derivations fail LOUDLY.
 *
 * The five `*-schema.ts` modules derive their JSONSchema from the bundled
 * `@objectstack/spec`. That input is fixed at build time, so a derivation that
 * fails is a build-time fact: this file goes red for it. At runtime the throw
 * reaches the route's error boundary instead of being caught, warned about and
 * turned into `undefined` — which used to render a designer form silently
 * missing fields.
 *
 * Two halves: every derivation succeeds against the bundled spec, and a
 * derivation that throws reaches the caller instead of becoming `undefined`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

const DERIVATIONS = [
  ['dashboard-schema', 'getDashboardSchema'],
  ['package-schema', 'getPackageSchema'],
  ['page-schema', 'getPageSchema'],
  ['report-schema', 'getReportSchema'],
  ['view-schema', 'getListVariantSchema'],
  ['view-schema', 'getFormVariantSchema'],
  ['view-schema', 'getListColumnSchema'],
] as const;

const LOADERS: Record<(typeof DERIVATIONS)[number][0], () => Promise<unknown>> = {
  'dashboard-schema': () => import('./dashboard-schema'),
  'package-schema': () => import('./package-schema'),
  'page-schema': () => import('./page-schema'),
  'report-schema': () => import('./report-schema'),
  'view-schema': () => import('./view-schema'),
};

/** A fresh module instance per case, so a memoised result cannot answer. */
async function derive(file: (typeof DERIVATIONS)[number][0], getter: string): Promise<unknown> {
  vi.resetModules();
  const mod = (await LOADERS[file]()) as Record<string, () => unknown>;
  return mod[getter]();
}

// `vi.doMock`, not a hoisted `vi.mock`: the failing `toJSONSchema` is scoped to
// the cases that ask for it, and undone after each, so it cannot reach another
// test file sharing this worker's module registry.
afterEach(() => {
  vi.doUnmock('zod');
  vi.resetModules();
});

describe('designer spec derivations (objectui#13459)', () => {
  it.each(DERIVATIONS)('%s.%s derives an object schema from the bundled spec', async (file, getter) => {
    const schema = (await derive(file, getter)) as { type?: unknown; properties?: unknown } | undefined;
    expect(schema).toBeDefined();
    expect(schema?.type).toBe('object');
    expect(schema?.properties).toBeTypeOf('object');
  });

  it.each(DERIVATIONS)('%s.%s throws when the derivation fails, never returns undefined', async (file, getter) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.doMock('zod', async (importOriginal) => {
      const actual = await importOriginal<typeof import('zod')>();
      const toJSONSchema = (): never => {
        throw new Error('derivation failed (test)');
      };
      return { ...actual, z: { ...actual.z, toJSONSchema } };
    });
    await expect(derive(file, getter)).rejects.toThrow('derivation failed (test)');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
