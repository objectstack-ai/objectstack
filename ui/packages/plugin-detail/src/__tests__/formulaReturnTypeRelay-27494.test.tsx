/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27494: a formula's declared `returnType` reaches the record
 * page's cells through `ENRICHED_FIELD_METADATA_KEYS` (`enrichDetailField`),
 * the list `DetailSection`, `HeaderHighlight` and the summary chips share.
 *
 * The formula cell picks its face from `returnType`, and a `currency` one
 * draws through the currency cell with the formula's own `currencyConfig`.
 * The key list carried `currencyConfig` and `scale` but not `returnType`, so
 * a section entry naming the field (`{ name }`) handed the cell an undeclared
 * formula holding a JS number, and it read as a bare `90,000.00`.
 *
 * ── Directions on the base tree (predicted before the first run) ─────────
 *   currency formula, enrichment and DetailSection   RED   (no returnType / `90,000.00`)
 *   number formula control                           GREEN (the number face is right)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { FieldSchema } from '@objectstack/spec/data';

import '@object-ui/components';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';
import { enrichDetailField } from '../fieldEnrichment';

afterEach(cleanup);

const USD_FIXED = { currencyMode: 'fixed', defaultCurrency: 'USD' } as const;

const FIELDS = {
  budget: { type: 'currency', label: 'Budget', currencyConfig: USD_FIXED },
  // The showcase's Budget Remaining, as `project.object.ts` declares it.
  remaining: { type: 'formula', label: 'Budget Remaining', returnType: 'currency', currencyConfig: USD_FIXED, scale: 2 },
  // The control: a declared number keeps the bare grouped number.
  ratio: { type: 'formula', label: 'Burn Ratio', returnType: 'number', scale: 2 },
};

const RECORD = { id: 'p1', budget: 150000, remaining: 90000, ratio: 1234.5 };

describe('a formula returnType reaches the record page cells (objectstack#27494)', () => {
  it('CONTROL: the fixture is a spec-valid formula field def', () => {
    expect(FieldSchema.safeParse({ name: 'remaining', expression: 'record.budget', ...FIELDS.remaining }).success).toBe(true);
  });

  it('enrichDetailField copies returnType from the object field, and a view-entry one wins', () => {
    expect(enrichDetailField({ name: 'remaining' }, FIELDS.remaining).returnType).toBe('currency');
    expect(enrichDetailField({ name: 'remaining', returnType: 'number' }, FIELDS.remaining).returnType).toBe('number');
  });

  it('DetailSection: the currency formula reads $90,000.00 beside the currency field; a number formula stays bare', () => {
    const section = {
      title: 'S',
      fields: [{ name: 'budget' }, { name: 'remaining' }, { name: 'ratio' }],
    } as unknown as DetailViewSection;
    const { container } = render(
      <DetailSection section={section} data={RECORD} objectSchema={{ fields: FIELDS }} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('$150,000.00');
    expect(text).toContain('$90,000.00');
    expect(text, 'CONTROL: a number formula keeps the bare grouped number').toContain('1,234.50');
    expect(text).not.toContain('$1,234.50');
  });
});
