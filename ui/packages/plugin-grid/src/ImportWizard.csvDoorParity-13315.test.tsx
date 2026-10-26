/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT.
 */

/**
 * Parity of the server's CSV import parse with the wizard's own parse,
 * MEASURED before a CSV file source was sent to the server's CSV import door
 * (objectui#13315, item 2). This file records the inputs on which the two
 * differ in a way that changes an imported value.
 *
 * Two ways for the wizard to hand a CSV file to that door were measured:
 *   - FILE TEXT: the server parses the file's own decoded text.
 *   - RE-SPELLED: the server parses `sourceRowsToCsv(rows)`, the rows the
 *     preview shows written back out as CSV — what a csv-declared named
 *     mapping already sent (objectui#13156).
 *
 * RE-SPELLED is the route that shipped (the maintainer's ruling A on
 * objectui#13315): a CSV file source sends `format: 'csv'` with
 * `sourceRowsToCsv(rows)`. Its pins are in
 * `ImportWizard.csvFileSource-13315.test.tsx`. The FILE TEXT cases below record
 * why the file's own text was not sent. The RE-SPELLED cases record the three
 * shapes that route was accepted with: a last row whose sent cells are all
 * empty is dropped (B1, driven through the real wizard below), an exported
 * +/- cell with trailing whitespace keeps its mark (B2), and a space before a
 * mark is trimmed, so the mark is removed (B3).
 *
 * The browser half runs live here: `decodeSpreadsheetText`, `parseDelimited`,
 * `sourceRowsToCsv`, `buildSourceRows`, and the real wizard's default-path
 * request. The server half is a RECORDING, and nothing in this repository
 * re-derives it (AGENTS.md #9): objectstack's `parseCsvToRows`
 * (`packages/rest/src/import-prepare.ts`) was read out of the objectstack git
 * objects at `main` abc25a3536 and at the head of objectstack-ai/objectstack#25130
 * (bf8244cb20), which adds the CSV text-cell rule to that parse, header row
 * included. Each function was transpiled unchanged and run on the exact text a
 * case names. To re-take a reading, run that function on the case's input at
 * the ref you need. `imported` is the recorded server value after the door's
 * default `trimWhitespace` (a blank cell leaves the field unset).
 *
 * Each case asserts the live browser side exactly, then asserts that it
 * differs from the recorded server side, so a change to either browser half
 * turns the case red and asks for a new reading.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ImportWizard, __testables } from './ImportWizard';
import { parseDelimited, decodeSpreadsheetText } from './importParsers';
import { buildSourceRows } from './savedMapping';
import type { ImportRecordsResult, ImportRequestOptions } from '@object-ui/types';

const { sourceRowsToCsv } = __testables;

/** The mark the server's CSV text-cell rule writes and reads (U+0027). */
const MARK = String.fromCharCode(0x27);

/** The wizard's file parse for delimited text (`parseSpreadsheetFile`'s text arm), on raw bytes. */
function wizardGrid(text: string, delimiter: ',' | '\t' = ','): string[][] {
  return parseDelimited(decodeSpreadsheetText(new TextEncoder().encode(text).buffer as ArrayBuffer), delimiter);
}

/** The RE-SPELLED text for the named-mapping path: source-keyed rows, every column. */
function respelled(grid: string[][]): string {
  return sourceRowsToCsv(buildSourceRows(grid[0], grid.slice(1), {}));
}

describe('FILE TEXT: the server parsing the file itself reads different cells from the wizard (objectui#13315)', () => {
  it('a tab-delimited file is one column to the server', () => {
    const text = 'name\tnote\nAda\thello, world\n';
    expect(wizardGrid(text, '\t')).toEqual([['name', 'note'], ['Ada', 'hello, world']]);
    // RECORDED, main and PR head alike: the server splits on commas only.
    const server = [{ 'name\tnote': 'Ada\thello' }];
    expect(server).not.toEqual([{ name: 'Ada', note: 'hello, world' }]);
  });

  it('a leading blank line becomes the header, and a blank line inside the file becomes a row', () => {
    const text = '\nname,note\nAda,x\n\n,\nBob,y\n\n\n';
    expect(wizardGrid(text)).toEqual([['name', 'note'], ['Ada', 'x'], ['Bob', 'y']]);
    // RECORDED, main and PR head alike: header [''], so every row is empty, and five rows, not two.
    const server = [{}, {}, {}, {}, {}];
    expect(server).toHaveLength(5);
  });

  it('a bare CR inside an unquoted cell is dropped by the server and kept by the wizard', () => {
    const text = 'name,note\nA\rB,x\n';
    expect(wizardGrid(text)).toEqual([['name', 'note'], ['A\rB', 'x']]);
    // RECORDED, main and PR head alike.
    const server = [{ name: 'AB', note: 'x' }];
    expect(server[0].name).not.toBe(wizardGrid(text)[1][0]);
  });

  it('two columns under one header: the wizard keeps both by position, the server keeps the last', () => {
    const text = 'name,name\nA,B\n';
    expect(wizardGrid(text)).toEqual([['name', 'name'], ['A', 'B']]);
    // RECORDED, main and PR head alike.
    const server = [{ name: 'B' }];
    expect(Object.values(server[0])).toHaveLength(1);
  });
});

describe('RE-SPELLED (shipped): the wizard trims a cell before the server reads its mark (objectui#13315)', () => {
  it('an exported +/- cell with trailing whitespace keeps its mark when re-spelled, and loses it when the server reads the file', () => {
    // The CSV the server's own export writes for the stored values
    // `+1 555 0100` + LF and `-42` + TAB (RECORDED: `formatCsvCell` at the PR head).
    const text = `name,note\r\n"${MARK}+1 555 0100\n",${MARK}-42\t\r\n`;
    const grid = wizardGrid(text);
    expect(grid).toEqual([['name', 'note'], [`${MARK}+1 555 0100`, `${MARK}-42`]]);
    expect(respelled(grid)).toBe(`name,note\r\n${MARK}+1 555 0100,${MARK}-42`);
    // RECORDED at the PR head.
    const fileText = { cells: [{ name: '+1 555 0100\n', note: '-42\t' }], imported: [{ name: '+1 555 0100', note: '-42' }] };
    const respelledRead = { cells: [{ name: `${MARK}+1 555 0100`, note: `${MARK}-42` }], imported: [{ name: `${MARK}+1 555 0100`, note: `${MARK}-42` }] };
    expect(respelledRead.imported).not.toEqual(fileText.imported);
    // What the re-spelled read starts from is the preview, cell for cell.
    expect(respelledRead.cells[0]).toEqual({ name: grid[1][0], note: grid[1][1] });
  });

  it('a space before a mark is trimmed by the wizard, so the re-spelled read removes the mark the file read keeps', () => {
    const text = `name,note\n ${MARK}=x,y\n`;
    const grid = wizardGrid(text);
    expect(grid).toEqual([['name', 'note'], [`${MARK}=x`, 'y']]);
    expect(respelled(grid)).toBe(`name,note\r\n${MARK}=x,y`);
    // RECORDED at the PR head; the JSON rows the wizard sent before it switched
    // to CSV imported `'=x`, as the file read does.
    const fileText = { cells: [{ name: ` ${MARK}=x`, note: 'y' }], imported: [{ name: `${MARK}=x`, note: 'y' }] };
    const respelledRead = { cells: [{ name: '=x', note: 'y' }], imported: [{ name: '=x', note: 'y' }] };
    expect(respelledRead.imported).not.toEqual(fileText.imported);
  });

  it('a header cell is read through the same rule at the PR head: the named path keys by it, the default path does not', () => {
    const text = `${MARK}=Total,note\r\nv,w\r\n`;
    const grid = wizardGrid(text);
    expect(grid).toEqual([[`${MARK}=Total`, 'note'], ['v', 'w']]);
    expect(respelled(grid)).toBe(`${MARK}=Total,note\r\nv,w`);
    // RECORDED: main keys `'=Total`, the PR head keys `=Total` (the header as
    // the export labelled it, before the mark). The default path's text is
    // headed by field names, so its keys are untouched (sourceRowsToCsv over
    // field-keyed rows: no header cell of the file reaches the server).
    const server = { main: [{ [`${MARK}=Total`]: 'v', note: 'w' }], pr: [{ '=Total': 'v', note: 'w' }] };
    expect(Object.keys(server.pr[0])).not.toEqual(Object.keys(server.main[0]));
    expect(sourceRowsToCsv([{ total: 'v', note: 'w' }])).toBe('total,note\r\nv,w');
  });
});

describe('RE-SPELLED, default path (shipped): a last row with every mapped cell empty is dropped by the server (objectui#13315)', () => {
  beforeAll(() => {
    if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = vi.fn(() => false);
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  });

  it('the wizard sends that row as CSV text, and it is gone after the server reads it (B1)', async () => {
    const sent: ImportRequestOptions[] = [];
    const importRecords = vi.fn(async (_object: string, request: ImportRequestOptions): Promise<ImportRecordsResult> => {
      sent.push(request);
      const rows = request.rows ?? [];
      return {
        object: 'contact', dryRun: request.dryRun === true, writeMode: 'insert', total: rows.length,
        ok: rows.length, errors: 0, created: rows.length, updated: 0, skipped: 0,
        results: rows.map((_, i) => ({ row: i + 1, ok: true, action: 'created' as const })),
      } as ImportRecordsResult;
    });
    const onComplete = vi.fn();
    // The `note` column has no field, so it stays unmapped; the last row has a
    // value in that column only.
    const file = new File(['name,note\nAda,x\n,only a note\n'], 'contacts.csv', { type: 'text/csv' });
    render(
      <ImportWizard
        objectName="contact"
        fields={[{ name: 'name', label: 'Name', type: 'text' }]}
        dataSource={{ importRecords } as never}
        initialFile={file}
        open
        onOpenChange={() => {}}
        onComplete={onComplete as never}
      />,
    );
    const next = await screen.findByTestId('import-next-btn');
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    const run = await screen.findByTestId('import-run-btn');
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);
    await waitFor(() => expect(onComplete).toHaveBeenCalled());

    const real = sent.filter((r) => !r.dryRun);
    expect(real).toHaveLength(1);
    // The preview's two rows, the second with its one mapped cell empty,
    // re-spelled: `sourceRowsToCsv([{ name: 'Ada' }, { name: '' }])`.
    expect(real[0]).toEqual({
      format: 'csv', csv: 'name\r\nAda\r\n', writeMode: 'insert', createMissingOptions: false, skipBlankMatchKey: false,
    });
    expect(sourceRowsToCsv([{ name: 'Ada' }, { name: '' }])).toBe(real[0].csv);
    // RECORDED, main and PR head alike: the server drops trailing rows whose
    // cells are all empty, so the preview's second row never reaches the runner.
    const server = [{ name: 'Ada' }];
    expect(server).toHaveLength(2 - 1);
  });
});
