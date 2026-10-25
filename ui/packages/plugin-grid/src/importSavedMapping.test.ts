import { describe, it, expect } from 'vitest';
import { __testables } from './ImportWizard';

const { assembleImportRequest } = __testables;

// When a named mapping is active the server owns rename + transforms + write
// semantics, so the request carries `mappingName` and OMITS the inline
// writeMode/matchFields/coercion flags (mutually exclusive per the server
// contract, framework #2611).
describe('assembleImportRequest — named mapping branch', () => {
  const rows = [{ 'Full Name': 'Ada', Channel: 'Web' }];

  it('emits mappingName + rows and drops writeMode/matchFields', () => {
    const req = assembleImportRequest(rows, {
      writeMode: 'upsert', matchFields: ['email'],
      createMissingOptions: true, skipBlankMatchKey: true,
      mappingName: 'inquiry_feed',
    });
    expect(req).toEqual({
      format: 'json',
      rows,
      mappingName: 'inquiry_feed',
    });
    expect(req).not.toHaveProperty('writeMode');
    expect(req).not.toHaveProperty('matchFields');
    expect(req).not.toHaveProperty('createMissingOptions');
  });

  it('carries dryRun through the named-mapping branch', () => {
    const req = assembleImportRequest(rows, {
      writeMode: 'insert', matchFields: [],
      createMissingOptions: false, skipBlankMatchKey: false,
      mappingName: 'inquiry_feed', dryRun: true,
    });
    expect(req.dryRun).toBe(true);
    expect(req.mappingName).toBe('inquiry_feed');
  });

  it('without mappingName, keeps the existing inline-mapping payload shape', () => {
    const req = assembleImportRequest(rows, {
      writeMode: 'upsert', matchFields: ['email'],
      createMissingOptions: false, skipBlankMatchKey: false,
    });
    expect(req.mappingName).toBeUndefined();
    expect(req.writeMode).toBe('upsert');
    expect(req.matchFields).toEqual(['email']);
  });
});

// objectui#13156 — the import door judges a named mapping's declared
// `sourceFormat` against the payload and refuses JSON rows for a csv mapping
// (`400 MAPPING_FORMAT_MISMATCH`). A csv mapping's source rows therefore travel
// as CSV text, the shape the REST door accepts for the same mapping.
describe('assembleImportRequest — the format a named mapping declares (objectui#13156)', () => {
  const rows = [
    { 'Full Name': 'Ada', Channel: 'Web' },
    { 'Full Name': 'Grace', Channel: 'Referral' },
  ];
  const opts = {
    writeMode: 'insert' as const, matchFields: [],
    createMissingOptions: false, skipBlankMatchKey: false,
    mappingName: 'inquiry_feed',
  };

  it('a csv mapping sends format csv, the rows as CSV text and mappingName, and no rows', () => {
    const req = assembleImportRequest(rows, { ...opts, mappingSourceFormat: 'csv' });
    expect(req).toEqual({
      format: 'csv',
      csv: 'Full Name,Channel\r\nAda,Web\r\nGrace,Referral',
      mappingName: 'inquiry_feed',
    });
    expect(req).not.toHaveProperty('rows');
  });

  it('a csv mapping keeps dryRun, so the pre-check judges the same payload', () => {
    const live = assembleImportRequest(rows, { ...opts, mappingSourceFormat: 'csv' });
    const dry = assembleImportRequest(rows, { ...opts, mappingSourceFormat: 'csv', dryRun: true });
    expect(dry).toEqual({ ...live, dryRun: true });
  });

  it('a json mapping, and a mapping that declares none, keep JSON rows', () => {
    for (const mappingSourceFormat of ['json', undefined] as const) {
      expect(assembleImportRequest(rows, { ...opts, mappingSourceFormat })).toEqual({
        format: 'json',
        rows,
        mappingName: 'inquiry_feed',
      });
    }
  });

  it('the manual path ignores a declared format: it has no named mapping', () => {
    const req = assembleImportRequest(rows, {
      ...opts, mappingName: undefined, mappingSourceFormat: 'csv',
    });
    expect(req.format).toBe('json');
    expect(req.rows).toEqual(rows);
    expect(req).not.toHaveProperty('csv');
  });
});

describe('sourceRowsToCsv (objectui#13156)', () => {
  const { sourceRowsToCsv } = __testables;

  it('quotes a cell holding a comma, a double quote, a CR or an LF, and nothing else', () => {
    const csv = sourceRowsToCsv([
      { Name: 'Acme, Inc.', Note: 'says "hi"', Memo: 'line 1\nline 2', Raw: 'a\rb', Plain: 'x y' },
    ]);
    expect(csv).toBe(
      'Name,Note,Memo,Raw,Plain\r\n'
      + '"Acme, Inc.","says ""hi""","line 1\nline 2","a\rb",x y',
    );
  });

  it('quotes a header the same way, and keeps empty cells as empty fields', () => {
    expect(sourceRowsToCsv([{ 'Lead, source': '', Name: 'Ada' }])).toBe('"Lead, source",Name\r\n,Ada');
  });

  it('names every column any row carries, in first-seen order', () => {
    expect(sourceRowsToCsv([{ A: '1' }, { A: '2', B: '3' }])).toBe('A,B\r\n1,\r\n2,3');
  });
});
