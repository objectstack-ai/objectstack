// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#6037 / #4633 ruling D] The validate-only DataProtocol contract.
//
// The ruling carried two clauses aimed squarely at this contract, and both are
// pinned here because both are the kind that a later edit could quietly undo:
//
//   1. the operation name must avoid the retired-key vocabulary — `validateOnly`
//      is tombstoned on `BatchOptions` (#4052) and reintroducing that spelling
//      would collide with a tombstone whose whole job is to make it audible;
//   2. the response must carry the ADR-0104 posture the verdict was reached
//      under, because option B (unconditionally strict) was rejected: a preview
//      that ignores posture fails rows the local write would have accepted.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  ValidateDataRequestSchema,
  ValidateDataResponseSchema,
  ValidateDataIssueSchema,
} from './protocol.zod';
import { BatchOptionsSchema } from './batch.zod';

describe('ValidateDataRequest (#6037)', () => {
  it('accepts a single candidate row', () => {
    const r = ValidateDataRequestSchema.safeParse({ object: 'lead', data: { company: 'Acme' } });
    expect(r.success).toBe(true);
  });

  it('accepts an array of candidate rows — the import dry-run shape', () => {
    const r = ValidateDataRequestSchema.safeParse({
      object: 'lead',
      data: [{ company: 'Acme' }, { company: 'Globex' }],
    });
    expect(r.success).toBe(true);
  });

  it('accepts both write modes and defaults to none (the engine owns the default)', () => {
    for (const mode of ['insert', 'update'] as const) {
      expect(ValidateDataRequestSchema.safeParse({ object: 'lead', data: {}, mode }).success).toBe(true);
    }
    const bare = ValidateDataRequestSchema.safeParse({ object: 'lead', data: {} });
    expect(bare.success).toBe(true);
    if (bare.success) expect(bare.data.mode).toBeUndefined();
  });

  it('rejects a mode outside the write vocabulary', () => {
    expect(ValidateDataRequestSchema.safeParse({ object: 'lead', data: {}, mode: 'upsert' }).success).toBe(false);
  });

  it('requires an object name', () => {
    expect(ValidateDataRequestSchema.safeParse({ data: {} }).success).toBe(false);
  });
});

describe('ValidateDataResponse (#6037)', () => {
  const ok = {
    object: 'lead',
    mode: 'insert' as const,
    valid: false,
    results: [{
      valid: false,
      errors: [{ field: 'company', code: 'required', message: 'company is required' }],
      warnings: [],
    }],
    posture: { valueShapeStrict: true, mediaValueShapeStrict: false },
  };

  it('accepts a per-row verdict carrying errors and warnings', () => {
    expect(ValidateDataResponseSchema.safeParse(ok).success).toBe(true);
  });

  it('requires the ADR-0104 posture — the half that makes a verdict explainable', () => {
    // Option B (unconditional strict) was rejected, so a verdict is only
    // meaningful alongside the posture it was reached under. Optional posture
    // would let an implementation quietly stop reporting it.
    const { posture, ...withoutPosture } = ok;
    expect(ValidateDataResponseSchema.safeParse(withoutPosture).success).toBe(false);
  });

  it('separates admitted findings from rejecting ones', () => {
    // A warn-first deployment ADMITS a bad value shape: the row is valid and
    // the finding is a warning. Collapsing the two buckets would erase exactly
    // the distinction the ruling turned on.
    const warned = {
      ...ok,
      valid: true,
      results: [{
        valid: true,
        errors: [],
        warnings: [{ field: 'account', code: 'invalid_type', message: 'account has an invalid lookup value: …' }],
      }],
      posture: { valueShapeStrict: false, mediaValueShapeStrict: false },
    };
    const parsed = ValidateDataResponseSchema.safeParse(warned);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.results[0].valid).toBe(true);
      expect(parsed.data.results[0].warnings).toHaveLength(1);
    }
  });

  it('uses one finding shape for both buckets', () => {
    const issue = { field: 'company', code: 'required', message: 'company is required' };
    expect(ValidateDataIssueSchema.safeParse(issue).success).toBe(true);
    // A caller diffing a preview against a rejected write reads one vocabulary.
    expect(ValidateDataIssueSchema.safeParse({ field: 'x', code: 'y' }).success).toBe(false);
  });
});

describe('the #4052 non-repeat', () => {
  it('does not reuse the retired `validateOnly` spelling', () => {
    // `BatchOptions.validateOnly` is tombstoned: it promised a dry run that
    // never existed. The new operation had to avoid that vocabulary so the
    // tombstone keeps meaning what it says.
    const keys = Object.keys((ValidateDataRequestSchema as unknown as z.ZodObject<any>).shape);
    expect(keys).not.toContain('validateOnly');
    expect(keys).toEqual(expect.arrayContaining(['object', 'data', 'mode']));
  });

  it('leaves the BatchOptions tombstone standing — this operation is not its revival', () => {
    const r = BatchOptionsSchema.safeParse({ validateOnly: true });
    expect(r.success).toBe(false);
    // And the rejection still points somewhere useful.
    expect(JSON.stringify(r.error?.issues)).toMatch(/validateOnly/);
  });
});
