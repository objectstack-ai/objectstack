// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { FieldSchema, isGlobalUnique, isOrganizationUnique, isUniqueDeclared } from './field.zod';
import { IndexSchema } from './object.zod';

/**
 * `unique` scope contract (#3696, ADR-0120 D1).
 *
 * The scope of a unique constraint is said, never inferred from position:
 * `'organization'` = one holder per organization (field-level `true` is its
 * positional synonym, valid indefinitely), `'global'` = one holder across the
 * whole installation. The vocabulary lives here so the SQL driver and the
 * Mongo driver read the same declaration the same way rather than each
 * re-deriving it (the drift that let three DDL paths disagree in the first
 * place). Rejected words carry the fix: `'tenant'`/`'org'` name
 * `'organization'` in the parse error (ADR-0120 §Terminology).
 */
describe('UniqueScope (#3696, ADR-0120)', () => {
  describe('FieldSchema.unique', () => {
    it("accepts true / false / 'global' / 'organization'", () => {
      for (const unique of [true, false, 'global', 'organization'] as const) {
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
      for (const bad of ['tenant', 'org', 'globl', 'GLOBAL', 'ORGANIZATION', '']) {
        expect(() => FieldSchema.parse({ type: 'text', unique: bad })).toThrow();
      }
    });

    it("names 'organization' in the rejection for 'tenant' and 'org' — no alias, prescriptive error (ADR-0120 §Terminology)", () => {
      for (const bad of ['tenant', 'org']) {
        try {
          FieldSchema.parse({ type: 'text', unique: bad });
          expect.unreachable(`'${bad}' must not parse`);
        } catch (e) {
          const message = JSON.stringify((e as { issues?: unknown }).issues ?? String(e));
          expect(message).toContain("'organization'");
          expect(message).toContain('not an alias');
        }
      }
    });

    it('carries the full vocabulary in every scope rejection, so the fix ships inside the error', () => {
      try {
        FieldSchema.parse({ type: 'text', unique: 'globl' });
        expect.unreachable("'globl' must not parse");
      } catch (e) {
        const message = JSON.stringify((e as { issues?: unknown }).issues ?? String(e));
        expect(message).toContain("'global'");
        expect(message).toContain("'organization'");
      }
    });
  });

  describe('IndexSchema.unique', () => {
    it("accepts true / false / 'global' / 'organization'", () => {
      for (const unique of [true, false, 'global', 'organization'] as const) {
        expect(IndexSchema.parse({ fields: ['a'], unique }).unique).toBe(unique);
      }
    });

    it('defaults to false', () => {
      expect(IndexSchema.parse({ fields: ['a'] }).unique).toBe(false);
    });

    it("rejects 'tenant' with the 'organization' prescription, matching the field-level error", () => {
      try {
        IndexSchema.parse({ fields: ['a'], unique: 'tenant' });
        expect.unreachable("'tenant' must not parse");
      } catch (e) {
        const message = JSON.stringify((e as { issues?: unknown }).issues ?? String(e));
        expect(message).toContain("'organization'");
      }
    });
  });

  describe('predicates', () => {
    it("isUniqueDeclared is true for true, 'global' and 'organization' — the new word must never be declarable-but-inert (ADR-0078)", () => {
      expect(isUniqueDeclared(true)).toBe(true);
      expect(isUniqueDeclared('global')).toBe(true);
      expect(isUniqueDeclared('organization')).toBe(true);
      expect(isUniqueDeclared(false)).toBe(false);
      expect(isUniqueDeclared(undefined)).toBe(false);
    });

    it('isGlobalUnique singles out the platform-wide spelling — unchanged by ADR-0120', () => {
      expect(isGlobalUnique('global')).toBe(true);
      expect(isGlobalUnique(true)).toBe(false);
      expect(isGlobalUnique(false)).toBe(false);
      expect(isGlobalUnique('organization')).toBe(false);
      expect(isGlobalUnique(undefined)).toBe(false);
    });

    it("isOrganizationUnique detects the explicit word only — field-level bare true stays the drivers' isUniqueDeclared && !isGlobalUnique path", () => {
      expect(isOrganizationUnique('organization')).toBe(true);
      expect(isOrganizationUnique(true)).toBe(false);
      expect(isOrganizationUnique('global')).toBe(false);
      expect(isOrganizationUnique(false)).toBe(false);
      expect(isOrganizationUnique(undefined)).toBe(false);
    });

    it("field-level 'organization' is a pure synonym of true through the driver predicates — declared, non-global (ADR-0120 D1)", () => {
      // The pair every driver consults: same answers for `true` and
      // `'organization'` = same materialization, which is the "explicit
      // synonym, zero semantic change" contract.
      for (const spelling of [true, 'organization'] as const) {
        expect(isUniqueDeclared(spelling)).toBe(true);
        expect(isGlobalUnique(spelling)).toBe(false);
      }
    });
  });
});
