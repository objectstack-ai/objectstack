import { describe, it, expect } from 'vitest';
import { __testables } from './ImportWizard';

const { assembleImportRequest, formatDryRunError } = __testables;

const rows = [{ name: 'Acme' }, { name: 'Beta' }];
const baseOpts = {
  writeMode: 'insert' as const,
  matchFields: [] as string[],
  createMissingOptions: false,
  skipBlankMatchKey: false,
};

describe('assembleImportRequest', () => {
  it('omits dryRun on a real import request', () => {
    const req = assembleImportRequest(rows, baseOpts);
    expect(req).not.toHaveProperty('dryRun');
    expect(req.format).toBe('json');
    expect(req.rows).toBe(rows);
    expect(req.writeMode).toBe('insert');
  });

  it('sets dryRun:true when validating, keeping the rest of the payload identical', () => {
    const live = assembleImportRequest(rows, baseOpts);
    const dry = assembleImportRequest(rows, { ...baseOpts, dryRun: true });
    expect(dry.dryRun).toBe(true);
    // dryRun is the ONLY difference — the pre-check validates the exact payload.
    expect({ ...dry, dryRun: undefined }).toEqual({ ...live, dryRun: undefined });
  });

  it('drops matchFields for insert mode but sends them for update/upsert', () => {
    const insert = assembleImportRequest(rows, { ...baseOpts, writeMode: 'insert', matchFields: ['name'] });
    expect(insert).not.toHaveProperty('matchFields');

    const upsert = assembleImportRequest(rows, { ...baseOpts, writeMode: 'upsert', matchFields: ['name'] });
    expect(upsert.matchFields).toEqual(['name']);

    const update = assembleImportRequest(rows, { ...baseOpts, writeMode: 'update', matchFields: ['email'] });
    expect(update.matchFields).toEqual(['email']);
  });

  it('threads coercion options through verbatim', () => {
    const req = assembleImportRequest(rows, {
      ...baseOpts,
      createMissingOptions: true,
      skipBlankMatchKey: true,
    });
    expect(req.createMissingOptions).toBe(true);
    expect(req.skipBlankMatchKey).toBe(true);
  });
});

describe('formatDryRunError', () => {
  const labels = new Map([['product', '产品']]);
  // Echoes the server's structured English messages for reference failures.
  const t = (key: string, vars?: Record<string, unknown>) =>
    ({
      'grid.import.referenceNotFound': `No matching record for "${vars?.value}"`,
      'grid.import.referenceAmbiguous': `"${vars?.value}" matches more than one record`,
      'grid.import.invalidNumber': `"${vars?.value}" is not a valid number`,
      'grid.import.invalidOption': `"${vars?.value}" is not one of the allowed options`,
      'grid.import.requiredValue': 'This field is required',
      'grid.import.matchAmbiguous': 'Matches more than one existing record — use a unique value or the record id',
    } as Record<string, string>)[key] ?? key;

  it('resolves the field api-name to its label', () => {
    const { fieldLabel } = formatDryRunError(
      { field: 'product', code: 'reference_not_found', error: 'product: no os_x_product matches "导管架"' },
      labels, '导管架', t,
    );
    expect(fieldLabel).toBe('产品');
  });

  it('renders reference_not_found from the code, not the raw English server text', () => {
    const { message } = formatDryRunError(
      { field: 'product', code: 'reference_not_found', error: 'product: no os_x_product matches "导管架"' },
      labels, '导管架', t,
    );
    // No duplicated field name, no internal object api-name leaking through.
    expect(message).toBe('No matching record for "导管架"');
    expect(message).not.toContain('os_x_product');
    expect(message).not.toContain('product:');
  });

  it('falls back to the quoted value when the cell value is unavailable', () => {
    const { message } = formatDryRunError(
      { field: 'product', code: 'reference_not_found', error: 'product: no os_x_product matches "导管架"' },
      labels, undefined, t,
    );
    expect(message).toBe('No matching record for "导管架"');
  });

  it('maps reference_ambiguous through its own key', () => {
    const { message } = formatDryRunError(
      { field: 'product', code: 'reference_ambiguous', error: 'product: "导管架" matches more than one os_x_product' },
      labels, '导管架', t,
    );
    expect(message).toBe('"导管架" matches more than one record');
  });

  it('maps a coercion code (invalid_number) off the code, not the raw text', () => {
    const { message } = formatDryRunError(
      { field: 'product', code: 'invalid_number', error: 'product: "abc" is not a number' },
      labels, 'abc', t,
    );
    expect(message).toBe('"abc" is not a valid number');
    expect(message).not.toContain('product:');
  });

  it('maps invalid_option through its key', () => {
    const { message } = formatDryRunError(
      { field: 'product', code: 'invalid_option', error: 'product: "x" is not a known option' },
      labels, 'x', t,
    );
    expect(message).toBe('"x" is not one of the allowed options');
  });

  it('maps a required-field miss to a value-free message', () => {
    const { fieldLabel, message } = formatDryRunError(
      { field: 'product', code: 'required', error: 'product is required' },
      labels, undefined, t,
    );
    expect(fieldLabel).toBe('产品');
    expect(message).toBe('This field is required');
  });

  it('maps AMBIGUOUS_MATCH (upsert match key) without leaking the object api-name', () => {
    const { message } = formatDryRunError(
      { field: '', code: 'AMBIGUOUS_MATCH', error: 'matchFields matched more than one os_x_position record' },
      labels, undefined, t,
    );
    expect(message).toBe('Matches more than one existing record — use a unique value or the record id');
    expect(message).not.toContain('os_x_position');
  });

  it('strips a duplicated api-name prefix for codes it does not recognize', () => {
    const { fieldLabel, message } = formatDryRunError(
      { field: 'product', code: 'some_other_error', error: 'product: value is out of range' },
      labels, 'x', t,
    );
    expect(fieldLabel).toBe('产品');
    // The label carries the field; the message must not repeat "product:".
    expect(message).toBe('value is out of range');
  });
});
