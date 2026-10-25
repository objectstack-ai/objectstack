/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-master-detail-form.title`, `.submitText` and `.cancelText` through
 * the manifest's PUBLIC door (objectui#10935).
 *
 * `@objectstack/spec` types the three as `I18nLabel`: a plain string or an
 * inline per-locale map. `MasterDetailForm` resolves a map against the active
 * UI language (`MasterDetailForm.i18nLabels.test.tsx` pins the render), so the
 * registration declares both arms, `['string', 'object']`, as the
 * `ComponentInput` docblock asks of a key whose render site resolves the map.
 * While the three declared only `'string'`, `validateTree` reported
 * `type-mismatch` on a legal map: the manifest gate contradicting the spec row,
 * the validator and the renderer on the same write.
 *
 * The door is the production one, `ComponentRegistry.getPublicConfigs()` →
 * `manifestFromConfigs` → `validateTree`, where the block's key is the bare
 * `object-master-detail-form`. (`getAllConfigs()` keys it by its namespace,
 * `plugin-form:object-master-detail-form`, so a bare-typed node there reads as
 * `unknown-component` and every "no type-mismatch" row would pass vacuously.)
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

const BLOCK = 'object-master-detail-form';
const LABELS = ['title', 'submitText', 'cancelText'] as const;

/** `en` first, as in the render pin. */
const MAP = { en: 'Purchase order', 'zh-CN': '采购单' };

const diagnose = (props: Record<string, unknown>): Diagnostic[] =>
  validateTree(
    {
      type: BLOCK,
      objectName: 'po',
      details: [{ childObject: 'po_line', relationshipField: 'po' }],
      ...props,
    } as unknown as SchemaElement,
    manifest,
  ).diagnostics;

/** The `type-mismatch` diagnostics that name one prop. */
const mismatchesOn = (props: Record<string, unknown>, key: string): Diagnostic[] =>
  diagnose(props).filter((d) => d.code === 'type-mismatch' && d.message.includes(key));

describe('object-master-detail-form — the I18nLabel labels at the manifest public door (objectui#10935)', () => {
  it('the block is in the public manifest under its bare type, and a minimal node is clean', () => {
    // Reachability before absence: an unknown block would satisfy every
    // "no type-mismatch" row below with `unknown-component` instead.
    expect(manifest.components[BLOCK], `${BLOCK} is not in the public manifest`).toBeDefined();
    expect(diagnose({})).toEqual([]);
  });

  it.each(LABELS)('`%s` declares the string arm and the locale-map arm', (key) => {
    const input = manifest.components[BLOCK].inputs.find((i) => i.name === key);
    expect(input, `${key} is not a declared input`).toBeDefined();
    const arms = Array.isArray(input?.type) ? [...input.type].sort() : [input?.type];
    expect(arms).toEqual(['object', 'string']);
  });

  it.each(LABELS)('a locale map on `%s` is not reported', (key) => {
    expect(mismatchesOn({ [key]: MAP }, key)).toEqual([]);
  });

  it.each(LABELS)('CONTROL: a plain string on `%s` is not reported', (key) => {
    expect(mismatchesOn({ [key]: 'Purchase order' }, key)).toEqual([]);
  });

  it.each(LABELS)('CONTROL: a value matching neither arm on `%s` is still reported', (key) => {
    // The union is not a way out of the gate: a number is neither a string nor
    // a map, and must still be a `type-mismatch`.
    expect(mismatchesOn({ [key]: 42 }, key)).toHaveLength(1);
  });
});
