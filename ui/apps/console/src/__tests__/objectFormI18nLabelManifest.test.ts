/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-form`'s seven `I18nLabel` members through the manifest's PUBLIC door
 * (objectui#10993).
 *
 * `@objectstack/spec` types `title`, `description`, `submitText`, `cancelText`,
 * `nextText`, `prevText` and `successMessage` as `I18nLabel`: a plain string or
 * an inline per-locale map. `ObjectForm` resolves a map against the active UI
 * language (`plugin-form`'s `ObjectForm.i18nLabels.test.tsx` pins the render),
 * so the registration declares both arms, `['string', 'object']`, as the
 * `ComponentInput` docblock asks of a key whose render site resolves the map.
 * While the seven declared only `'string'`, `validateTree` reported
 * `type-mismatch` on a legal map: the manifest gate contradicting the spec row
 * and the renderer on the same write.
 *
 * The door is the production one, `ComponentRegistry.getPublicConfigs()` →
 * `manifestFromConfigs` → `validateTree`, where the block's key is the bare
 * `object-form`, as in the sibling pin for `object-master-detail-form`
 * (`masterDetailFormI18nLabelManifest.test.ts`).
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

const BLOCK = 'object-form';
const LABELS = [
  'title',
  'description',
  'submitText',
  'cancelText',
  'nextText',
  'prevText',
  'successMessage',
] as const;

/** `en` first, as in the render pin. */
const MAP = { en: 'Save order', 'zh-CN': '保存订单' };

const diagnose = (props: Record<string, unknown>): Diagnostic[] =>
  validateTree(
    { type: BLOCK, objectName: 'order', ...props } as unknown as SchemaElement,
    manifest,
  ).diagnostics;

/** The `type-mismatch` diagnostics that name one prop. */
const mismatchesOn = (props: Record<string, unknown>, key: string): Diagnostic[] =>
  diagnose(props).filter((d) => d.code === 'type-mismatch' && d.message.includes(key));

describe('object-form — the I18nLabel members at the manifest public door (objectui#10993)', () => {
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
    expect(mismatchesOn({ [key]: 'Save order' }, key)).toEqual([]);
  });

  it.each(LABELS)('CONTROL: a value matching neither arm on `%s` is still reported', (key) => {
    // The union is not a way out of the gate: a number is neither a string nor
    // a map, and must still be a `type-mismatch`.
    expect(mismatchesOn({ [key]: 42 }, key)).toHaveLength(1);
  });
});
