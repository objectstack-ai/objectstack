/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Containment is decided by the declared `children` slot input, and by
 * NOTHING else (objectui#9910, maintainer ruling 2026-09-24, Q1-A).
 *
 * ## The two facts this file separates
 *
 * `validateTree` used to read `comp.isContainer` for `not-a-container`. That
 * flag is hand-kept and it means LAYOUT containment (objectui#6804): the
 * react-page JSX scope skips it, and it was refused for a whole population of
 * registrations that DO render `children` (label / description fallbacks, the
 * sidebar chrome parts). After objectui#6771 converged those readers onto
 * `children`, the flag put a FALSE warning on the one key they read. The
 * ruling moved the declaration the tier reads to
 * `{ name: 'children', type: 'slot' }` in `inputs`.
 *
 * So the manifest here is a 2×2: flag × slot. Every cell is asserted, because
 * the two failure modes are OPPOSITE — a flag-only cell drawing nothing is the
 * silently re-introduced fallback, and a slot-only cell drawing the warning is
 * the objectui#9910 defect itself. The runtime half — that the slot is declared
 * exactly where a renderer really puts the list on the page — is held by
 * `packages/components/src/renderers/__tests__/container-declaration-ratchet.test.tsx`
 * against the live registry; this file pins the TIER's reading of a manifest.
 */
import { describe, expect, it } from 'vitest';
import { CHILD_LIST_KEY, acceptsChildren, manifestFromConfigs, validateTree } from '../index.js';
import type { Diagnostic, Manifest, SchemaElement } from '../types.js';

const CONTAINMENT = 'not-a-container';
const SLOT = { name: 'children', type: 'slot' } as const;

const manifest: Manifest = manifestFromConfigs([
  // flag, no slot — a layout container that renders `items[].children`, never
  // `schema.children` (the `page:tabs` shape)
  { type: 'flag-only', namespace: 'ui', isContainer: true, inputs: [{ name: 'items', type: 'array' }] },
  // slot, no flag — a label-fallback reader (the `button` / `badge` shape)
  { type: 'slot-only', namespace: 'ui', inputs: [{ name: 'label', type: 'string' }, SLOT] },
  // both — a layout container that renders the list (the `flex` shape)
  { type: 'both', namespace: 'ui', isContainer: true, inputs: [{ name: 'gap', type: 'number' }, SLOT] },
  // neither — a leaf
  { type: 'neither', namespace: 'ui', inputs: [{ name: 'content', type: 'string' }] },
  // the page kinds publish `children` typed `array`, not `slot` — the NAME is
  // the declaration, so this row must read as accepting children too
  { type: 'array-typed', namespace: 'ui', inputs: [{ name: 'children', type: 'array', of: 'object' }] },
  // the child every row nests, declared so it never draws `unknown-component`
  { type: 'text', namespace: 'ui', inputs: [{ name: 'content', type: 'string' }] },
] as unknown as Parameters<typeof manifestFromConfigs>[0]);

const CHILD = { type: 'text', content: 'measured' };
const codes = (node: unknown): string[] =>
  validateTree(node as SchemaElement, manifest).diagnostics.map((d: Diagnostic) => d.code);
const withChildren = (type: string) => ({ type, children: [CHILD] });

describe('objectui#9910 — the tier reads the declared `children` input, not the flag', () => {
  it('exports the key by name, and the predicate reads exactly that name', () => {
    expect(CHILD_LIST_KEY).toBe('children');
    expect(acceptsChildren({ inputs: [SLOT] })).toBe(true);
    expect(acceptsChildren({ inputs: [{ name: 'children', type: 'array' }] })).toBe(true);
    expect(acceptsChildren({ inputs: [{ name: 'body', type: 'slot' }] })).toBe(false);
    expect(acceptsChildren({ inputs: [] })).toBe(false);
  });

  it('⛔ the flag is NOT a fallback: flag without slot draws `not-a-container`', () => {
    // The hard line of the ruling. A registration that is a layout container
    // but renders no authored child list must keep warning — the diagnostic
    // on it is TRUE — and before objectui#9910 the flag silenced it.
    expect(codes(withChildren('flag-only'))).toContain(CONTAINMENT);
  });

  it('the slot alone is sufficient: slot without flag draws nothing', () => {
    // The objectui#9910 defect itself, gone: a `button`-shaped registration
    // keeps the flag off (so react pages keep injecting it) and is still not
    // warned on the one key it renders.
    expect(codes(withChildren('slot-only'))).toEqual([]);
  });

  it('both declared draws nothing; neither declared draws the warning', () => {
    expect(codes(withChildren('both'))).toEqual([]);
    expect(codes(withChildren('neither'))).toContain(CONTAINMENT);
  });

  it('an input NAMED `children` counts whatever its coarse type — the page kinds publish `array`', () => {
    expect(codes(withChildren('array-typed'))).toEqual([]);
  });

  it('a declared `children` slot is never type-checked or reported as a prop — the key is base', () => {
    // `children` is in `BASE_PROPS`, so the prop walk skips it before the
    // declared input is ever consulted: no `unknown-prop`, no `type-mismatch`,
    // whichever coarse type the declaration carries.
    for (const type of ['slot-only', 'both', 'array-typed', 'flag-only', 'neither']) {
      const found = codes(withChildren(type));
      expect(found.filter((c) => c === 'unknown-prop' || c === 'type-mismatch')).toEqual([]);
    }
    // …and the reachability control: the nested child resolved everywhere.
    for (const type of ['slot-only', 'both', 'array-typed', 'flag-only', 'neither']) {
      expect(codes(withChildren(type))).not.toContain('unknown-component');
    }
  });

  it('the retired `body` spelling follows the SAME predicate', () => {
    // `checkRetiredBodyDialect` is handed `acceptsChildren(comp)`, so the two
    // spellings cannot disagree about which components take a list.
    const under = (type: string) =>
      validateTree({ type, body: [CHILD] } as unknown as SchemaElement, manifest).diagnostics.filter((d) =>
        d.message.includes('"body"'),
      );
    // slot declared ⇒ the list would be accepted under `children`, so `body`
    // is answered as a retired key that names the replacement
    expect(under('slot-only').map((d) => d.code)).toEqual(['unknown-prop']);
    expect(under('slot-only')[0]!.message).toContain('"children"');
    // flag only ⇒ no list is accepted here, so `body` draws the containment
    // sentence — the flag does not rescue the retired spelling either
    expect(under('flag-only').map((d) => d.code)).toEqual([CONTAINMENT]);
    expect(under('neither').map((d) => d.code)).toEqual([CONTAINMENT]);
  });

  it('the manifest still CARRIES `isContainer` for the consumers that read layout containment', () => {
    // Q2-A keeps the field: `manifestFromConfigs` projects it unchanged, the
    // react-page scope builder and the public layout ledger read it, and this
    // tier ignores it. Asserted so a later "clean-up" that drops the projection
    // is a visible decision rather than a side effect.
    expect(manifest.components['flag-only']!.isContainer).toBe(true);
    expect(manifest.components['both']!.isContainer).toBe(true);
    expect(manifest.components['slot-only']!.isContainer).toBeUndefined();
  });
});
