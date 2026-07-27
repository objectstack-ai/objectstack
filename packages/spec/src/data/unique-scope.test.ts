// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { FieldSchema, isGlobalUnique, isUniqueDeclared } from './field.zod';
import { IndexSchema } from './object.zod';

/**
 * `unique` scope contract (#3696).
 *
 * `unique: true` means "unique within the tenant"; `unique: 'global'` means
 * "unique platform-wide". The vocabulary lives here so the SQL driver and the
 * Mongo driver read the same declaration the same way rather than each
 * re-deriving it (the drift that let three DDL paths disagree in the first
 * place).
 */
describe('UniqueScope (#3696)', () => {
  describe('FieldSchema.unique', () => {
    it('accepts true / false / global', () => {
      for (const unique of [true, false, 'global'] as const) {
        const parsed = FieldSchema.parse({ type: 'text', unique });
        expect(parsed.unique).toBe(unique);
      }
    });

    it('defaults to false', () => {
      expect(FieldSchema.parse({ type: 'text' }).unique).toBe(false);
    });

    it('rejects any other string — a typo must not silently mean "not unique"', () => {
      // `'tenant'` / `'org'` / `'globl'` are the plausible mis-spellings. Each
      // has to be a loud parse error: accepting it as truthy-but-unknown is how
      // a constraint quietly changes scope.
      for (const bad of ['tenant', 'org', 'globl', 'GLOBAL', '']) {
        expect(() => FieldSchema.parse({ type: 'text', unique: bad })).toThrow();
      }
    });
  });

  describe('IndexSchema.unique', () => {
    it('accepts true / false / global', () => {
      for (const unique of [true, false, 'global'] as const) {
        expect(IndexSchema.parse({ fields: ['a'], unique }).unique).toBe(unique);
      }
    });

    it('defaults to false', () => {
      expect(IndexSchema.parse({ fields: ['a'] }).unique).toBe(false);
    });
  });

  describe('predicates', () => {
    it('isUniqueDeclared is true for both true and global', () => {
      expect(isUniqueDeclared(true)).toBe(true);
      expect(isUniqueDeclared('global')).toBe(true);
      expect(isUniqueDeclared(false)).toBe(false);
      expect(isUniqueDeclared(undefined)).toBe(false);
    });

    it('isGlobalUnique singles out the platform-wide spelling', () => {
      expect(isGlobalUnique('global')).toBe(true);
      expect(isGlobalUnique(true)).toBe(false);
      expect(isGlobalUnique(false)).toBe(false);
      expect(isGlobalUnique(undefined)).toBe(false);
    });
  });
});
