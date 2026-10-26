/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The identity import sends a CSV file as CSV text, batch by batch
 * (objectui#13315).
 *
 * The stock ImportWizard sends a CSV file's rows to the import door as CSV text
 * (`format: 'csv'`, the preview's rows re-spelled), so the door reads them
 * through its one CSV rule. The identity import goes through the same wizard
 * and its adapter posts to `POST /api/v1/auth/admin/import-users` in batches of
 * at most 500 rows, so the adapter takes the same change: each batch is the
 * header record plus that batch's data records, as CSV text, and the rows each
 * batch carries are still read to name every row's identity in the result.
 *
 *   - the pure half: how a CSV request is cut into batches (quoted commas, a
 *     quoted line break, doubled quotes, a row with every cell empty);
 *   - the wired half: the real wizard and the real adapter, a 1001-row .csv
 *     file, three batches — each batch body is the wizard's own CSV text cut at
 *     record boundaries, the results renumber onto the preview's rows, and a
 *     one-time password is named by the identity of the row it belongs to;
 *   - CONTROL: a paste still goes out as JSON rows.
 *
 * `ImportWizard` is imported at module scope rather than through `ObjectView`'s
 * `React.lazy` boundary (AGENTS.md 测试纪律).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ImportWizard } from '@object-ui/plugin-grid';
import type { ImportRequestOptions } from '@object-ui/types';
import {
  batchIdentityImportRequest,
  createIdentityImportDataSource,
  readCsvRequestRecords,
  IDENTITY_IMPORT_OBJECT,
} from '../identityImport';
import { identityImportFields } from '../IdentityImportPanels';

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = vi.fn(() => false);
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
});

describe('batchIdentityImportRequest cuts a CSV request at record boundaries (objectui#13315)', () => {
  const csv = [
    'email,name',
    'a@x.test,"Doe, Jane"',
    'b@x.test,"Line one\nLine two"',
    ',',
    'c@x.test,"Say ""hi"""',
  ].join('\r\n');

  it('reads every record with its text as written and its cells', () => {
    expect(readCsvRequestRecords(csv)).toEqual([
      { text: 'email,name', cells: ['email', 'name'] },
      { text: 'a@x.test,"Doe, Jane"', cells: ['a@x.test', 'Doe, Jane'] },
      { text: 'b@x.test,"Line one\nLine two"', cells: ['b@x.test', 'Line one\nLine two'] },
      { text: ',', cells: ['', ''] },
      { text: 'c@x.test,"Say ""hi"""', cells: ['c@x.test', 'Say "hi"'] },
    ]);
  });

  it('each batch is the header record plus its data records, and carries those rows in file order', () => {
    expect(batchIdentityImportRequest({ format: 'csv', csv }, 2)).toEqual([
      {
        payload: { format: 'csv', csv: 'email,name\r\na@x.test,"Doe, Jane"\r\nb@x.test,"Line one\nLine two"' },
        rows: [{ email: 'a@x.test', name: 'Doe, Jane' }, { email: 'b@x.test', name: 'Line one\nLine two' }],
      },
      {
        payload: { format: 'csv', csv: 'email,name\r\n,\r\nc@x.test,"Say ""hi"""' },
        rows: [{ email: '', name: '' }, { email: 'c@x.test', name: 'Say "hi"' }],
      },
    ]);
  });

  it('a header alone is no row, and the adapter refuses it before any request', async () => {
    expect(batchIdentityImportRequest({ format: 'csv', csv: 'email,name' })).toEqual([]);
    const authFetch = vi.fn();
    const ds = createIdentityImportDataSource({
      base: {}, authFetch, baseUrl: 'http://srv', getPasswordPolicy: () => 'auto',
    }) as { importRecords: (o: string, r: ImportRequestOptions) => Promise<unknown> };
    await expect(ds.importRecords(IDENTITY_IMPORT_OBJECT, { format: 'csv', csv: 'email,name' }))
      .rejects.toThrow(/at least one mapped row/);
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('CONTROL: JSON rows are batched as JSON rows', () => {
    const rows = [{ email: 'a@x.test' }, { email: 'b@x.test' }, { email: 'c@x.test' }];
    expect(batchIdentityImportRequest({ format: 'json', rows }, 2)).toEqual([
      { payload: { format: 'json', rows: rows.slice(0, 2) }, rows: rows.slice(0, 2) },
      { payload: { format: 'json', rows: rows.slice(2) }, rows: rows.slice(2) },
    ]);
  });
});

/** The identity endpoint, faked: it records each body and answers one row
 *  result per data record, with a one-time password on the rows asked for. */
function fakeEndpoint(passwordFor: (batch: number, row: number) => string | undefined) {
  const bodies: Array<Record<string, unknown>> = [];
  const authFetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const batch = bodies.length;
    bodies.push(body);
    // This file's fixtures hold no quoted line break, so a CRLF ends a record.
    const count = body.format === 'csv'
      ? String(body.csv).split('\r\n').length - 1
      : (body.rows as unknown[]).length;
    const rows = Array.from({ length: count }, (_, i) => {
      const temporaryPassword = passwordFor(batch, i + 1);
      return { row: i + 1, ok: true, action: 'created', id: `u-${batch}-${i}`, ...(temporaryPassword ? { temporaryPassword } : {}) };
    });
    return new Response(JSON.stringify({
      success: true,
      data: { summary: { total: count, created: count, updated: 0, skipped: 0, errors: 0, dryRun: false }, rows },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  return { bodies, authFetch };
}

function renderIdentityWizard(authFetch: (url: string, init?: RequestInit) => Promise<Response>, initialFile?: File) {
  const ds = createIdentityImportDataSource({
    base: {}, authFetch, baseUrl: 'http://srv', getPasswordPolicy: () => 'temporary',
  }) as { importRecords: (o: string, r: ImportRequestOptions) => Promise<unknown> };
  const seen: ImportRequestOptions[] = [];
  const dataSource = {
    ...ds,
    importRecords: (object: string, request: ImportRequestOptions) => { seen.push(request); return ds.importRecords(object, request); },
  };
  const onComplete = vi.fn();
  render(
    <ImportWizard
      objectName={IDENTITY_IMPORT_OBJECT}
      fields={identityImportFields(undefined)}
      dataSource={dataSource as never}
      initialFile={initialFile}
      open
      onOpenChange={() => {}}
      onComplete={onComplete}
    />,
  );
  return { seen, onComplete };
}

async function runAsMapped(onComplete: ReturnType<typeof vi.fn>) {
  const next = await screen.findByTestId('import-next-btn');
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  const run = await screen.findByTestId('import-run-btn');
  await waitFor(() => expect(run).toBeEnabled());
  fireEvent.click(run);
  await waitFor(() => expect(onComplete).toHaveBeenCalled());
  return onComplete.mock.calls[0][0] as {
    serverResult: { total: number; results: Array<{ row: number; identity?: string; temporaryPassword?: string }> };
  };
}

describe('the identity import sends a CSV file as CSV text, batch by batch (objectui#13315)', () => {
  it('a 1001-row .csv file: three CSV batches cut from the wizard\'s text, rows renumbered, identities named', async () => {
    const people = Array.from({ length: 1001 }, (_, i) => [`user${i + 1}@example.test`, i === 2 ? '"Doe, Jane"' : `User ${i + 1}`]);
    const file = new File([['Email,Name', ...people.map((p) => p.join(','))].join('\n')], 'users.csv', { type: 'text/csv' });
    // A one-time password on row 277 of the second batch: row 777 of the file.
    const { bodies, authFetch } = fakeEndpoint((batch, row) => (batch === 1 && row === 277 ? 'Pw-777' : undefined));
    const { seen, onComplete } = renderIdentityWizard(authFetch, file);

    const result = await runAsMapped(onComplete);

    const sent = seen.filter((r) => !r.dryRun);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ format: 'csv' });
    expect(sent[0]).not.toHaveProperty('rows');
    const [header, ...records] = String(sent[0].csv).split('\r\n');
    expect(header).toBe('email,name');
    expect(records[2]).toBe('user3@example.test,"Doe, Jane"');

    expect(bodies.map((b) => b.format)).toEqual(['csv', 'csv', 'csv']);
    expect(bodies.map((b) => b.csv)).toEqual([
      [header, ...records.slice(0, 500)].join('\r\n'),
      [header, ...records.slice(500, 1000)].join('\r\n'),
      [header, ...records.slice(1000)].join('\r\n'),
    ]);
    for (const body of bodies) {
      expect(body).not.toHaveProperty('rows');
      expect(body).toMatchObject({ mode: 'insert', passwordPolicy: 'temporary' });
    }

    expect(result.serverResult.total).toBe(1001);
    expect(result.serverResult.results.map((r) => r.row)).toEqual(Array.from({ length: 1001 }, (_, i) => i + 1));
    expect(result.serverResult.results.filter((r) => r.temporaryPassword)).toEqual([
      expect.objectContaining({ row: 777, temporaryPassword: 'Pw-777', identity: 'user777@example.test' }),
    ]);
  });

  it('CONTROL: a paste still goes out as JSON rows', async () => {
    const { bodies, authFetch } = fakeEndpoint(() => undefined);
    const { onComplete } = renderIdentityWizard(authFetch);
    const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
      clipboardData: { getData: (type: string) => string };
    };
    evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? 'Email\tName\na@x.test\tAda\nb@x.test\tGrace' : '') };
    act(() => { window.dispatchEvent(evt); });

    await runAsMapped(onComplete);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      format: 'json',
      rows: [{ email: 'a@x.test', name: 'Ada' }, { email: 'b@x.test', name: 'Grace' }],
    });
    expect(bodies[0]).not.toHaveProperty('csv');
  });
});
