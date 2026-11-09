/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#30334 — the record dialog's refusal of a write the object's
 * external datasource does not admit (`403 EXTERNAL_WRITE_FORBIDDEN`, the
 * ADR-0015 write gate) says the table is read-only, not "you don't have
 * permission": no permission set can lift it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope (object-ui/no-dynamic-import-in-test-hook).
import '../renderers';

const SCHEMA = {
  type: 'form',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
  submitText: 'Save',
} as any;

const GATE_TEXT =
  "Write 'insert' blocked on object 'spare_parts': datasource 'parts_db' is external (schemaMode=external). " +
  'Requires datasource.external.allowWrites=true (got false) AND object.external.writable=true (got false).';

function renderForm(onAction: () => Promise<unknown>) {
  const Form = ComponentRegistry.get('form')!;
  return render(<Form schema={SCHEMA} onAction={onAction} />);
}

describe('#30334 — a write the external datasource does not admit', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('reads the read-only line, not the permission line or the gate diagnostic', async () => {
    const { container } = renderForm(async () => {
      throw Object.assign(new Error(GATE_TEXT), { code: 'EXTERNAL_WRITE_FORBIDDEN', httpStatus: 403 });
    });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    expect(await screen.findByText(/this table is read-only/i)).toBeInTheDocument();
    expect(screen.queryByText(/permission to save/i)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/allowWrites/);
    expect(container.textContent).not.toMatch(/spare_parts/);
  });

  it('reads the code from `details` as well', async () => {
    renderForm(async () => {
      throw Object.assign(new Error(GATE_TEXT), {
        httpStatus: 403,
        details: { error: GATE_TEXT, code: 'EXTERNAL_WRITE_FORBIDDEN' },
      });
    });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    expect(await screen.findByText(/this table is read-only/i)).toBeInTheDocument();
  });

  it('CONTROL: any other 403 keeps the permission line', async () => {
    renderForm(async () => {
      throw Object.assign(new Error('FORBIDDEN: insufficient privileges'), { code: 'FORBIDDEN', status: 403 });
    });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    expect(await screen.findByText(/permission to save/i)).toBeInTheDocument();
    expect(screen.queryByText(/this table is read-only/i)).not.toBeInTheDocument();
  });
});
