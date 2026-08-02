import { describe, it, expect } from 'vitest';
import {
  SortDirectionEnum,
  SortItemSchema,
  MutationEventEnum,
  IsolationLevelEnum,
} from './enums.zod';

describe('SortDirectionEnum', () => {
  it('should accept asc and desc', () => {
    expect(SortDirectionEnum.parse('asc')).toBe('asc');
    expect(SortDirectionEnum.parse('desc')).toBe('desc');
  });

  it('should reject invalid values', () => {
    expect(() => SortDirectionEnum.parse('ASC')).toThrow();
    expect(() => SortDirectionEnum.parse('DESC')).toThrow();
    expect(() => SortDirectionEnum.parse('ascending')).toThrow();
    expect(() => SortDirectionEnum.parse('')).toThrow();
  });
});

describe('SortItemSchema', () => {
  it('should accept valid sort item', () => {
    const result = SortItemSchema.parse({ field: 'created_at', order: 'desc' });
    expect(result.field).toBe('created_at');
    expect(result.order).toBe('desc');
  });

  it('should reject without field', () => {
    expect(() => SortItemSchema.parse({ order: 'asc' })).toThrow();
  });

  it('should reject without order', () => {
    expect(() => SortItemSchema.parse({ field: 'name' })).toThrow();
  });

  it('should reject invalid order direction', () => {
    expect(() => SortItemSchema.parse({ field: 'name', order: 'up' })).toThrow();
  });
});

describe('MutationEventEnum', () => {
  it('should accept all mutation events', () => {
    const valid = ['insert', 'update', 'delete', 'upsert'];
    valid.forEach((v) => {
      expect(MutationEventEnum.parse(v)).toBe(v);
    });
  });

  it('should reject invalid values', () => {
    expect(() => MutationEventEnum.parse('INSERT')).toThrow();
    expect(() => MutationEventEnum.parse('create')).toThrow();
    expect(() => MutationEventEnum.parse('remove')).toThrow();
  });
});

describe('IsolationLevelEnum', () => {
  it('should accept all isolation levels', () => {
    const valid = [
      'read_uncommitted', 'read_committed', 'repeatable_read', 'serializable', 'snapshot',
    ];
    valid.forEach((v) => {
      expect(IsolationLevelEnum.parse(v)).toBe(v);
    });
  });

  it('should reject invalid values', () => {
    expect(() => IsolationLevelEnum.parse('READ_COMMITTED')).toThrow();
    expect(() => IsolationLevelEnum.parse('read-committed')).toThrow();
    expect(() => IsolationLevelEnum.parse('none')).toThrow();
  });
});
