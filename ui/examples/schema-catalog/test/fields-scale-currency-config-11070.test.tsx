/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `scale` and currency catalog examples parse on the strict authoring
 * face, and the currency examples declare their currency the spec's way —
 * objectui#11070 round 13.
 *
 * At the round's base `StrictAnyComponentSchema` refused all five documents
 * below by name, although the widget each one renders reads the key:
 *
 *   - the three `scale` documents, because the form-field face did not declare
 *     `scale`. It now carries `@objectstack/spec`'s `FieldSchema.scale` by
 *     reference (the faces are pinned in
 *     `packages/types/src/__tests__/strict-face-read-keys-11070.test.ts`; what
 *     each document renders is pinned by `fields-number-scale-11413` and
 *     `fields-percent-scale-11255` beside this file);
 *   - the two currency documents, because they wrote `currency: 'EUR'` /
 *     `'USD'` on the field, which the spec's `FieldSchema` refuses as a field
 *     key. The seat's ruling keeps that read runtime-only and moves the
 *     documents to the spec's declaration, `currencyConfig: { currencyMode:
 *     'fixed', defaultCurrency }`, which `resolveFieldCurrency` reads.
 *
 * The currency block is driven through the real `SchemaRenderer`, the real
 * form renderer and the real `@object-ui/fields` registration: the symbol the
 * widget draws, and the input step the currency's minor unit sets. Its two
 * controls show the declaration is what decides both. In `dynamic` mode the
 * same entry draws no symbol, because that mode reads the tenant default and
 * none is set here. With `JPY` it draws ¥ and steps by whole yen.
 *
 * Module-scope import of `@object-ui/fields`, not `beforeAll` (AGENTS.md
 * §测试纪律): the widgets sit behind `React.lazy`, so paying the import here
 * keeps the lazy factories out of every test timeout budget.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import '@object-ui/components';
import '@object-ui/fields';
import { SchemaRenderer } from '@object-ui/react';
import { StrictAnyComponentSchema } from '@object-ui/types/zod';
import { getExample } from '../src/index.js';

interface CurrencyConfig {
  currencyMode?: string;
  defaultCurrency?: string;
}
interface FieldEntry {
  name: string;
  type: string;
  scale?: number;
  currency?: string;
  currencyConfig?: CurrencyConfig;
}
interface FormNode {
  type: 'form';
  fields: FieldEntry[];
  [key: string]: unknown;
}

const ROUND_13_DOCUMENTS = [
  'fields-number/with-decimal-places',
  'fields-percent/required-percent',
  'fields-percent/with-decimal-places',
  'fields-currency/euro-currency',
  'fields-currency/usd-currency',
] as const;

/** Every strict-face issue as `code path: message`, so a red run says what broke. */
function strictIssues(schema: unknown): string[] {
  const result = StrictAnyComponentSchema.safeParse(schema);
  return result.success
    ? []
    : result.error.issues.map((i) => `${i.code} ${i.path.map(String).join('.')}: ${i.message}`);
}

/** A deep copy of a catalog form: the control cases below edit their own. */
function example(id: string): FormNode {
  return JSON.parse(JSON.stringify(getExample(id).schema)) as FormNode;
}

/** The symbol drawn beside the input ('' when none) and the input's `step`. */
async function currencyInput(schema: FormNode): Promise<{ symbol: string; step: string | null }> {
  const { container } = render(<SchemaRenderer schema={schema as never} />);
  const selector = `[data-field="${schema.fields[0].name}"] input[type="number"]`;
  // `waitFor`: the widget is a `React.lazy` boundary, so the FormItem's input
  // is absent until the chunk resolves.
  await waitFor(() => expect(container.querySelector(selector)).toBeTruthy());
  const input = container.querySelector(selector) as HTMLInputElement;
  return {
    symbol: input.parentElement?.querySelector('span')?.textContent ?? '',
    step: input.getAttribute('step'),
  };
}

describe('the round-13 catalog documents parse on the strict authoring face (objectui#11070)', () => {
  it.each(ROUND_13_DOCUMENTS)('%s parses on the strict face', (id) => {
    expect(strictIssues(getExample(id).schema)).toEqual([]);
  });
});

describe('the currency catalog examples declare their currency as `currencyConfig` (objectui#11070)', () => {
  const CASES = [
    ['fields-currency/euro-currency', 'EUR', '€'],
    ['fields-currency/usd-currency', 'USD', '$'],
  ] as const;

  it.each(CASES)('%s declares a fixed %s and draws %s', async (id, code, symbol) => {
    const schema = example(id);
    const [field] = schema.fields;
    expect(field.currencyConfig).toEqual({ currencyMode: 'fixed', defaultCurrency: code });
    expect(field).not.toHaveProperty('currency');

    // Two decimals: the minor unit of both EUR and USD.
    expect(await currencyInput(schema)).toEqual({ symbol, step: '0.01' });
  });

  it('CONTROL: in `dynamic` mode the same entry draws no symbol, because that mode does not read `defaultCurrency`', async () => {
    const schema = example('fields-currency/euro-currency');
    schema.fields[0].currencyConfig = { currencyMode: 'dynamic', defaultCurrency: 'EUR' };
    expect((await currencyInput(schema)).symbol).toBe('');
  });

  it('CONTROL: the declared code is read, not a constant: `JPY` draws ¥ and steps by whole yen', async () => {
    const schema = example('fields-currency/euro-currency');
    schema.fields[0].currencyConfig = { currencyMode: 'fixed', defaultCurrency: 'JPY' };
    expect(await currencyInput(schema)).toEqual({ symbol: '¥', step: '1' });
  });
});
