/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `bind` and `hidden` are base props of the tier (objectui#11008).
 *
 * `BaseSchema` (`@object-ui/types`) declares both for every node, and no
 * registration declares either as an input. Before they joined `BASE_PROPS`,
 * the undeclared-key branch answered every authored one with `unknown-prop`
 * ("has no prop"), including on the nodes that honour it: `SchemaRenderer`
 * reads `hidden` for every node, and every `useDataScope` renderer reads
 * `bind`. This file pins the TIER's reading of a manifest; the live-registry
 * half — `list`, `tree-view` and `data-table` — is
 * `packages/components/src/renderers/__tests__/bind-base-prop-parser-tier-11008.test.tsx`.
 *
 * Three facts, kept apart because each one fails differently:
 *
 *   - both keys draw nothing, in every value shape `BaseSchema` admits for
 *     them — the fix;
 *   - a near-miss spelling (`bindTo`, `hide`) on the SAME node still draws
 *     `unknown-prop` naming it — the lit control. Without it, "draws nothing"
 *     would also pass against a tier that stopped warning on undeclared keys;
 *   - a registration that DECLARES `placeholder` keeps its `type-mismatch`.
 *     `placeholder` is a `BaseSchema` member too, and it was left out of the
 *     `every-node` members because they skip the declared-input lookup. It
 *     joined later as a `where-undeclared` member (objectui#11044), which a
 *     declared input outranks: this row goes red if it is ever made an
 *     `every-node` member the way `bind` and `hidden` were.
 */
import { describe, expect, it } from 'vitest';
import { manifestFromConfigs, validateTree } from '../index.js';
import type { Diagnostic, Manifest, SchemaElement } from '../types.js';

const manifest: Manifest = manifestFromConfigs([
  // a leaf that declares neither key, as no live registration does
  { type: 'leaf', namespace: 'ui', inputs: [{ name: 'content', type: 'string' }] },
  // the input-family shape: `placeholder` declared as a typed input
  { type: 'field', namespace: 'ui', inputs: [{ name: 'placeholder', type: 'string' }] },
] as unknown as Parameters<typeof manifestFromConfigs>[0]);

const diagnose = (node: unknown): Diagnostic[] =>
  validateTree(node as SchemaElement, manifest).diagnostics;

const LEAF = { type: 'leaf', content: 'x' };

/** Every value shape `BaseSchema` declares for the two keys. */
const BASE_VALUES: Record<'bind' | 'hidden', unknown[]> = {
  bind: ['users', 'app.settings.users'],
  hidden: [true, false, '${data.role !== "admin"}', { dialect: 'cel', source: "record.status == 'draft'" }],
};

describe('objectui#11008 — `bind` and `hidden` are base props of the parser tier', () => {
  it('the control node draws nothing', () => {
    expect(diagnose(LEAF)).toEqual([]);
  });

  it.each(Object.keys(BASE_VALUES) as Array<keyof typeof BASE_VALUES>)(
    '`%s` draws no diagnostic, in every value shape BaseSchema admits',
    (key) => {
      const drew = BASE_VALUES[key]
        .map((value) => [value, diagnose({ ...LEAF, [key]: value })] as const)
        .filter(([, found]) => found.length > 0)
        .map(([value, found]) => `${JSON.stringify(value)} → ${JSON.stringify(found.map((d) => d.code))}`);
      expect(drew).toEqual([]);
    },
  );

  it.each([
    ['bindTo', 'users'],
    ['hide', true],
  ] as const)('lit control: the near-miss `%s` still draws one `unknown-prop` naming it', (key, value) => {
    const found = diagnose({ ...LEAF, [key]: value });
    expect(found.map((d) => d.code)).toEqual(['unknown-prop']);
    expect(found[0]!.message).toContain(`"${key}"`);
  });

  it('a registration that declares `placeholder` keeps its type check — why `placeholder` is not `every-node`', () => {
    expect(diagnose({ type: 'field', placeholder: 'Search…' })).toEqual([]);
    const found = diagnose({ type: 'field', placeholder: 42 });
    expect(found.map((d) => d.code)).toEqual(['type-mismatch']);
    expect(found[0]!.message).toContain('"placeholder"');
  });
});
