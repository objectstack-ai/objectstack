// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20987] `jsonMembershipCandidates` and `jsonMembershipPredicate` — the one
 * `$contains` membership construct `driver-sql` and the analytics read scope
 * and `where` ask, moved here from `driver-sql`, where commit e04a0aff2 wrote it.
 *
 * What each face does with the SQL is pinned in its own package (the driver's
 * move proof `sql-driver-20987-json-membership-move.test.ts`, its executed
 * three-dialect suite `sql-driver-17590-json-column-membership.test.ts`, and
 * the analytics `contains-membership.test.ts`). This file pins the function's
 * own contract: the candidate set, the construct per dialect, and that the
 * emitters are called left to right, in placeholder order, or not at all.
 */

import { describe, it, expect } from 'vitest';
import { jsonMembershipCandidates, jsonMembershipPredicate, type JsonMembershipEmitters } from './json-membership-sql';

/** Emitters that render `C` for the column and `?` for a value, recording each call in order. */
function recording(): { emit: JsonMembershipEmitters; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    emit: {
      column: () => {
        calls.push('column');
        return 'C';
      },
      value: (v) => {
        calls.push(`value ${v}`);
        return '?';
      },
    },
  };
}

describe('[#20987] jsonMembershipCandidates — the JSON scalars one comparand denotes', () => {
  it('a plain string denotes one JSON string', () => {
    expect(jsonMembershipCandidates('u1')).toEqual(['"u1"']);
  });

  it('a string JSON must escape is escaped', () => {
    expect(jsonMembershipCandidates('say "hi"')).toEqual(['"say \\"hi\\""']);
  });

  it('true / false / null also denote their JSON literal', () => {
    expect(jsonMembershipCandidates('true')).toEqual(['"true"', 'true']);
    expect(jsonMembershipCandidates('false')).toEqual(['"false"', 'false']);
    expect(jsonMembershipCandidates('null')).toEqual(['"null"', 'null']);
  });

  it('a JSON number also denotes the number, canonicalised', () => {
    expect(jsonMembershipCandidates('7')).toEqual(['"7"', '7']);
    expect(jsonMembershipCandidates('1.50')).toEqual(['"1.50"', '1.5']);
    expect(jsonMembershipCandidates(10)).toEqual(['"10"', '10']);
  });

  it('a string Number() accepts but the JSON number grammar refuses denotes the string only', () => {
    for (const text of ['0x10', ' 1 ', 'Infinity', '', '01', '1.']) {
      expect(jsonMembershipCandidates(text), JSON.stringify(text)).toEqual([JSON.stringify(text)]);
    }
  });
});

describe('[#20987] jsonMembershipPredicate — the construct per dialect, through the caller\'s emitters', () => {
  it('sqlite: a json_each element scan, the column twice then the value, per candidate', () => {
    const { emit, calls } = recording();
    expect(jsonMembershipPredicate('sqlite', emit, 'u1')).toBe(
      "(EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(C) THEN C ELSE '[]' END) AS os_member "
        + "WHERE typeof(os_member.key) = 'integer' AND CASE os_member.type "
        + "WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' WHEN 'null' THEN 'null' "
        + 'ELSE json_quote(os_member.value) END = ?))',
    );
    expect(calls).toEqual(['column', 'column', 'value "u1"']);
  });

  it('postgres: jsonb containment of the array-wrapped candidate', () => {
    const { emit, calls } = recording();
    expect(jsonMembershipPredicate('postgres', emit, 'u1')).toBe('(C::jsonb @> ?::jsonb)');
    expect(calls).toEqual(['column', 'value ["u1"]']);
  });

  it('mysql: JSON_CONTAINS of the array-wrapped candidate', () => {
    const { emit, calls } = recording();
    expect(jsonMembershipPredicate('mysql', emit, 'u1')).toBe('(JSON_CONTAINS(C, ?))');
    expect(calls).toEqual(['column', 'value ["u1"]']);
  });

  it('two candidates are OR-ed inside one pair of parentheses, emitted left to right', () => {
    const { emit, calls } = recording();
    expect(jsonMembershipPredicate('postgres', emit, '1.50')).toBe('(C::jsonb @> ?::jsonb OR C::jsonb @> ?::jsonb)');
    expect(calls).toEqual(['column', 'value ["1.50"]', 'column', 'value [1.5]']);
  });

  it("'unknown' answers null and calls neither emitter", () => {
    const { emit, calls } = recording();
    expect(jsonMembershipPredicate('unknown', emit, 'true')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('a positional caller binds in placeholder order', () => {
    const params: unknown[] = [];
    const sql = jsonMembershipPredicate(
      'postgres',
      { column: () => '"t"."tags"', value: (v) => { params.push(v); return `$${params.length}`; } },
      'true',
    );
    expect(sql).toBe('("t"."tags"::jsonb @> $1::jsonb OR "t"."tags"::jsonb @> $2::jsonb)');
    expect(params).toEqual(['["true"]', '[true]']);
  });
});
