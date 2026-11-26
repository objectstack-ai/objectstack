/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35490 (ADR-0158 R1 display): a quantity renders with its unit's
 * label and display decimal places on every face. The grid cell and the
 * detail row are `getCellRenderer('number')` handed the row
 * (`dependentValues`, as `generateColumns` and `DetailSection` hand it); the
 * form is `NumberField`, read-only and edited, handed the form's record.
 *
 * Covers the card's named cases: record mode and fixed mode on all three
 * faces; a deleted org unit and an external member's org unit show the bare
 * code; the setting row is the record's organization's; and L4's clamp (the
 * field's `scale` is the ceiling).
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererContext } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { getCellRenderer } from '../index';
import { NumberField } from '../widgets/NumberField';
import { formatQuantity, quantityDisplayPlaces } from '../widgets/quantity-format';

afterEach(cleanup);

const text = (s: string | null | undefined) => (s ?? '').replace(/ /g, ' ');

const ORG_UNITS = [
  { code: 'BOX_12', label: 'Box of 12', decimal_places: 1, retired: false, organization_id: 'org_a' },
  { code: 'JIN1', label: 'Jin', decimal_places: 2, retired: true, organization_id: 'org_a' },
];
const SETTINGS = [
  { code: 'GRM', decimal_places: 3, organization_id: 'org_a' },
  { code: 'GRM', decimal_places: 0, organization_id: 'org_b' },
  { code: 'KGM', decimal_places: 0, organization_id: 'org_a' },
];

/** A data source answering the two unit tables; `refuse` names tables it answers 403 for. */
function unitSource(refuse: string[] = []) {
  const calls: string[] = [];
  return {
    calls,
    async find(resource: string) {
      calls.push(resource);
      if (refuse.includes(resource)) throw Object.assign(new Error('Forbidden'), { status: 403 });
      if (resource === 'sys_unit') return { data: ORG_UNITS };
      if (resource === 'sys_standard_unit_setting') return { data: SETTINGS };
      return { data: [] };
    },
  };
}

const RECORD_QTY = { name: 'qty', type: 'number', unitConfig: { unitMode: 'record', unitField: 'unit_code' } } as any;
const FIXED_QTY = { name: 'weight', type: 'number', unitConfig: { unitMode: 'fixed', unit: 'KGM' } } as any;

type Face = 'grid' | 'detail' | 'form';

function draw(face: Face, field: any, value: number, record: Record<string, unknown>, ds: unknown) {
  const Cell = getCellRenderer('number');
  const body =
    face === 'form' ? (
      <NumberField value={value} onChange={() => {}} field={field} dependentValues={record} readonly />
    ) : (
      <Cell value={value} field={field} dependentValues={record} />
    );
  return render(
    <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
      <div data-testid="face">{body}</div>
    </SchemaRendererContext.Provider>,
  );
}
const faceText = () => text(screen.getByTestId('face').textContent);

describe.each<Face>(['grid', 'detail', 'form'])('the %s face', (face) => {
  it("draws a record-mode quantity with its row's org unit label and decimal places", async () => {
    draw(face, RECORD_QTY, 4, { unit_code: 'BOX_12', organization_id: 'org_a' }, unitSource());
    await waitFor(() => expect(faceText()).toBe('4.0 Box of 12'));
  });

  it("draws a fixed-mode quantity with the standard label and its organization's setting", async () => {
    draw(face, FIXED_QTY, 1234.5, { organization_id: 'org_a' }, unitSource());
    await waitFor(() => expect(faceText()).toBe('1,235 kilogram'));
  });

  it('draws a deleted (retired) org unit as the bare code, at the field width', async () => {
    const ds = unitSource();
    draw(face, RECORD_QTY, 2.5, { unit_code: 'JIN1', organization_id: 'org_a' }, ds);
    await waitFor(() => expect(ds.calls).toContain('sys_unit'));
    await waitFor(() => expect(faceText()).toBe('2.5 JIN1'));
  });

  it('draws an org unit as the bare code for an external member, who may not read sys_unit', async () => {
    const ds = unitSource(['sys_unit']);
    draw(face, RECORD_QTY, 4, { unit_code: 'BOX_12', organization_id: 'org_a' }, ds);
    await waitFor(() => expect(ds.calls).toContain('sys_unit'));
    expect(faceText()).toBe('4 BOX_12');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("takes the decimal places of the record's own organization's row", async () => {
    draw(face, RECORD_QTY, 1.5, { unit_code: 'GRM', organization_id: 'org_b' }, unitSource());
    await waitFor(() => expect(faceText()).toBe('2 gram'));
    cleanup();
    draw(face, RECORD_QTY, 1.5, { unit_code: 'GRM', organization_id: 'org_a' }, unitSource());
    await waitFor(() => expect(faceText()).toBe('1.500 gram'));
  });

  it("never shows more places than the field's scale (L4)", async () => {
    draw(face, { ...RECORD_QTY, scale: 2 }, 1.5, { unit_code: 'GRM', organization_id: 'org_a' }, unitSource());
    await waitFor(() => expect(faceText()).toBe('1.50 gram'));
  });

  it('draws a bare number when the row names no unit', async () => {
    draw(face, RECORD_QTY, 7, { unit_code: '', organization_id: 'org_a' }, unitSource());
    expect(faceText()).toBe('7');
  });
});

describe('the edited form box', () => {
  it('names the unit beside the input', async () => {
    render(
      <SchemaRendererContext.Provider value={{ dataSource: unitSource() } as never}>
        <NumberField value={3} onChange={() => {}} field={RECORD_QTY} dependentValues={{ unit_code: 'BOX_12', organization_id: 'org_a' }} />
      </SchemaRendererContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText('Box of 12')).toBeInTheDocument());
    expect(screen.getByRole('spinbutton')).toHaveValue(3);
  });
});

describe('the per-locale standard name (ADR-0158 L2, 2A)', () => {
  it("reads the name the server serves for the reader's locale (`app.messages.standardUnit<CODE>`)", async () => {
    // The served translation document lays the platform bundles under `app`,
    // as the console's loader does (`transformSpecTranslations`).
    const resources = { zh: { app: { messages: { standardUnitKGM: '千克' } } } };
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources } as never}>
        <SchemaRendererContext.Provider value={{ dataSource: unitSource() } as never}>
          <div data-testid="face">{React.createElement(getCellRenderer('number'), { value: 2, field: FIXED_QTY, dependentValues: { organization_id: 'org_a' } })}</div>
        </SchemaRendererContext.Provider>
      </I18nProvider>,
    );
    await waitFor(() => expect(faceText()).toBe('2 千克'));
  });
});

describe('a unit-code field (Open item 8)', () => {
  it("draws the code's label, and a retired code bare", async () => {
    const CODE = { name: 'base_unit', type: 'text', unitConfig: { unitMode: 'code' } } as any;
    const Cell = getCellRenderer('text');
    render(
      <SchemaRendererContext.Provider value={{ dataSource: unitSource() } as never}>
        <div data-testid="a"><Cell value="H87" field={CODE} dependentValues={{ organization_id: 'org_a' }} /></div>
        <div data-testid="b"><Cell value="JIN1" field={CODE} dependentValues={{ organization_id: 'org_a' }} /></div>
      </SchemaRendererContext.Provider>,
    );
    await waitFor(() => expect(text(screen.getByTestId('a').textContent)).toBe('piece'));
    expect(text(screen.getByTestId('b').textContent)).toBe('JIN1');
  });
});

describe('formatQuantity — the one formatter', () => {
  const field = { name: 'qty', type: 'number' } as any;

  it('marks a stored value with more places than shown, and changes nothing stored', () => {
    const value = 1.5;
    const out = formatQuantity(value, field, { code: 'H87', standard: true, label: 'pc', decimals: 0 }, 'en-US');
    expect(out).toEqual({ text: '2 pc', number: '2', unit: 'pc', hidden: true });
    expect(value).toBe(1.5);
    expect(formatQuantity(1.5, field, { code: 'GRM', standard: true, label: 'g', decimals: 3 }, 'en-US').hidden).toBe(false);
  });

  it('keeps the field width when the unit has no decimal places of its own', () => {
    expect(formatQuantity(1.25, { ...field, scale: 2 }, { code: 'KGM', standard: true, label: 'kg' }, 'en-US').text).toBe('1.25 kg');
    expect(quantityDisplayPlaces(undefined, field)).toBeUndefined();
    expect(quantityDisplayPlaces(5, { ...field, scale: 2 })).toBe(2);
    expect(quantityDisplayPlaces(1, { ...field, scale: 2 })).toBe(1);
  });
});
