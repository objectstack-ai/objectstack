/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Add-record placement ↔ spec vocabulary parity + behavior (#2941).
 *
 * `AddRecordConfigSchema.position` (`ui/view.zod.ts`) publishes
 * `top | bottom | both`. The toolbar used a binary ternary
 * (`position === 'bottom' ? 'bottom' : 'top'`), so `both` validated and then
 * silently rendered only the top button — the bottom one never existed.
 *
 * Contract under test:
 * - parity: every spec position resolves to a distinct placement, and the
 *   resolver is exactly the spec vocabulary plus the documented fallback;
 * - behavior: `both` renders two add-record buttons, `top`/`bottom` one each.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { AddRecordConfigSchema } from '@objectstack/spec/ui';
import { shapeEnumOptions } from '@object-ui/test-support';
import { ListView, resolveAddRecordPlacement } from '../ListView';
import type { ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';

beforeAll(() => {
  Object.defineProperty(window, 'localStorage', {
    value: (() => {
      let store: Record<string, string> = {};
      return {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        clear: () => { store = {}; },
        removeItem: (k: string) => { delete store[k]; },
      };
    })(),
    configurable: true,
  });
});

describe('resolveAddRecordPlacement covers the spec position vocabulary', () => {
  const specNames = shapeEnumOptions(AddRecordConfigSchema, 'position');

  it('reads a non-empty enum from the spec', () => {
    expect(specNames, 'could not read AddRecordConfigSchema.shape.position options from the spec').not.toEqual([]);
  });

  it('gives every spec position a placement that matches its name', () => {
    const placements = Object.fromEntries(specNames.map((name) => [name, resolveAddRecordPlacement(name)]));
    expect(placements).toEqual({
      top: { top: true, bottom: false },
      bottom: { top: false, bottom: true },
      both: { top: true, bottom: true },
    });
  });

  it('keeps the historical top placement for absent/unknown values', () => {
    expect(resolveAddRecordPlacement(undefined)).toEqual({ top: true, bottom: false });
    expect(resolveAddRecordPlacement('sideways')).toEqual({ top: true, bottom: false });
  });
});

function makeDataSource() {
  const find = vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'A' }], total: 1 });
  return {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as any;
}

function renderList(schema: Partial<ListViewSchema>, ds: any) {
  return render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView
        schema={{ type: 'list-view', objectName: 'proj', fields: ['name'], ...schema } as any}
        dataSource={ds}
      />
    </SchemaRendererProvider>,
  );
}

describe("addRecord.position 'both' renders both buttons", () => {
  it("renders two add-record buttons for position 'both'", async () => {
    const ds = makeDataSource();
    renderList({ addRecord: { enabled: true, position: 'both' } as any }, ds);

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByTestId('add-record-button')).toHaveLength(2));
  });

  it("renders one button for 'top' and one for 'bottom'", async () => {
    const ds = makeDataSource();
    const { unmount } = renderList({ addRecord: { enabled: true, position: 'top' } as any }, ds);
    await waitFor(() => expect(screen.getAllByTestId('add-record-button')).toHaveLength(1));
    unmount();

    const ds2 = makeDataSource();
    renderList({ addRecord: { enabled: true, position: 'bottom' } as any }, ds2);
    await waitFor(() => expect(screen.getAllByTestId('add-record-button')).toHaveLength(1));
  });
});
