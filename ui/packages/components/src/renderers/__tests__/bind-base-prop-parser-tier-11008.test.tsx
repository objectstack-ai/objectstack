/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The parser tier's answer to `bind` and `hidden`, held on the live registry
 * (objectui#11008).
 *
 * `BaseSchema` declares both keys for every node. Until objectui#11008,
 * `validateTree` (`@object-ui/sdui-parser`) did not count either among its base
 * props and no registration declares either as an input, so the undeclared-key
 * branch answered every authored one with `unknown-prop` — on `list` and
 * `tree-view` too, whose renderers read `bind` through `useDataScope`, and on
 * every node for `hidden`, which `SchemaRenderer`'s hide chain reads for all of
 * them. Both are base props now.
 *
 * That moves one published sentence. `data-table` does NOT read `bind`
 * (objectui#6575's ruling: it must not start), and the `BaseSchema.bind`
 * docblock used to say that both a render-time console warning and the parser
 * tier's `unknown-prop` named such a `bind`. The parser half is gone: this file
 * pins that `data-table` + `bind` now draws nothing here, and the docblock says
 * the console warning is the one signal. That warning is pinned by
 * `packages/components/src/__tests__/skill-guide-data-table-binding.test.tsx`.
 *
 * The manifest is built the way `header-bar-unknown-prop-parser-tier-10981.test.tsx`
 * builds it — every KNOWN registry key of this package, through
 * `manifestFromConfigs` — so a registration that starts declaring either key
 * as an input turns the first test red, and a parser change that takes either
 * key back out of the base props turns the rest red.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import type { Diagnostic, SchemaElement } from '@object-ui/sdui-parser';

// Module scope, not a hook: this import IS the registration (AGENTS.md
// §测试纪律 — an unbounded module load must not be billed to a bounded window).
import '../index';

/** Every live registry key, as `header-bar-unknown-prop-parser-tier-10981.test.tsx` builds it. */
const diagnose = (schema: unknown): Diagnostic[] => {
  const configs = ComponentRegistry.getKnownTypes().map((t) => {
    const meta = ComponentRegistry.getMeta(t);
    return { type: t, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
  });
  const manifest = manifestFromConfigs(configs as unknown as Parameters<typeof manifestFromConfigs>[0]);
  return validateTree(schema as SchemaElement, manifest).diagnostics;
};

const KEYS = { bind: 'users', hidden: true } as const;

/** Valid nodes: each draws nothing on its own, so any diagnostic below is the key's. */
const READERS = {
  list: { type: 'list', items: ['Ada', 'Grace'] },
  'tree-view': { type: 'tree-view', nodes: [{ id: 'a', label: 'A' }] },
} as const;
const DATA_TABLE = {
  type: 'data-table',
  columns: [{ header: 'Name', accessorKey: 'name' }],
  data: [{ name: 'Ada' }],
} as const;

describe('`bind` and `hidden` are base props of the parser tier (objectui#11008)', () => {
  it('no live registration declares either key as an input', () => {
    const types = ComponentRegistry.getKnownTypes();
    // Non-vacuity: the registry this file judges is populated, and holds the three nodes below.
    for (const type of [...Object.keys(READERS), 'data-table']) expect(types).toContain(type);
    const declaring = types.flatMap((type) =>
      (ComponentRegistry.getMeta(type)?.inputs ?? [])
        .filter((input) => input.name in KEYS)
        .map((input) => `${type}.${input.name}`),
    );
    expect(declaring).toEqual([]);
  });

  it.each(Object.keys(READERS) as Array<keyof typeof READERS>)(
    '`%s` — a `bind` its renderer reads, and a `hidden`, draw nothing',
    (type) => {
      const node = READERS[type];
      expect(diagnose(node)).toEqual([]);
      for (const [key, value] of Object.entries(KEYS)) {
        expect(diagnose({ ...node, [key]: value }), key).toEqual([]);
      }
    },
  );

  it('`data-table` + `bind` draws nothing here — its render-time console warning is the one signal', () => {
    expect(diagnose(DATA_TABLE)).toEqual([]);
    expect(diagnose({ ...DATA_TABLE, bind: 'customers' })).toEqual([]);
    expect(diagnose({ ...DATA_TABLE, hidden: true })).toEqual([]);
  });

  it('lit control: an undeclared near-miss on `data-table` still draws `unknown-prop` naming it', () => {
    const found = diagnose({ ...DATA_TABLE, bindTo: 'customers' });
    expect(found.map((d) => d.code)).toEqual(['unknown-prop']);
    expect(found[0]!.message).toContain('"bindTo"');
  });

  it('across every live registration, neither key draws a diagnostic naming it', () => {
    const types = ComponentRegistry.getKnownTypes();
    expect(types.length).toBeGreaterThan(0);
    const named = types.flatMap((type) =>
      Object.entries(KEYS).flatMap(([key, value]) =>
        diagnose({ type, [key]: value })
          .filter((d) => d.message.includes(`"${key}"`))
          .map((d) => `${type}.${key} → ${d.code}`),
      ),
    );
    expect(named).toEqual([]);
  });
});
