/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `validateTree` descends the node slots a component's manifest entry carries
 * (objectui#11170), and `manifestFromConfigs` projects them from the one
 * declaration it is handed through `slotsFor`.
 *
 * The subject under every slot is a tag the manifest does not know, so what
 * each case measures is REACH: `unknown-component` on the same node, drawn or
 * not drawn, decided by whether its position is a declared slot. The
 * declaration used here is a stand-in with the real grammar — this package
 * imports nothing at runtime — and the components-side census for the same
 * card holds this walk and `@object-ui/types`' `nodeSlotValues` to one answer
 * over the live declaration.
 */
import { describe, expect, it } from 'vitest';
import { manifestFromConfigs, validateTree } from '../index.js';
import type { Diagnostic, SchemaElement } from '../types.js';

const SLOTS: Record<string, { path: string; retired?: boolean }[]> = {
  dialog: [{ path: 'trigger' }, { path: 'content' }, { path: 'footer' }],
  tabs: [{ path: 'items[].content' }],
  carousel: [{ path: 'items[]' }],
  'report-viewer': [{ path: 'report.sections[].content' }],
  'page:card': [{ path: 'footer' }, { path: 'body', retired: true }],
};
const slotsFor = (type: string) => SLOTS[type] ?? [];

const CONFIGS = [
  { type: 'dialog', namespace: 'ui', inputs: [{ name: 'trigger', type: 'slot' }, { name: 'content', type: 'slot' }, { name: 'footer', type: 'slot' }] },
  { type: 'tabs', namespace: 'ui', inputs: [{ name: 'items', type: 'array' }] },
  { type: 'carousel', namespace: 'ui', inputs: [{ name: 'items', type: 'array' }] },
  { type: 'report-viewer', namespace: 'plugin-report', inputs: [{ name: 'report', type: 'code' }] },
  { type: 'page:card', namespace: 'page', inputs: [{ name: 'children', type: 'slot' }, { name: 'footer', type: 'slot' }] },
  { type: 'text', namespace: 'ui', inputs: [{ name: 'content', type: 'string' }] },
] as unknown as Parameters<typeof manifestFromConfigs>[0];

const withSlots = manifestFromConfigs(CONFIGS, { slotsFor });
const withoutSlots = manifestFromConfigs(CONFIGS);

const UNKNOWN = { type: 'nope-11170' };
const codes = (node: unknown, manifest = withSlots): string[] =>
  validateTree(node as SchemaElement, manifest).diagnostics.map((d: Diagnostic) => d.code);
const unknownCount = (node: unknown, manifest = withSlots) =>
  codes(node, manifest).filter((c) => c === 'unknown-component').length;

describe('manifestFromConfigs projects the declaration it is handed (objectui#11170)', () => {
  it('carries each entry’s non-retired slot paths, and no key at all without the option', () => {
    expect(withSlots.components['dialog']!.slots).toEqual(['trigger', 'content', 'footer']);
    expect(withSlots.components['tabs']!.slots).toEqual(['items[].content']);
    // The retired `body` is left out of the authoring tier's projection.
    expect(withSlots.components['page:card']!.slots).toEqual(['footer']);
    // An entry with no slots publishes none (`undefined`, which `JSON.stringify`
    // drops — the same contract `tier` and `of` keep), so the serialised entry
    // is byte-identical to one built before the key existed.
    expect(withSlots.components['text']!.slots).toBeUndefined();
    expect(JSON.stringify(withSlots.components['text'])).toBe(JSON.stringify(withoutSlots.components['text']));
    expect(JSON.stringify(withoutSlots)).not.toContain('"slots"');
  });
});

describe('validateTree reaches slot-held nodes exactly where the entry declares a slot', () => {
  it('a direct slot, one node or a list', () => {
    expect(unknownCount({ type: 'dialog', content: UNKNOWN })).toBe(1);
    expect(unknownCount({ type: 'dialog', content: [{ type: 'text' }, UNKNOWN], footer: UNKNOWN })).toBe(2);
    // The same node under an undeclared key is not reached.
    expect(unknownCount({ type: 'dialog', header: UNKNOWN })).toBe(0);
  });

  it('a panel list and a trailing `[]`', () => {
    expect(unknownCount({ type: 'tabs', items: [{ value: 'a', content: UNKNOWN }, { value: 'b', content: [UNKNOWN, UNKNOWN] }] })).toBe(3);
    expect(unknownCount({ type: 'carousel', items: [UNKNOWN, [UNKNOWN]] })).toBe(2);
    expect(unknownCount({ type: 'report-viewer', report: { sections: [{ content: UNKNOWN }] } })).toBe(1);
  });

  it('nested: a slot under a child under a slot', () => {
    const doc = { type: 'dialog', content: { type: 'tabs', items: [{ value: 'a', content: UNKNOWN }] } };
    expect(unknownCount(doc)).toBe(1);
  });

  it('a retired position is not walked by this tier; its refusal by name stands (objectui#6771)', () => {
    const diagnostics = validateTree({ type: 'page:card', body: [UNKNOWN] } as unknown as SchemaElement, withSlots).diagnostics;
    expect(diagnostics.filter((d) => d.code === 'unknown-component')).toEqual([]);
    expect(diagnostics.map((d) => d.code)).toContain('unknown-prop');
    expect(diagnostics.find((d) => d.code === 'unknown-prop')?.message).toContain('retired by objectui#6771');
  });

  it('a manifest without slots walks `children` alone — the pre-11170 reach, unchanged', () => {
    expect(unknownCount({ type: 'dialog', content: UNKNOWN }, withoutSlots)).toBe(0);
    expect(unknownCount({ type: 'dialog', children: [UNKNOWN] }, withoutSlots)).toBe(1);
  });

  it('an unknown component’s own slots are not consulted: one diagnostic, on it', () => {
    expect(codes({ type: 'nope-outer', content: UNKNOWN })).toEqual(['unknown-component']);
  });

  it('a string in a slot is legal and draws nothing', () => {
    expect(codes({ type: 'dialog', trigger: 'Open', content: ['plain', { type: 'text' }] })).toEqual([]);
  });
});
