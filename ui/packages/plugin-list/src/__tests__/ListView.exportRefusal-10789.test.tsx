/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The server export reports a refused filter in the toolbar instead of
 * throwing out of the Export click — objectui#10789.
 *
 * The export builds its filter with `buildEffectiveFilter`, the same function
 * the data fetch uses, and that lowering refuses a malformed filter with a
 * `FilterOperatorError`. The fetch calls it inside its load `try` (the
 * load-error panel names the refusal); the export called it BEFORE its `try`,
 * so the refusal escaped the click handler: no file and no message, while the
 * toolbar's Export stayed clickable above the load-error panel.
 *
 * Asserted on the message's CONTENT (the refused operator) and on the absence
 * of any export request — never on a bare "did not throw".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

function harness(schema: ListViewSchema) {
  const exportDownload = vi.fn().mockResolvedValue(new Blob(['x'], { type: 'text/csv' }));
  const find = vi.fn().mockResolvedValue({ data: [], total: 0 });
  const ds: any = { find, findOne: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), exportDownload };
  render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView schema={{ ...WIDE_TOOLBAR, ...schema }} dataSource={ds} />
    </SchemaRendererProvider>,
  );
  return { exportDownload };
}

async function clickExportCsv() {
  fireEvent.click(screen.getByRole('button', { name: /export/i }));
  fireEvent.click(await screen.findByRole('button', { name: /export as csv/i }));
}

const BASE: ListViewSchema = {
  type: 'list-view',
  objectName: 'account',
  viewType: 'grid',
  fields: ['name'],
  exportOptions: { formats: ['csv'] },
};

describe('ListView export — a refused filter (objectui#10789)', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('names the refusal in the export menu and requests no file', async () => {
    const { exportDownload } = harness({ ...BASE, filter: { name: { $regex: '^A' } } as any });
    await clickExportCsv();

    const alert = await screen.findByText(/\$regex/, { selector: '[role="alert"]' });
    expect(alert).toBeTruthy();
    expect(exportDownload).not.toHaveBeenCalled();
  });

  it('CONTROL — a well-formed filter still exports with it', async () => {
    const { exportDownload } = harness({ ...BASE, filter: { name: 'Acme' } as any });
    await clickExportCsv();
    await vi.waitFor(() => expect(exportDownload).toHaveBeenCalledTimes(1));
    expect(exportDownload.mock.calls[0][1]?.filter).toEqual(['name', '=', 'Acme']);
  });
});
