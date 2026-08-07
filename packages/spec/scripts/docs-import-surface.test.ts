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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  evaluateBaseline,
  IMPORT_BASELINE_COMMENT,
  loadEntrySurfaces,
  resolveImports,
  resolveTypeName,
  resolveValueName,
  serializeImportBaseline,
} from './lib/docs-import-surface';
import { API_SURFACE_DIR_NAME, LEGACY_MONOLITH_NAMES } from './lib/sharded-artifacts';

const SPEC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(SPEC_DIR, 'docs-import-surface.baseline.json');

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

/**
 * The committed file's BYTES, pinned against the one function that writes them
 * (#5990).
 *
 * Everything above judges the baseline's *content* after `JSON.parse`, which is
 * also all the `check:docs` ratchet judges — and that is why nothing noticed
 * that `--update-import-baseline` emitted raw characters while the committed
 * file carried `\uXXXX` escapes. Both encodings parse to identical entries, so
 * the gate stayed green while every run of the command rewrote all 136 entry
 * lines. The cost landed on review, not on CI: a shrink-only ratchet is
 * designed so that a change to it is CONSPICUOUS, and 136 lines of encoding
 * flip is precisely how a 1-line decision stops being conspicuous.
 *
 * These cases close it from the side the content assertions cannot see. They
 * need no build and no `json-schema/` tree: the file is re-serialized from its
 * OWN parsed entries, so what is being compared is encoding, not gap analysis.
 */
describe('docs-import-surface.baseline.json bytes', () => {
  const bytes = fs.readFileSync(BASELINE_PATH, 'utf-8');
  const parsed = JSON.parse(bytes) as { _comment?: string; entries?: string[] };

  it('carries the current comment — a stale one cannot sit there silently', () => {
    // Asserted BEFORE the whole-file comparison so the failure names the cause.
    // No gate compares `_comment` (`entries` is the criterion), which is how
    // #6069 could rename `api-surface.json` to `api-surface/` in the source
    // constant and leave the committed file pointing at a path that no longer
    // exists. It was a deliberate handoff, not an oversight — re-running the
    // writer to fix one prose line cost 137 lines of encoding churn. With the
    // encodings unified that re-run is a 1-line diff, so the drift is now worth
    // failing on.
    expect(parsed._comment).toBe(IMPORT_BASELINE_COMMENT);
  });

  it('is byte-identical to what --update-import-baseline would write', () => {
    // The round trip is the whole pin: writer and file share one serializer, so
    // they can no longer hold two encodings. Indentation, key order and the
    // trailing newline ride along for free.
    expect(bytes).toBe(serializeImportBaseline(parsed.entries ?? []));
  });

  it('spells non-ASCII as raw characters, like every other JSON in the repo', () => {
    // The negative control, and the direction that actually regressed. Measured
    // on the fix's base commit: of 305 tracked `.json` files, 151 carry
    // non-ASCII and this was the only one that escaped it. Re-introducing an
    // ASCII-escaping wrapper on either side turns this red instead of turning
    // the next reviewer's diff into 136 lines of noise.
    expect(bytes).not.toMatch(/\\u[0-9a-fA-F]{4}/);
    expect(bytes).toContain('—');
    expect(serializeImportBaseline(['demo/Gadget — no type export'])).toContain('—');
    expect(serializeImportBaseline(['demo/Gadget — no type export'])).not.toMatch(/\\u[0-9a-fA-F]{4}/);
  });

  it('points regenerators at the sharded api-surface, not the retired monolith', () => {
    // Names the drift #6069 left behind, from the module that owns both
    // spellings — so a future re-shard of `api-surface/` cannot quietly leave
    // this prose describing a layout the repo no longer has.
    expect(IMPORT_BASELINE_COMMENT).toContain(`${API_SURFACE_DIR_NAME}/`);
    expect(IMPORT_BASELINE_COMMENT).not.toContain(LEGACY_MONOLITH_NAMES[API_SURFACE_DIR_NAME]);
  });
});
