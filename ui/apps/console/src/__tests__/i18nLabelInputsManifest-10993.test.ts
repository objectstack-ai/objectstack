/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The registry half of the `I18nLabel` family, batch 2, through the manifest's
 * PUBLIC door (objectui#10993).
 *
 * `@objectstack/spec` types these members as `I18nLabel` (a plain string or an
 * inline per-locale map), and each block's renderer already resolves the map:
 *
 *   - `object-metric`: `label`, `description` and `title`
 *     (`ObjectMetric.i18nLabel-10993.test.tsx` in `plugin-dashboard` pins the
 *     render);
 *   - `object-grid`: `label` (`ObjectGrid.labelI18nLabel-10993.test.tsx` in
 *     `plugin-grid`), and `description` since objectui#11227 published it at
 *     `@objectstack/spec` 17.6.0 (`ObjectGrid.declaredKeys-11068.test.tsx`).
 *     `view:grid` registers the same inputs, so its declaration carries the same
 *     two arms, but it is not in the public manifest, so it has no row here: this
 *     door does not reach it;
 *   - `record:related_list`: `title`
 *     (`record-related-list.titleI18nLabel-10993.test.tsx` in `plugin-detail`).
 *
 * Each input declared `'string'` only, so `validateTree` reported
 * `type-mismatch` on a legal map: the manifest gate contradicting the spec row
 * and the renderer on the same write. Each now declares both arms,
 * `['string', 'object']`, as the `ComponentInput` docblock asks of a key whose
 * render site resolves the map; batch 1 did the same for `object-form`
 * (`objectFormI18nLabelManifest.test.ts`).
 *
 * The door is the production one, `ComponentRegistry.getPublicConfigs()` →
 * `manifestFromConfigs` → `validateTree`.
 */
import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import type { Diagnostic, SchemaElement } from '@object-ui/sdui-parser';
import '@object-ui/components';
import '../register-plugins';

const manifest = manifestFromConfigs(
  ComponentRegistry.getPublicConfigs() as unknown as Parameters<typeof manifestFromConfigs>[0],
);

/** Each block, a minimal node the gate reads as clean, and its `I18nLabel` inputs. */
const BLOCKS: ReadonlyArray<{ block: string; base: Record<string, unknown>; keys: readonly string[] }> = [
  { block: 'object-metric', base: { objectName: 'deal' }, keys: ['label', 'description', 'title'] },
  { block: 'object-grid', base: { objectName: 'account' }, keys: ['label', 'description'] },
  {
    block: 'record:related_list',
    base: { objectName: 'task', relationshipField: 'account_id', columns: ['name'] },
    keys: ['title'],
  },
];

const ROWS = BLOCKS.flatMap(({ block, base, keys }) => keys.map((key) => ({ id: `${block}.${key}`, block, base, key })));

/** `en` first, as in the render pins. */
const MAP = { en: 'Pipeline', 'zh-CN': '销售管道' };

const diagnose = (block: string, props: Record<string, unknown>): Diagnostic[] =>
  validateTree({ type: block, ...props } as unknown as SchemaElement, manifest).diagnostics;

/** The `type-mismatch` diagnostics that name one prop. */
const mismatchesOn = (block: string, props: Record<string, unknown>, key: string): Diagnostic[] =>
  diagnose(block, props).filter((d) => d.code === 'type-mismatch' && d.message.includes(key));

describe('the I18nLabel registry half at the manifest public door (objectui#10993, batch 2)', () => {
  it.each(BLOCKS)('`$block` is in the public manifest, and a minimal node is clean', ({ block, base }) => {
    // Reachability before absence: an unknown block would satisfy every
    // "no type-mismatch" row below with `unknown-component` instead.
    expect(manifest.components[block], `${block} is not in the public manifest`).toBeDefined();
    expect(diagnose(block, base)).toEqual([]);
  });

  it.each(ROWS)('`$id` declares the string arm and the locale-map arm', ({ block, key }) => {
    const input = manifest.components[block].inputs.find((i) => i.name === key);
    expect(input, `${block}.${key} is not a declared input`).toBeDefined();
    const arms = Array.isArray(input?.type) ? [...input.type].sort() : [input?.type];
    expect(arms).toEqual(['object', 'string']);
  });

  it.each(ROWS)('a locale map on `$id` is not reported', ({ block, base, key }) => {
    expect(mismatchesOn(block, { ...base, [key]: MAP }, key)).toEqual([]);
  });

  it.each(ROWS)('CONTROL: a plain string on `$id` is not reported', ({ block, base, key }) => {
    expect(mismatchesOn(block, { ...base, [key]: 'Pipeline' }, key)).toEqual([]);
  });

  it.each(ROWS)('CONTROL: a value matching neither arm on `$id` is still reported', ({ block, base, key }) => {
    // The union is not a way out of the gate: a number is neither a string nor
    // a map, and must still be a `type-mismatch`.
    expect(mismatchesOn(block, { ...base, [key]: 42 }, key)).toHaveLength(1);
  });
});
