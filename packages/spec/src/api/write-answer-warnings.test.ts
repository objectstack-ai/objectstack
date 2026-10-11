// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22726] The advisory-warnings write answer, at the contract.
 *
 * One element, two channels: the engine reports a hit as a
 * `ValidationAdvisoryEvent` (`data/data-engine.zod.ts`), and the write answers
 * and the validate-only preview carry it as a `ValidateDataIssue`. These pins
 * hold the two together — an event IS an issue — and hold the answers'
 * `warnings` optional (omit-when-empty, so an existing client's reading of an
 * answer does not move).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  CreateDataResponseSchema,
  UpdateDataResponseSchema,
  CloneDataResponseSchema,
  ValidateDataIssueSchema,
  ValidateDataResponseSchema,
} from './protocol.zod';
import { ValidationAdvisoryEventSchema, type ValidationAdvisoryEvent } from '../data/data-engine.zod';
import type { WriteObservabilityOptions } from '../contracts/data-engine';

const HIT: ValidationAdvisoryEvent = {
  rule: 'industry_advised',
  severity: 'warning',
  field: '_record',
  code: 'rule_violation',
  message: 'Industry should be set.',
};

const shapeKeys = (schema: unknown) => Object.keys((schema as { shape: Record<string, unknown> }).shape);

describe('[#22726] an advisory event IS a ValidateDataIssue', () => {
  it('every event member is an issue member, and an event parses as an issue unchanged', () => {
    const issueKeys = new Set(shapeKeys(ValidateDataIssueSchema));
    expect(shapeKeys(ValidationAdvisoryEventSchema).filter((k) => !issueKeys.has(k))).toEqual([]);
    expect(ValidateDataIssueSchema.parse(HIT)).toEqual(HIT);
  });

  it('`severity` is advisory only: `error` is refused on both, since an error rule refuses the write instead', () => {
    expect(ValidationAdvisoryEventSchema.safeParse({ ...HIT, severity: 'error' }).success).toBe(false);
    expect(ValidateDataIssueSchema.safeParse({ ...HIT, severity: 'error' }).success).toBe(false);
    expect(ValidationAdvisoryEventSchema.safeParse({ ...HIT, severity: 'info' }).success).toBe(true);
  });

  it('`rule` and `severity` stay optional on an issue: a value-shape admission or a refusal still parses', () => {
    expect(ValidateDataIssueSchema.safeParse({ field: 'email', code: 'invalid_type', message: 'bad' }).success).toBe(true);
  });
});

describe('[#22726] the write answers declare an optional `warnings` of issues', () => {
  const base = { object: 'account', id: 'a1', record: { id: 'a1' } };

  it.each([
    ['CreateDataResponseSchema', CreateDataResponseSchema, base],
    ['UpdateDataResponseSchema', UpdateDataResponseSchema, base],
    ['CloneDataResponseSchema', CloneDataResponseSchema, { ...base, sourceId: 'a0' }],
  ] as const)('%s accepts the hits, and an answer with no key', (_name, schema, answer) => {
    expect(schema.safeParse({ ...answer, warnings: [HIT] })).toMatchObject({ success: true, data: { warnings: [HIT] } });
    expect(schema.safeParse(answer).success).toBe(true);
    expect(schema.safeParse({ ...answer, warnings: [{ ...HIT, severity: 'error' }] }).success).toBe(false);
  });

  it('the preview row keeps its required `warnings` array, now holding both populations', () => {
    const verdict = {
      object: 'account', mode: 'insert', valid: true,
      results: [{
        valid: true, errors: [],
        warnings: [{ field: 'parent', code: 'invalid_type', message: 'admitted' }, HIT],
      }],
      posture: { valueShapeStrict: false, mediaValueShapeStrict: false },
    };
    expect(ValidateDataResponseSchema.safeParse(verdict).success).toBe(true);
  });
});

describe('[#22726] the listener is declared on the in-process write contract', () => {
  it('`onValidationAdvisory` takes the event; absent stays legal', () => {
    const seen: ValidationAdvisoryEvent[] = [];
    const opts: WriteObservabilityOptions = { onValidationAdvisory: (e) => { seen.push(e); } };
    opts.onValidationAdvisory?.(HIT);
    expect(seen).toEqual([HIT]);
    const unset: WriteObservabilityOptions = {};
    expect(unset.onValidationAdvisory).toBeUndefined();
  });
});

describe('[#22726] the answers load under eager schema construction', () => {
  const prev = process.env.OS_EAGER_SCHEMAS;
  afterEach(() => {
    if (prev === undefined) delete process.env.OS_EAGER_SCHEMAS;
    else process.env.OS_EAGER_SCHEMAS = prev;
    vi.resetModules();
  });

  it('OS_EAGER_SCHEMAS=1 builds the write answers, which read ValidateDataIssueSchema, without a TDZ fault', async () => {
    process.env.OS_EAGER_SCHEMAS = '1';
    vi.resetModules();
    const mod = await import('./protocol.zod');
    expect(mod.CreateDataResponseSchema.safeParse({
      object: 'account', id: 'a1', record: {}, warnings: [HIT],
    }).success).toBe(true);
  });
});
