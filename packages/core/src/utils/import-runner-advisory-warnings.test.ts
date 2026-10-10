// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22726] The import dry run copies the validate verdict's row `warnings` onto
 * the row VERBATIM — and since the preview now appends advisory validation-rule
 * hits to that array (P2), the hits reach the import report unchanged.
 *
 * The runner reads no member of a warning: an admitted value shape and an
 * advisory rule hit (which additionally names its `rule` and `severity`) ride
 * the same array, in the verdict's order. Driven against an
 * `ImportProtocolLike` double whose verdict is the shape `engine.validate`
 * answers; the end-to-end preview over a real engine is pinned in
 * `packages/objectql/src/validation/advisory-write-answer.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ValidateDataIssue } from '@objectstack/spec/api';
import { runImport, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './import-field-meta.js';

type ValidateArgs = Parameters<NonNullable<ImportProtocolLike['validateData']>>[0];

const OBJECT = 'account';
const ADMITTED: ValidateDataIssue = { field: 'parent_account', code: 'invalid_type', message: 'parent_account has an invalid lookup value' };
const RULE_HIT: ValidateDataIssue = {
  field: '_record', code: 'rule_violation', message: 'Industry should be set.',
  rule: 'industry_advised', severity: 'warning',
};
const INFO_HIT: ValidateDataIssue = {
  field: '_record', code: 'rule_violation', message: 'Noted for review.',
  rule: 'name_noted', severity: 'info',
};

const baseOpts = {
  objectName: OBJECT,
  metaMap: new Map<string, ExportFieldMeta>([['name', { name: 'name', type: 'text' }]]),
  writeMode: 'insert' as const,
  matchFields: [] as string[],
  dryRun: true,
  runAutomations: false,
  trimWhitespace: true,
  createMissingOptions: false,
  skipBlankMatchKey: false,
};

describe('[#22726] the dry run relays the verdict\'s row warnings verbatim, advisory rule hits included', () => {
  it('admissions and rule hits reach the row in the verdict\'s order, every member kept', async () => {
    const verdictWarnings = [ADMITTED, RULE_HIT, INFO_HIT];
    const validateData = vi.fn(async (args: ValidateArgs) => ({
      object: OBJECT, mode: args.mode ?? 'insert', valid: true,
      results: [{ valid: true, errors: [], warnings: verdictWarnings }],
      posture: { valueShapeStrict: false, mediaValueShapeStrict: false },
    }));
    const p: ImportProtocolLike = { findData: vi.fn(async () => []), createData: vi.fn(), updateData: vi.fn(), validateData };

    const s = await runImport({ ...baseOpts, p, rows: [{ name: 'Acme' }] });

    expect(s).toMatchObject({ ok: 1, errors: 0, created: 1 });
    expect(s.results[0]).toEqual({ row: 1, ok: true, action: 'created', warnings: [ADMITTED, RULE_HIT, INFO_HIT] });
    // Verbatim: the very elements, not a re-built copy that could drop `rule` / `severity`.
    expect(s.results[0].warnings![1]).toBe(RULE_HIT);
  });

  it('a verdict with no warning leaves the row without the key', async () => {
    const validateData = vi.fn(async (args: ValidateArgs) => ({
      object: OBJECT, mode: args.mode ?? 'insert', valid: true,
      results: [{ valid: true, errors: [], warnings: [] }],
      posture: { valueShapeStrict: false, mediaValueShapeStrict: false },
    }));
    const p: ImportProtocolLike = { findData: vi.fn(async () => []), createData: vi.fn(), updateData: vi.fn(), validateData };

    const s = await runImport({ ...baseOpts, p, rows: [{ name: 'Acme' }] });

    expect(s.results[0]).toEqual({ row: 1, ok: true, action: 'created' });
  });
});
