import { describe, it, expect } from 'vitest';
import {
  BatchOperationType,
  BatchRecordSchema,
  BatchOptionsSchema,
  BatchUpdateRequestSchema,
  UpdateManyRequestSchema,
  BatchOperationResultSchema,
  BatchUpdateResponseSchema,
  DeleteManyRequestSchema,
  BatchApiContracts,
} from './batch.zod';

describe('BatchOperationType', () => {
  it('should accept valid operation types', () => {
    expect(BatchOperationType.parse('create')).toBe('create');
    expect(BatchOperationType.parse('update')).toBe('update');
    expect(BatchOperationType.parse('upsert')).toBe('upsert');
    expect(BatchOperationType.parse('delete')).toBe('delete');
  });

  it('should reject invalid operation types', () => {
    expect(() => BatchOperationType.parse('invalid')).toThrow();
  });
});

describe('BatchRecordSchema', () => {
  it('should accept valid batch record for update', () => {
    const record = BatchRecordSchema.parse({
      id: '123',
      data: { name: 'Updated Name', status: 'active' },
    });

    expect(record.id).toBe('123');
    expect(record.data).toEqual({ name: 'Updated Name', status: 'active' });
  });

  it('should accept record with external ID for upsert', () => {
    const record = BatchRecordSchema.parse({
      data: { name: 'New Record' },
      externalId: 'ext_123',
    });

    expect(record.externalId).toBe('ext_123');
  });

  it('should accept minimal record', () => {
    const record = BatchRecordSchema.parse({});
    expect(record).toBeDefined();
  });
});

describe('BatchOptionsSchema', () => {
  it('should use default values', () => {
    const options = BatchOptionsSchema.parse({});

    // ADR-0119 D4 — `atomic` defaults to FALSE. It declared `true` for as long
    // as no batch surface honoured it; the declaration was aligned down to the
    // enforced behaviour so that opting in is explicit and nobody's failure
    // semantics changed silently.
    expect(options.atomic).toBe(false);
    expect(options.returnRecords).toBe(false);
    expect(options.continueOnError).toBe(false);
  });

  it('should accept custom options', () => {
    const options = BatchOptionsSchema.parse({
      atomic: false,
      returnRecords: true,
      continueOnError: true,
    });

    expect(options.atomic).toBe(false);
    expect(options.returnRecords).toBe(true);
    expect(options.continueOnError).toBe(true);
  });

  it('rejects the retired `validateOnly` key with its prescription (#3963 follow-up)', () => {
    // Never implemented — a "dry-run" that silently persisted. Tombstoned so
    // writing it is audible rather than silently stripped (ADR-0104 / PD #10).
    const result = BatchOptionsSchema.safeParse({ validateOnly: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/validateOnly.*removed|never implemented/i);
    }
  });
});

describe('BatchUpdateRequestSchema', () => {
  it('should accept valid batch update request', () => {
    const request = BatchUpdateRequestSchema.parse({
      operation: 'update',
      records: [
        { id: '1', data: { name: 'Name 1' } },
        { id: '2', data: { name: 'Name 2' } },
      ],
      options: {
        atomic: true,
        returnRecords: true,
      },
    });

    expect(request.operation).toBe('update');
    expect(request.records).toHaveLength(2);
    expect(request.options?.atomic).toBe(true);
  });

  // [#3939] The count bounds moved OUT of the schema. They were a second source
  // of truth that never matched reality: the schema said 1..200 while the routes
  // enforced nothing, and the one route that did cap read the deployment's
  // configured `batch.maxBatchSize` (1..1000) instead. The cap is now enforced
  // at the route from that config, and the schema carries shape only.
  it('accepts an empty record list — an empty batch is a no-op, not a client error', () => {
    expect(() =>
      BatchUpdateRequestSchema.parse({
        operation: 'create',
        records: [],
      })
    ).not.toThrow();
  });

  it('does not cap the record count — that is the route\'s job (batch.maxBatchSize)', () => {
    const records = Array(201)
      .fill(null)
      .map((_, i) => ({ id: String(i), data: {} }));

    expect(() =>
      BatchUpdateRequestSchema.parse({
        operation: 'update',
        records,
      })
    ).not.toThrow();
  });

  it('should accept exactly 200 records', () => {
    const records = Array(200)
      .fill(null)
      .map((_, i) => ({ id: String(i), data: {} }));

    const request = BatchUpdateRequestSchema.parse({
      operation: 'update',
      records,
    });

    expect(request.records).toHaveLength(200);
  });
});

describe('UpdateManyRequestSchema', () => {
  it('should accept valid updateMany request', () => {
    const request = UpdateManyRequestSchema.parse({
      records: [
        { id: '1', data: { name: 'Updated 1' } },
        { id: '2', data: { name: 'Updated 2' } },
      ],
      options: { atomic: true },
    });

    expect(request.records).toHaveLength(2);
    expect(request.options?.atomic).toBe(true);
  });

  it('should work without options', () => {
    const request = UpdateManyRequestSchema.parse({
      records: [{ id: '1', data: { name: 'Updated' } }],
    });

    expect(request.records).toHaveLength(1);
    expect(request.options).toBeUndefined();
  });

  // [#3939] This schema used to reuse `BatchRecordSchema`, whose `id`/`data` are
  // optional because the generic /batch route serves create (no id) and delete
  // (no data) through it. updateMany needs both on every row — `updateManyData`
  // reads them unconditionally — so the declared contract accepted rows the
  // implementation could not process.
  it('requires id AND data on every row', () => {
    expect(() => UpdateManyRequestSchema.parse({ records: [{}] })).toThrow();
    expect(() => UpdateManyRequestSchema.parse({ records: [{ id: '1' }] })).toThrow();
    expect(() => UpdateManyRequestSchema.parse({ records: [{ data: { name: 'x' } }] })).toThrow();
  });
});

// [#3939] Prime Directive #7 — one Zod source per contract. The protocol-level
// request schemas ARE the wire-body schemas plus the `object` the REST route
// takes from the URL path (#3933). They used to be hand-maintained copies that
// had already drifted: batch.zod's accepted `{}` rows, protocol.zod's required
// id+data, and only the latter was ever enforced. Pin the relationship so a
// future edit to one cannot silently fork them again.
describe('protocol request schemas derive from the wire-body schemas (#3939)', () => {
  it('updateMany: same record shape, plus object', async () => {
    const { UpdateManyDataRequestSchema } = await import('./protocol.zod');
    const records = [{ id: '1', data: { name: 'x' } }];

    expect(() => UpdateManyDataRequestSchema.parse({ object: 'task', records })).not.toThrow();
    // The object is required here and absent from the body schema.
    expect(() => UpdateManyDataRequestSchema.parse({ records })).toThrow();
    // Row shape is inherited, not re-declared.
    expect(() => UpdateManyDataRequestSchema.parse({ object: 'task', records: [{ id: '1' }] })).toThrow();
  });

  it('deleteMany: same ids shape, plus object', async () => {
    const { DeleteManyDataRequestSchema } = await import('./protocol.zod');

    expect(() => DeleteManyDataRequestSchema.parse({ object: 'task', ids: ['1'] })).not.toThrow();
    expect(() => DeleteManyDataRequestSchema.parse({ ids: ['1'] })).toThrow();
    expect(() => DeleteManyDataRequestSchema.parse({ object: 'task', ids: [{ $ne: null }] })).toThrow();
    // No count bound inherited either — the route owns that.
    expect(() => DeleteManyDataRequestSchema.parse({
      object: 'task',
      ids: Array(201).fill(null).map((_, i) => String(i)),
    })).not.toThrow();
  });
});

describe('BatchOperationResultSchema', () => {
  it('should accept successful result', () => {
    const result = BatchOperationResultSchema.parse({
      id: '123',
      success: true,
      index: 0,
    });

    expect(result.success).toBe(true);
    expect(result.id).toBe('123');
    expect(result.errors).toBeUndefined();
  });

  it('should accept failed result with errors', () => {
    const result = BatchOperationResultSchema.parse({
      success: false,
      index: 1,
      errors: [
        {
          code: 'VALIDATION_ERROR',
          message: 'Invalid email format',
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0].code).toBe('VALIDATION_ERROR');
  });

  it('should accept result with full record data', () => {
    const result = BatchOperationResultSchema.parse({
      id: '123',
      success: true,
      data: { id: '123', name: 'Test Record', status: 'active' },
      index: 0,
    });

    expect(result.data).toBeDefined();
    expect(result.data?.name).toBe('Test Record');
  });
});

describe('BatchUpdateResponseSchema', () => {
  it('should accept successful batch response', () => {
    const response = BatchUpdateResponseSchema.parse({
      success: true,
      operation: 'update',
      total: 2,
      succeeded: 2,
      failed: 0,
      results: [
        { id: '1', success: true, index: 0 },
        { id: '2', success: true, index: 1 },
      ],
      meta: {
        timestamp: '2026-01-29T12:00:00Z',
        duration: 150,
      },
    });

    expect(response.success).toBe(true);
    expect(response.total).toBe(2);
    expect(response.succeeded).toBe(2);
    expect(response.failed).toBe(0);
  });

  it('should accept partial success response', () => {
    const response = BatchUpdateResponseSchema.parse({
      success: false,
      operation: 'update',
      total: 2,
      succeeded: 1,
      failed: 1,
      results: [
        { id: '1', success: true, index: 0 },
        {
          success: false,
          index: 1,
          errors: [{ code: 'VALIDATION_ERROR', message: 'Invalid data' }],
        },
      ],
    });

    expect(response.success).toBe(false);
    expect(response.succeeded).toBe(1);
    expect(response.failed).toBe(1);
  });

  it('should accept response with error details', () => {
    const response = BatchUpdateResponseSchema.parse({
      success: false,
      operation: 'create',
      total: 1,
      succeeded: 0,
      failed: 1,
      results: [
        {
          success: false,
          index: 0,
          errors: [
            {
              code: 'DUPLICATE_VALUE',
              message: 'Record already exists',
              details: { field: 'email', value: 'test@example.com' },
            },
          ],
        },
      ],
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Batch operation failed',
      },
    });

    expect(response.failed).toBe(1);
    expect(response.error?.code).toBe('INTERNAL_ERROR');
  });
});

describe('DeleteManyRequestSchema', () => {
  it('should accept valid delete request', () => {
    const request = DeleteManyRequestSchema.parse({
      ids: ['1', '2', '3'],
      options: { atomic: true },
    });

    expect(request.ids).toHaveLength(3);
    expect(request.options?.atomic).toBe(true);
  });

  // [#3939] See BatchUpdateRequestSchema above — bounds live at the route now.
  it('accepts an empty ID list — deleting nothing is a no-op, not an error', () => {
    expect(() =>
      DeleteManyRequestSchema.parse({
        ids: [],
      })
    ).not.toThrow();
  });

  it('does not cap the ID count — that is the route\'s job (batch.maxBatchSize)', () => {
    const ids = Array(201)
      .fill(null)
      .map((_, i) => String(i));

    expect(() =>
      DeleteManyRequestSchema.parse({
        ids,
      })
    ).not.toThrow();
  });
});

describe('BatchApiContracts', () => {
  it('should have correct contract structure', () => {
    expect(BatchApiContracts.batchOperation).toBeDefined();
    expect(BatchApiContracts.batchOperation.input).toBeDefined();
    expect(BatchApiContracts.batchOperation.output).toBeDefined();

    expect(BatchApiContracts.updateMany).toBeDefined();
    expect(BatchApiContracts.deleteMany).toBeDefined();
  });

  it('should validate batchOperation contract', () => {
    const input = {
      operation: 'update',
      records: [{ id: '1', data: { name: 'Test' } }],
    };

    const parsedInput = BatchApiContracts.batchOperation.input.parse(input);
    expect(parsedInput.operation).toBe('update');
  });

  it('should validate updateMany contract', () => {
    const input = {
      records: [{ id: '1', data: { name: 'Test' } }],
    };

    const parsedInput = BatchApiContracts.updateMany.input.parse(input);
    expect(parsedInput.records).toHaveLength(1);
  });
});
