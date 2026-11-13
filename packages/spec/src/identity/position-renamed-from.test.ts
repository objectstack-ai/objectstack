// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32983, ruling A1 (record 6841971722), condition 3] A position's
 * `renamedFrom` follows the position-name grammar and the field `renamedFrom`
 * refusals (cloud#3652 D3, `refuseDishonestRenamedFrom` in `data/object.zod.ts`): never
 * the position's own name, each entry once, never a name another position of
 * the collection still declares (which rules out a cycle), never an old name
 * two positions claim. Each rule is pinned both ways: the refusal, and the
 * honest declaration beside it parsing clean.
 */

import { describe, it, expect } from 'vitest';
import { PositionSchema } from './position.zod';
import { ObjectStackDefinitionSchema } from '../stack.zod';

const pos = (name: string, renamedFrom?: unknown) => ({ name, label: name, ...(renamedFrom === undefined ? {} : { renamedFrom }) });

/** The `renamedFrom` issues of one parse, each as `path :: message`. */
function renamedFromIssues(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }): string[] {
  if (result.success) return [];
  return result.error!.issues
    .filter((i) => i.path.includes('renamedFrom'))
    .map((i) => `${i.path.join('.')} :: ${i.message}`);
}

const parseStack = (positions: unknown[]) => ObjectStackDefinitionSchema.safeParse({ positions });

describe('a position declares the names it had before', () => {
  it('an honest rename parses, and the key is kept (not stripped)', () => {
    const parsed = PositionSchema.parse(pos('crm_sales_rep', ['sales_rep']));
    expect(parsed.renamedFrom).toEqual(['sales_rep']);
  });

  it('a position renamed twice lists both earlier names', () => {
    expect(PositionSchema.safeParse(pos('crm_sales_rep', ['sales_rep', 'rep'])).success).toBe(true);
  });

  it('the key is optional: a position without it parses as before', () => {
    const parsed = PositionSchema.parse(pos('crm_sales_rep'));
    expect(parsed).not.toHaveProperty('renamedFrom');
  });
});

describe('each entry is a position name (the position-name grammar)', () => {
  it.each([
    ['CamelCase', 'SalesRep'],
    ['a leading underscore (field keys allow it, position names do not)', '_sales_rep'],
    ['a leading digit', '1st_rep'],
    ['one character', 'r'],
    ['a space', 'sales rep'],
  ])('refuses %s', (_label, entry) => {
    const result = PositionSchema.safeParse(pos('crm_sales_rep', [entry]));
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.path.join('.') === 'renamedFrom.0')).toBe(true);
  });

  it('refuses a bare string: the key is a list', () => {
    const result = PositionSchema.safeParse(pos('crm_sales_rep', 'sales_rep'));
    expect(result.success).toBe(false);
    expect(result.error!.issues.find((i) => i.path.join('.') === 'renamedFrom')?.code).toBe('invalid_type');
  });
});

describe('one position alone: never its own name, each entry once', () => {
  it("refuses the position's own name, located at the entry and naming it", () => {
    const issues = renamedFromIssues(PositionSchema.safeParse(pos('crm_sales_rep', ['crm_sales_rep'])));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^renamedFrom\.0 :: Position `crm_sales_rep` declares `renamedFrom` entry 'crm_sales_rep', which is the position's own name/);
  });

  it('refuses a repeated entry on the second occurrence only', () => {
    const issues = renamedFromIssues(PositionSchema.safeParse(pos('crm_sales_rep', ['sales_rep', 'sales_rep'])));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^renamedFrom\.1 :: .*which an earlier entry of the same list already names/);
  });
});

describe('the collection: never a name still declared, never one old name claimed twice', () => {
  it('two honest renames in one collection parse', () => {
    expect(parseStack([pos('crm_sales_rep', ['sales_rep']), pos('crm_sales_manager', ['sales_manager'])]).success).toBe(true);
  });

  it('refuses an old name another position still declares, naming it', () => {
    const issues = renamedFromIssues(parseStack([pos('crm_sales_rep', ['sales_rep']), pos('sales_rep')]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^positions\.0\.renamedFrom\.0 :: .*but a position named `sales_rep` is still declared/);
  });

  it('refuses a cycle: every name in it is still declared', () => {
    const issues = renamedFromIssues(parseStack([pos('a_rep', ['b_rep']), pos('b_rep', ['a_rep'])]));
    expect(issues.map((i) => i.split(' :: ')[0])).toEqual(['positions.0.renamedFrom.0', 'positions.1.renamedFrom.0']);
  });

  it('refuses the second claimant of one old name, naming the first', () => {
    const issues = renamedFromIssues(parseStack([pos('crm_sales_rep', ['sales_rep']), pos('crm_field_rep', ['sales_rep'])]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^positions\.1\.renamedFrom\.0 :: Position `crm_field_rep` .*which position `crm_sales_rep` already claims/);
  });
});
