// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins the resolution rules behind the reference docs' import examples (#4570)
 * and the ratchet that keeps a missing export loud.
 *
 * Both edges matter, and the negative control is the point: a schema whose type
 * alias does not exist must be EXCLUDED from the emitted `import type` line
 * (the docs stop advertising a dead import) AND must turn the gate red when it
 * is not already in the baseline. A rule that only did the first would fix the
 * symptom and hide the cause — which is the state #4570 describes, one layer up.
 */
import { describe, expect, it } from 'vitest';

import {
  evaluateBaseline,
  loadEntrySurfaces,
  resolveImports,
  resolveTypeName,
  resolveValueName,
} from './lib/docs-import-surface';

/**
 * A miniature `api-surface.json`. Each name is one real shape the spec carries:
 *
 *   Widget    — `export const WidgetSchema` + `export type Widget`  (healthy)
 *   Gadget    — `export const GadgetSchema`, NO type alias          (#4570)
 *   Flavor    — `export const Flavor = z.enum(…)` + `export type Flavor`
 *               (merged declaration; api-surface reports `type` only)
 *   Ghost     — documented by a page, exported by nothing
 */
const API_SURFACE = {
  '.': ['defineStack (function)'],
  './demo': [
    'Flavor (type)',
    'GadgetSchema (const)',
    'Widget (type)',
    'WidgetSchema (const)',
  ],
};

const surfaces = loadEntrySurfaces(API_SURFACE);
const demo = surfaces.get('demo')!;

describe('loadEntrySurfaces', () => {
  it('keys subpath entries by category and drops the root entry', () => {
    expect([...surfaces.keys()]).toEqual(['demo']);
  });

  it('rejects an unparseable surface line instead of silently emptying the surface', () => {
    // A format change in build-api-surface.ts must fail here, not degrade into
    // "no name is exported" — which would strip every import example at once.
    expect(() => loadEntrySurfaces({ './demo': ['Widget'] })).toThrow(/cannot parse entry/);
  });
});

describe('resolveValueName', () => {
  it('prefers the `<Name>Schema` const', () => {
    expect(resolveValueName('Widget', demo)).toBe('WidgetSchema');
  });

  it('falls back to the bare name for a merged const+type declaration', () => {
    // api-surface reports `Flavor (type)` — kindOf tests TypeAlias before
    // Variable — so value-ness cannot be read off the kind. Presence can.
    expect(resolveValueName('Flavor', demo)).toBe('Flavor');
  });

  it('returns null when the entry exports neither candidate', () => {
    expect(resolveValueName('Ghost', demo)).toBeNull();
  });
});

describe('resolveTypeName', () => {
  it('accepts a type alias', () => {
    expect(resolveTypeName('Widget', demo)).toBe('Widget');
  });

  it('rejects a const-only export — `import type { Gadget }` does not resolve', () => {
    expect(resolveTypeName('GadgetSchema', demo)).toBeNull();
    expect(resolveTypeName('Gadget', demo)).toBeNull();
  });
});

describe('resolveImports', () => {
  it('emits only names the entry point really exports', () => {
    const { valueNames, typeNames, exampleValue } = resolveImports(
      'demo',
      ['Widget', 'Gadget', 'Flavor'],
      surfaces,
    );

    expect(valueNames).toEqual(['WidgetSchema', 'GadgetSchema', 'Flavor']);
    // NEGATIVE CONTROL: `Gadget` has a schema but no type alias, so it must not
    // appear in the `import type` line the docs tell authors to copy.
    expect(typeNames).toEqual(['Widget', 'Flavor']);
    expect(typeNames).not.toContain('Gadget');
    expect(exampleValue).toBe('WidgetSchema');
  });

  it('reports one stable gap line per unresolvable name', () => {
    const { gaps } = resolveImports('demo', ['Widget', 'Gadget', 'Ghost'], surfaces);
    expect(gaps.sort()).toEqual([
      'demo/Gadget — no type export',
      'demo/Ghost — no schema const export',
      'demo/Ghost — no type export',
    ]);
  });

  it('emits nothing when the category is not a published entry point', () => {
    const result = resolveImports('nowhere', ['Widget'], surfaces);
    expect(result.valueNames).toEqual([]);
    expect(result.typeNames).toEqual([]);
    expect(result.gaps).toEqual(['nowhere/* — no such entry point']);
  });
});

describe('evaluateBaseline', () => {
  const baseline = ['demo/Gadget — no type export'];

  it('is green while the known gaps are exactly the baselined ones', () => {
    expect(evaluateBaseline(['demo/Gadget — no type export'], baseline)).toEqual({
      fresh: [],
      stale: [],
    });
  });

  it('goes RED when a schema loses its type alias — the #4539 scenario', () => {
    // Deleting a zero-consumer `export type Widget` while `WidgetSchema` keeps
    // its reference page is exactly what shipped a dead import example before.
    const afterAliasRemoval = loadEntrySurfaces({
      './demo': ['GadgetSchema (const)', 'WidgetSchema (const)'],
    });
    const { gaps, typeNames } = resolveImports('demo', ['Widget', 'Gadget'], afterAliasRemoval);

    expect(typeNames).toEqual([]);
    const verdict = evaluateBaseline(gaps, baseline);
    expect(verdict.fresh).toContain('demo/Widget — no type export');
    expect(verdict.fresh.length).toBeGreaterThan(0);
  });

  it('goes RED on a stale baseline entry, so the ratchet can only shrink', () => {
    expect(evaluateBaseline([], baseline)).toEqual({
      fresh: [],
      stale: ['demo/Gadget — no type export'],
    });
  });
});
