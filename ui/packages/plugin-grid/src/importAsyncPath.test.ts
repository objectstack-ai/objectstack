import { describe, it, expect } from 'vitest';
import { __testables } from './ImportWizard';
import type { ImportJobResultsInfo } from '@object-ui/types';

const { isUnsupportedImportJob, isImportNotAllowed, jobResultToImportResult } = __testables;

describe('isImportNotAllowed (#3391)', () => {
  it('matches the framework OBJECT_API_METHOD_NOT_ALLOWED code', () => {
    expect(isImportNotAllowed({ code: 'OBJECT_API_METHOD_NOT_ALLOWED' })).toBe(true);
  });

  it('matches a 405 on status / statusCode / httpStatus', () => {
    expect(isImportNotAllowed({ status: 405 })).toBe(true);
    expect(isImportNotAllowed({ statusCode: 405 })).toBe(true);
    expect(isImportNotAllowed({ httpStatus: 405 })).toBe(true);
  });

  it('matches a bare 405 / "method not allowed" message', () => {
    expect(isImportNotAllowed(new Error('Request failed with status 405'))).toBe(true);
    expect(isImportNotAllowed(new Error('405 Method Not Allowed'))).toBe(true);
    expect(isImportNotAllowed('Method Not Allowed')).toBe(true);
  });

  it('does NOT match a 404 (route absent → sync fallback) or UNSUPPORTED_OPERATION', () => {
    expect(isImportNotAllowed(new Error('POST /data/task/import/jobs 404 Not Found'))).toBe(false);
    expect(isImportNotAllowed({ code: 'UNSUPPORTED_OPERATION' })).toBe(false);
    expect(isImportNotAllowed(new Error('Row 3: value out of range'))).toBe(false);
    expect(isImportNotAllowed(null)).toBe(false);
    expect(isImportNotAllowed(undefined)).toBe(false);
  });

  it('405 wins over the 404/regex fall-back predicates (checked first at every catch site)', () => {
    // A 405 must be classified as "not allowed", never as "unsupported job route".
    const err405 = { code: 'OBJECT_API_METHOD_NOT_ALLOWED', status: 405 };
    expect(isImportNotAllowed(err405)).toBe(true);
    expect(isUnsupportedImportJob(err405)).toBe(false);
    // Conversely a 404 is "unsupported" and NOT "not allowed".
    const err404 = new Error('import/jobs 404');
    expect(isUnsupportedImportJob(err404)).toBe(true);
    expect(isImportNotAllowed(err404)).toBe(false);
  });
});

describe('isUnsupportedImportJob', () => {
  it('matches the adapter UNSUPPORTED_OPERATION code', () => {
    expect(isUnsupportedImportJob({ code: 'UNSUPPORTED_OPERATION' })).toBe(true);
  });

  it('matches a "createImportJob is not a function" message', () => {
    expect(isUnsupportedImportJob(new Error('dataSource.createImportJob is not a function'))).toBe(true);
  });

  it('matches a 404 / missing import/jobs route (older server)', () => {
    expect(isUnsupportedImportJob(new Error('POST /data/task/import/jobs 404 Not Found'))).toBe(true);
    expect(isUnsupportedImportJob(new Error('Request failed with status 404'))).toBe(true);
  });

  it('does NOT match a genuine server/validation error', () => {
    expect(isUnsupportedImportJob(new Error('Row 3: value out of range'))).toBe(false);
    expect(isUnsupportedImportJob({ code: 'PAYLOAD_TOO_LARGE' })).toBe(false);
    expect(isUnsupportedImportJob(null)).toBe(false);
    expect(isUnsupportedImportJob(undefined)).toBe(false);
  });
});

describe('jobResultToImportResult', () => {
  const base: ImportJobResultsInfo = {
    jobId: 'imp_1',
    object: 'task',
    status: 'succeeded',
    total: 5,
    processed: 5,
    created: 3,
    updated: 1,
    skipped: 0,
    errors: 1,
    percentComplete: 100,
    resultsTruncated: false,
    results: [
      { row: 1, ok: true, action: 'created', id: 'a' },
      { row: 2, ok: true, action: 'created', id: 'b' },
      { row: 3, ok: true, action: 'created', id: 'c' },
      { row: 4, ok: true, action: 'updated', id: 'd' },
      { row: 5, ok: false, action: 'failed', field: 'amount', error: 'not a number', code: 'COERCE' },
    ],
  };

  it('maps job counters onto the wizard ImportResult shape (created+updated = imported)', () => {
    const r = jobResultToImportResult(base);
    expect(r.totalRows).toBe(5);
    expect(r.importedRows).toBe(4); // created 3 + updated 1
    expect(r.createdRows).toBe(3);
    expect(r.updatedRows).toBe(1);
    expect(r.skippedRows).toBe(1); // skipped 0 + errors 1
    expect(r.resultsTruncated).toBe(false);
  });

  it('projects only failed rows into the errors list, preferring error over code (and carrying the code for localization)', () => {
    const r = jobResultToImportResult(base);
    expect(r.errors).toEqual([{ row: 5, field: 'amount', message: 'not a number', code: 'COERCE' }]);
  });

  it('carries the resultsTruncated flag through when the server capped the report', () => {
    const r = jobResultToImportResult({ ...base, resultsTruncated: true, results: [] });
    expect(r.resultsTruncated).toBe(true);
    expect(r.errors).toEqual([]);
  });
});
