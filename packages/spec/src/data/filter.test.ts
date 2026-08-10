import { describe, it, expect } from 'vitest';
import {
  FilterConditionSchema,
  QueryFilterSchema,
  FieldOperatorsSchema,
  EqualityOperatorSchema,
  ComparisonOperatorSchema,
  SetOperatorSchema,
  RangeOperatorSchema,
  StringOperatorSchema,
  SpecialOperatorSchema,
  NormalizedFilterSchema,
  FILTER_OPERATORS,
  LOGICAL_OPERATORS,
  ALL_OPERATORS,
  parseFilterAST,
  isFilterAST,
  VALID_AST_OPERATORS,
  type Filter,
  type QueryFilter,
  type FieldOperators,
} from './filter.zod';

// ============================================================================
// 3.1 Comparison Operators Tests
// ============================================================================

describe('EqualityOperatorSchema', () => {
  it('should accept $eq operator', () => {
    const filter = { $eq: 'active' };
    expect(() => EqualityOperatorSchema.parse(filter)).not.toThrow();
  });

  it('should accept $ne operator', () => {
    const filter = { $ne: 'inactive' };
    expect(() => EqualityOperatorSchema.parse(filter)).not.toThrow();
  });

  it('should accept any data type', () => {
    expect(() => EqualityOperatorSchema.parse({ $eq: 'string' })).not.toThrow();
    expect(() => EqualityOperatorSchema.parse({ $eq: 123 })).not.toThrow();
    expect(() => EqualityOperatorSchema.parse({ $eq: true })).not.toThrow();
    expect(() => EqualityOperatorSchema.parse({ $eq: null })).not.toThrow();
  });
});

describe('ComparisonOperatorSchema', () => {
  it('should accept numeric comparisons', () => {
    expect(() => ComparisonOperatorSchema.parse({ $gt: 18 })).not.toThrow();
    expect(() => ComparisonOperatorSchema.parse({ $gte: 21 })).not.toThrow();
    expect(() => ComparisonOperatorSchema.parse({ $lt: 100 })).not.toThrow();
    expect(() => ComparisonOperatorSchema.parse({ $lte: 99 })).not.toThrow();
  });

  it('should accept date comparisons', () => {
    const date = new Date('2024-01-01');
    expect(() => ComparisonOperatorSchema.parse({ $gt: date })).not.toThrow();
    expect(() => ComparisonOperatorSchema.parse({ $gte: date })).not.toThrow();
    expect(() => ComparisonOperatorSchema.parse({ $lt: date })).not.toThrow();
    expect(() => ComparisonOperatorSchema.parse({ $lte: date })).not.toThrow();
  });

  // ==========================================================================
  // #5685 — the four slots accept the STRING the platform itself produces.
  //
  // Before this was pinned the union was `number | Date | FieldReference`, so
  // every shape below threw — including the date-macro resolver's own
  // documented output. These are the exact spellings the producers emit; see
  // `ComparisonOperatorSchema`'s docblock for why the union is a bare `string`
  // rather than an ISO refinement.
  // ==========================================================================

  describe('string comparands (#5685)', () => {
    const OPS = ['$gt', '$gte', '$lt', '$lte'] as const;

    /** `resolveFilterTokens` returns `asYmd(...)` for every calendar-day token. */
    it('accepts the calendar-day string a date macro resolves to', () => {
      for (const op of OPS) {
        expect(() => ComparisonOperatorSchema.parse({ [op]: '2026-01-01' })).not.toThrow();
      }
    });

    /**
     * The sub-day tokens (`{now}`, `{N_hours_ago}`) and all three first-party
     * callers — `lifecycle-service`, `plugin-email`'s outbox sweep — emit a
     * full `.toISOString()`.
     */
    it('accepts the full ISO instant the sub-day tokens and the sweeps emit', () => {
      const cutoff = new Date('2026-08-08T04:32:56.000Z').toISOString();
      for (const op of OPS) {
        expect(() => ComparisonOperatorSchema.parse({ [op]: cutoff })).not.toThrow();
      }
    });

    /**
     * A `Field.time` comparand is `HH:MM[:SS[.fff]]` and is declared
     * NOT `Date.parse`-able (`field-value.zod.ts`, CLOCK_TIME_TYPES); the SQL
     * driver canonicalises exactly this in the comparand position (#3979).
     * This case is why the union is not narrowed to an ISO date/date-time shape.
     */
    it('accepts a wall-clock time-of-day, which an ISO refinement would reject', () => {
      for (const op of OPS) {
        expect(() => ComparisonOperatorSchema.parse({ [op]: '09:00' })).not.toThrow();
        expect(() => ComparisonOperatorSchema.parse({ [op]: '14:30:00.500' })).not.toThrow();
      }
    });

    /**
     * Non-temporal text ordering rides along with the widening. Pinned as an
     * ADMITTED shape rather than a promised ordering — the docblock says the
     * ORDER is the backend collation's, and this schema is field-agnostic so it
     * cannot tell a code column from a date one.
     */
    it('admits non-temporal text (order is the backend collation\'s, not this contract\'s)', () => {
      for (const op of OPS) {
        expect(() => ComparisonOperatorSchema.parse({ [op]: 'M' })).not.toThrow();
      }
    });

    it('still accepts numbers, Dates and field references — widening is additive', () => {
      for (const op of OPS) {
        expect(() => ComparisonOperatorSchema.parse({ [op]: 42 })).not.toThrow();
        expect(() => ComparisonOperatorSchema.parse({ [op]: new Date('2026-01-01') })).not.toThrow();
        expect(() => ComparisonOperatorSchema.parse({ [op]: { $field: 'other.col' } })).not.toThrow();
      }
    });

    it('still rejects a comparand that is orderable at no backend', () => {
      for (const op of OPS) {
        expect(() => ComparisonOperatorSchema.parse({ [op]: true })).toThrow();
        expect(() => ComparisonOperatorSchema.parse({ [op]: { nope: 1 } })).toThrow();
      }
    });

    /**
     * The documentation copy above and the ENFORCED copy must not drift: it is
     * `FieldOperatorsSchema` that `NormalizedFilterSchema` validates against and
     * that the exported `FieldOperators` type is inferred from, so widening only
     * the documented one would have left the reachable surface still rejecting
     * the platform's own output.
     */
    it('is matched by the enforced copy — FieldOperatorsSchema and the normalized AST', () => {
      for (const op of OPS) {
        expect(() => FieldOperatorsSchema.parse({ [op]: '2026-01-01' })).not.toThrow();
      }
      expect(() => NormalizedFilterSchema.parse({
        $and: [{ close_date: { $gte: '2026-01-01' } }, { created_at: { $lt: '2026-08-08T04:32:56.000Z' } }],
      })).not.toThrow();
    });
  });
});

// ============================================================================
// 3.2 Set & Range Operators Tests
// ============================================================================

describe('SetOperatorSchema', () => {
  it('should accept $in operator with array', () => {
    const filter = { $in: ['admin', 'editor', 'viewer'] };
    expect(() => SetOperatorSchema.parse(filter)).not.toThrow();
  });

  it('should accept $nin operator with array', () => {
    const filter = { $nin: ['guest', 'anonymous'] };
    expect(() => SetOperatorSchema.parse(filter)).not.toThrow();
  });

  it('should accept arrays of different types', () => {
    expect(() => SetOperatorSchema.parse({ $in: [1, 2, 3] })).not.toThrow();
    expect(() => SetOperatorSchema.parse({ $in: ['a', 'b', 'c'] })).not.toThrow();
  });
});

describe('RangeOperatorSchema', () => {
  it('should accept $between with numeric range', () => {
    const filter = { $between: [18, 65] as [number, number] };
    expect(() => RangeOperatorSchema.parse(filter)).not.toThrow();
  });

  it('should accept $between with date range', () => {
    const filter = {
      $between: [new Date('2024-01-01'), new Date('2024-12-31')] as [Date, Date]
    };
    expect(() => RangeOperatorSchema.parse(filter)).not.toThrow();
  });

  // ==========================================================================
  // #6571 — BOTH endpoints accept the STRING the platform itself produces.
  //
  // Before this was pinned each endpoint union was `number | Date |
  // FieldReference`, so every accepted shape below threw — including the shape
  // this package's own `temporal-conformance.ts` corpus states as the expected
  // cross-driver behaviour. `$between` is the sibling of the four ordering
  // slots #5685 fixed; a range IS its two ordering bounds. See
  // `RangeOperatorSchema`'s docblock for why the union is a bare `string`
  // rather than an ISO refinement.
  //
  // These assert through `safeParse` rather than a bare `toThrow()` so a
  // rejection names WHICH endpoint was refused: a tuple carries two independent
  // unions and `toThrow()` cannot tell a min-side refusal from a max-side one.
  // (The ADR-0112 `code`/`status` envelope does not apply here — these are Zod
  // parse verdicts on a declaration surface, not runtime refusals.)
  // ==========================================================================

  describe('string endpoints (#6571)', () => {
    /**
     * `resolveFilterTokens`' `walk` descends into arrays, and every branch of
     * the resolver returns a string, so a token range resolves to two strings:
     * `['{current_year_start}', '{current_year_end}']` -> `['2026-01-01', '2026-12-31']`.
     */
    it('accepts the two calendar-day strings a token range resolves to', () => {
      const resolved = RangeOperatorSchema.safeParse({ $between: ['2026-01-01', '2026-12-31'] });
      expect(resolved.success).toBe(true);
    });

    /** The sub-day tokens (`{now}`, `{N_hours_ago}`) emit a full `.toISOString()`. */
    it('accepts a range of full ISO instants', () => {
      const result = RangeOperatorSchema.safeParse({
        $between: ['2026-08-08T04:32:56.000Z', '2026-08-09T04:32:56.000Z'],
      });
      expect(result.success).toBe(true);
    });

    /**
     * `temporal-conformance.ts`: "time: $between spans the working day
     * inclusively" — `{ at: { $between: ['08:00:00', '18:00:00'] } }` on a
     * `Field.time` column. `CLOCK_TIME_TYPES` declares this form NOT
     * `Date.parse`-able, which is why an ISO refinement was rejected.
     */
    it('accepts the wall-clock range the temporal conformance corpus pins', () => {
      const result = RangeOperatorSchema.safeParse({ $between: ['08:00:00', '18:00:00'] });
      expect(result.success).toBe(true);
    });

    /**
     * Endpoints are widened independently, which is what a partially-resolved
     * range actually looks like — one literal `Date` and one resolved macro.
     */
    it('accepts mixed endpoints, each union resolved on its own', () => {
      expect(RangeOperatorSchema.safeParse({
        $between: [new Date('2026-01-01'), '2026-12-31'],
      }).success).toBe(true);
      expect(RangeOperatorSchema.safeParse({
        $between: ['2026-01-01', { $field: 'contract.end_date' }],
      }).success).toBe(true);
    });

    it('still accepts numbers, Dates and field references — widening is additive', () => {
      expect(RangeOperatorSchema.safeParse({ $between: [18, 65] }).success).toBe(true);
      expect(RangeOperatorSchema.safeParse({
        $between: [new Date('2024-01-01'), new Date('2024-12-31')],
      }).success).toBe(true);
      expect(RangeOperatorSchema.safeParse({
        $between: [{ $field: 'a.min' }, { $field: 'a.max' }],
      }).success).toBe(true);
    });

    /**
     * The shapes that were rejected before stay rejected, and the failure is
     * attributed to the offending endpoint rather than to the tuple as a whole.
     */
    it('still rejects an endpoint that is rangeable at no backend', () => {
      const boolMax = RangeOperatorSchema.safeParse({ $between: ['2026-01-01', true] });
      expect(boolMax.success).toBe(false);
      expect(boolMax.error?.issues[0]?.path).toEqual(['$between', 1]);

      const objectMin = RangeOperatorSchema.safeParse({ $between: [{ nope: 1 }, '2026-12-31'] });
      expect(objectMin.success).toBe(false);
      expect(objectMin.error?.issues[0]?.path).toEqual(['$between', 0]);
    });

    /** Arity is the tuple's own contract and is untouched by the widening. */
    it('still rejects a range that is not a two-element [min, max]', () => {
      expect(RangeOperatorSchema.safeParse({ $between: ['2026-01-01'] }).success).toBe(false);
      expect(RangeOperatorSchema.safeParse({
        $between: ['2026-01-01', '2026-06-30', '2026-12-31'],
      }).success).toBe(false);
      expect(RangeOperatorSchema.safeParse({ $between: '2026-01-01' }).success).toBe(false);
    });

    /**
     * The documentation copy above and the ENFORCED copy must not drift: it is
     * `FieldOperatorsSchema` that `NormalizedFilterSchema` validates against and
     * that the exported `FieldOperators` type is inferred from. #5685 shipped
     * the sibling ordering slots and had to come back for this same second
     * spelling, so both are pinned here.
     */
    it('is matched by the enforced copy — FieldOperatorsSchema and the normalized AST', () => {
      expect(FieldOperatorsSchema.safeParse({ $between: ['2026-01-01', '2026-12-31'] }).success)
        .toBe(true);
      expect(FieldOperatorsSchema.safeParse({ $between: ['08:00:00', '18:00:00'] }).success)
        .toBe(true);
      expect(NormalizedFilterSchema.safeParse({
        $and: [{ close_date: { $between: ['2026-01-01', '2026-12-31'] } }],
      }).success).toBe(true);
    });
  });
});

// ============================================================================
// 3.3 String-Specific Operators Tests
// ============================================================================

describe('StringOperatorSchema', () => {
  it('should accept $contains operator', () => {
    const filter = { $contains: '@company.com' };
    expect(() => StringOperatorSchema.parse(filter)).not.toThrow();
  });

  it('should accept $startsWith operator', () => {
    const filter = { $startsWith: 'admin_' };
    expect(() => StringOperatorSchema.parse(filter)).not.toThrow();
  });

  it('should accept $notContains operator', () => {
    const filter = { $notContains: 'spam' };
    expect(() => StringOperatorSchema.parse(filter)).not.toThrow();
  });

  it('should accept $endsWith operator', () => {
    const filter = { $endsWith: '.pdf' };
    expect(() => StringOperatorSchema.parse(filter)).not.toThrow();
  });
});

// ============================================================================
// 3.5 Special Operators Tests
// ============================================================================

describe('SpecialOperatorSchema', () => {
  it('should accept $null operator', () => {
    expect(() => SpecialOperatorSchema.parse({ $null: true })).not.toThrow();
    expect(() => SpecialOperatorSchema.parse({ $null: false })).not.toThrow();
  });

  it('should accept $exists operator', () => {
    expect(() => SpecialOperatorSchema.parse({ $exists: true })).not.toThrow();
    expect(() => SpecialOperatorSchema.parse({ $exists: false })).not.toThrow();
  });
});

// ============================================================================
// Combined Field Operators Tests
// ============================================================================

describe('FieldOperatorsSchema', () => {
  it('should accept multiple operators combined', () => {
    const filter: FieldOperators = {
      $gte: 18,
      $lte: 65,
    };
    expect(() => FieldOperatorsSchema.parse(filter)).not.toThrow();
  });

  it('should accept all operator types', () => {
    const filter: FieldOperators = {
      $eq: 'value',
      $ne: 'other',
      $gt: 10,
      $gte: 10,
      $lt: 100,
      $lte: 100,
      $in: ['a', 'b'],
      $nin: ['c', 'd'],
      $between: [1, 10] as [number, number],
      $contains: 'test',
      $startsWith: 'prefix',
      $endsWith: 'suffix',
      $null: false,
      $exists: true,
    };
    expect(() => FieldOperatorsSchema.parse(filter)).not.toThrow();
  });
});

// ============================================================================
// Filter Condition Tests - Basic
// ============================================================================

describe('FilterConditionSchema - Implicit Equality', () => {
  it('should accept simple implicit equality', () => {
    const filter = { status: 'active' };
    expect(() => FilterConditionSchema.parse(filter)).not.toThrow();
  });

  it('should accept multiple implicit equalities', () => {
    const filter = {
      status: 'active',
      role: 'admin',
      verified: true,
    };
    expect(() => FilterConditionSchema.parse(filter)).not.toThrow();
  });
});

describe('FilterConditionSchema - Explicit Operators', () => {
  it('should accept explicit comparison operators', () => {
    const filter = {
      age: { $gte: 18 },
      score: { $lt: 100 },
    };
    expect(() => FilterConditionSchema.parse(filter)).not.toThrow();
  });

  it('should accept explicit string operators', () => {
    const filter = {
      email: { $contains: '@company.com' },
      username: { $startsWith: 'admin_' },
    };
    expect(() => FilterConditionSchema.parse(filter)).not.toThrow();
  });

  it('should accept explicit set operators', () => {
    const filter = {
      status: { $in: ['active', 'pending'] },
      role: { $nin: ['guest', 'anonymous'] },
    };
    expect(() => FilterConditionSchema.parse(filter)).not.toThrow();
  });
});

// ============================================================================
// Filter Condition Tests - Logical Operators
// ============================================================================

describe('FilterConditionSchema - Logical Operators', () => {
  it('should accept $and operator', () => {
    const filter = {
      $and: [
        { status: 'active' },
        { age: { $gte: 18 } },
      ],
    };
    expect(() => FilterConditionSchema.parse(filter)).not.toThrow();
  });

  it('should accept $or operator', () => {
    const filter = {
      $or: [
        { role: 'admin' },
        { role: 'editor' },
      ],
    };
    expect(() => FilterConditionSchema.parse(filter)).not.toThrow();
  });

  it('should accept $not operator', () => {
    const filter = {
      $not: { status: 'deleted' },
    };
    expect(() => FilterConditionSchema.parse(filter)).not.toThrow();
  });

  it('should accept nested logical operators', () => {
    const filter = {
      $and: [
        { status: 'active' },
        {
          $or: [
            { role: 'admin' },
            { permissions: { $contains: 'edit' } },
          ],
        },
      ],
    };
    expect(() => FilterConditionSchema.parse(filter)).not.toThrow();
  });
});

// ============================================================================
// Filter Condition Tests - Relation Queries
// ============================================================================

describe('FilterConditionSchema - Nested Relations', () => {
  it('should accept nested object filters', () => {
    const filter = {
      profile: {
        verified: true,
      },
    };
    expect(() => FilterConditionSchema.parse(filter)).not.toThrow();
  });

  it('should accept deeply nested relations', () => {
    const filter = {
      department: {
        company: {
          country: 'USA',
        },
      },
    };
    expect(() => FilterConditionSchema.parse(filter)).not.toThrow();
  });

  it('should accept nested relations with operators', () => {
    const filter = {
      department: {
        name: { $eq: 'IT' },
        employeeCount: { $gt: 10 },
      },
    };
    expect(() => FilterConditionSchema.parse(filter)).not.toThrow();
  });
});

// ============================================================================
// Query Filter Tests - Complete Examples
// ============================================================================

describe('QueryFilterSchema - Complete Examples', () => {
  it('should accept the example from specification', () => {
    const filter: QueryFilter = {
      where: {
        status: 'active',                     // Implicit equality (AND)
        age: { $gte: 18 },                    // Explicit comparison (AND)
        $or: [                                // Logical branch
          { role: 'admin' },
          { email: { $contains: '@company.com' } },
        ],
        profile: {                            // Relation query
          verified: true,
        },
      },
    };
    expect(() => QueryFilterSchema.parse(filter)).not.toThrow();
  });

  it('should accept complex nested query', () => {
    const filter: QueryFilter = {
      where: {
        $and: [
          { status: { $in: ['active', 'pending'] } },
          { createdAt: { $gte: new Date('2024-01-01') } },
          {
            $or: [
              { priority: 'high' },
              { assignee: { $null: false } },
            ],
          },
        ],
        tags: {
          name: { $contains: 'urgent' },
        },
      },
    };
    expect(() => QueryFilterSchema.parse(filter)).not.toThrow();
  });

  it('should accept query with all operator types', () => {
    const filter: QueryFilter = {
      where: {
        // Equality
        status: 'active',
        archived: { $ne: true },
        
        // Comparison
        age: { $gte: 18, $lte: 65 },
        score: { $gt: 80 },
        
        // Set
        role: { $in: ['admin', 'editor'] },
        category: { $nin: ['spam', 'deleted'] },
        
        // Range
        createdAt: { 
          $between: [
            new Date('2024-01-01'), 
            new Date('2024-12-31')
          ] as [Date, Date]
        },
        
        // String
        email: { $contains: '@example.com' },
        username: { $startsWith: 'user_' },
        filename: { $endsWith: '.pdf' },
        
        // Special
        deletedAt: { $null: true },
        metadata: { $exists: true },
        
        // Logical
        $or: [
          { priority: 'high' },
          { urgent: true },
        ],
        
        // Nested relation
        owner: {
          department: {
            name: 'Engineering',
          },
        },
      },
    };
    expect(() => QueryFilterSchema.parse(filter)).not.toThrow();
  });
});

// ============================================================================
// TypeScript Type Tests
// ============================================================================

describe('TypeScript Type System', () => {
  it('should infer correct types for simple filter', () => {
    interface User {
      id: number;
      name: string;
      age: number;
      email: string;
      active: boolean;
    }

    const filter: Filter<User> = {
      age: { $gte: 18 },
      email: { $contains: '@example.com' },
      active: true,
    };

    expect(filter).toBeDefined();
  });

  it('should infer correct types for nested relations', () => {
    interface User {
      id: number;
      name: string;
      profile: {
        verified: boolean;
        bio: string;
      };
    }

    const filter: Filter<User> = {
      name: { $startsWith: 'John' },
      profile: {
        verified: true,
        bio: { $contains: 'developer' },
      },
    };

    expect(filter).toBeDefined();
  });

  /**
   * #5685 — the TYPED half of the same contract. `Filter<T>` knows `T`, so it
   * stays type-precise where `ComparisonOperatorSchema` cannot; what it must
   * NOT do is reject the string the platform's own date-macro resolver hands
   * the author. These assignments are checked by `pnpm typecheck`, not by the
   * runtime expectation below — vitest never typechecks, so reverting
   * `filter.zod.ts` leaves this test GREEN under vitest and RED under `tsc`.
   * Measured on the reverted schema, both errors land in this block:
   *   `$gte: '2026-01-01'` -> TS2322 Type 'string' is not assignable to type 'Date'
   *   `$gte: '09:00'`      -> TS2322 Type 'string' is not assignable to type 'undefined'
   * (the second reads `undefined`, not `never`: the old guard's `never` meets
   * the slot's own `?`, and an optional `never` IS `undefined`.)
   */
  it('accepts an ISO string on a Date field and orders string fields (#5685)', () => {
    interface Deal {
      close_date: Date;      // resolved date macro arrives as 'YYYY-MM-DD'
      shift_start: string;   // Field.time — 'HH:MM[:SS[.fff]]'
      amount: number;
    }

    const resolvedMacro: Filter<Deal> = { close_date: { $gte: '2026-01-01' } };
    const stillTakesDate: Filter<Deal> = { close_date: { $lt: new Date('2026-01-01') } };
    const clockTime: Filter<Deal> = { shift_start: { $gte: '09:00' } };
    const numeric: Filter<Deal> = { amount: { $gt: 1000 } };

    expect([resolvedMacro, stillTakesDate, clockTime, numeric]).toHaveLength(4);
  });

  /**
   * #6571 — the TYPED half of the range contract, the exact mirror of the
   * ordering block above. Checked by `pnpm typecheck`, NOT by the runtime
   * expectation below: vitest never typechecks, so reverting `filter.zod.ts`
   * leaves this test GREEN under vitest and RED under `tsc`. Measured on the
   * reverted guard, the errors land in this block:
   *   `$between: ['2026-01-01', '2026-12-31']` on a Date field
   *     -> TS2322 Type 'string' is not assignable to type 'Date'
   *   `$between: ['08:00:00', '18:00:00']` on a string field
   *     -> TS2322 ... not assignable to type 'undefined'
   * (the second reads `undefined`, not `never`, for the same reason #5685
   * recorded: the old guard's `never` meets the slot's own `?`, and an optional
   * `never` IS `undefined`.)
   */
  it('accepts a resolved macro range on a Date field and ranges string fields (#6571)', () => {
    interface Deal {
      close_date: Date;      // a resolved token range arrives as two 'YYYY-MM-DD'
      shift_start: string;   // Field.time — 'HH:MM[:SS[.fff]]'
      amount: number;
    }

    const resolvedMacroRange: Filter<Deal> = { close_date: { $between: ['2026-01-01', '2026-12-31'] } };
    const stillTakesDates: Filter<Deal> = {
      close_date: { $between: [new Date('2026-01-01'), new Date('2026-12-31')] },
    };
    // A partially-resolved range: endpoints are widened independently.
    const halfResolved: Filter<Deal> = { close_date: { $between: [new Date('2026-01-01'), '2026-12-31'] } };
    // The shape `temporal-conformance.ts` pins for a Field.time column.
    const workingDay: Filter<Deal> = { shift_start: { $between: ['08:00:00', '18:00:00'] } };
    // A number field stays numbers-only.
    const numericRange: Filter<Deal> = { amount: { $between: [1000, 5000] } };

    expect([resolvedMacroRange, stillTakesDates, halfResolved, workingDay, numericRange])
      .toHaveLength(5);
  });

  it('should support logical operators', () => {
    interface Task {
      title: string;
      status: string;
      priority: number;
    }

    const filter: Filter<Task> = {
      $or: [
        { status: 'urgent' },
        { priority: { $gt: 8 } },
      ],
      $and: [
        { title: { $contains: 'bug' } },
        { status: { $ne: 'closed' } },
      ],
    };

    expect(filter).toBeDefined();
  });
});

// ============================================================================
// Constants Tests
// ============================================================================

describe('Filter Operator Constants', () => {
  it('should export all filter operators', () => {
    expect(FILTER_OPERATORS).toContain('$eq');
    expect(FILTER_OPERATORS).toContain('$ne');
    expect(FILTER_OPERATORS).toContain('$gt');
    expect(FILTER_OPERATORS).toContain('$gte');
    expect(FILTER_OPERATORS).toContain('$lt');
    expect(FILTER_OPERATORS).toContain('$lte');
    expect(FILTER_OPERATORS).toContain('$in');
    expect(FILTER_OPERATORS).toContain('$nin');
    expect(FILTER_OPERATORS).toContain('$between');
    expect(FILTER_OPERATORS).toContain('$contains');
    expect(FILTER_OPERATORS).toContain('$startsWith');
    expect(FILTER_OPERATORS).toContain('$endsWith');
    // [#6520] Enforced, not merely declared, since every JS face got an arm.
    expect(FILTER_OPERATORS).toContain('$icontains');
    expect(FILTER_OPERATORS).toContain('$null');
    expect(FILTER_OPERATORS).toContain('$exists');
  });

  it('should export all logical operators', () => {
    expect(LOGICAL_OPERATORS).toContain('$and');
    expect(LOGICAL_OPERATORS).toContain('$or');
    expect(LOGICAL_OPERATORS).toContain('$not');
  });

  it('should export all operators combined', () => {
    expect(ALL_OPERATORS.length).toBe(FILTER_OPERATORS.length + LOGICAL_OPERATORS.length);
  });
});

// ============================================================================
// Edge Cases & Validation
// ============================================================================

describe('FilterConditionSchema - Edge Cases', () => {
  it('should accept empty where clause', () => {
    const filter: QueryFilter = { where: {} };
    expect(() => QueryFilterSchema.parse(filter)).not.toThrow();
  });

  it('should accept undefined where clause', () => {
    const filter: QueryFilter = {};
    expect(() => QueryFilterSchema.parse(filter)).not.toThrow();
  });

  it('should accept empty logical arrays', () => {
    const filter = {
      $and: [],
      $or: [],
    };
    expect(() => FilterConditionSchema.parse(filter)).not.toThrow();
  });

  it('should accept complex deeply nested structure', () => {
    const filter = {
      $and: [
        {
          $or: [
            { status: 'active' },
            {
              $and: [
                { archived: false },
                { deletedAt: { $null: true } },
              ],
            },
          ],
        },
        {
          $not: {
            role: { $in: ['banned', 'suspended'] },
          },
        },
      ],
    };
    expect(() => FilterConditionSchema.parse(filter)).not.toThrow();
  });
});

// ============================================================================
// Real-World Use Case Examples
// ============================================================================

describe('Real-World Use Cases', () => {
  it('should support user search query', () => {
    const filter: QueryFilter = {
      where: {
        $or: [
          { name: { $contains: 'john' } },
          { email: { $contains: 'john' } },
          { username: { $contains: 'john' } },
        ],
        status: 'active',
        role: { $in: ['user', 'admin'] },
      },
    };
    expect(() => QueryFilterSchema.parse(filter)).not.toThrow();
  });

  it('should support e-commerce order filtering', () => {
    const filter: QueryFilter = {
      where: {
        status: { $in: ['pending', 'processing', 'shipped'] },
        totalAmount: { $gte: 100 },
        createdAt: {
          $between: [
            new Date('2024-01-01'),
            new Date('2024-12-31'),
          ] as [Date, Date],
        },
        customer: {
          tier: 'premium',
          country: { $in: ['US', 'CA', 'UK'] },
        },
      },
    };
    expect(() => QueryFilterSchema.parse(filter)).not.toThrow();
  });

  it('should support project task filtering', () => {
    const filter: QueryFilter = {
      where: {
        $and: [
          {
            $or: [
              { priority: 'high' },
              { dueDate: { $lt: new Date() } },
            ],
          },
          { status: { $ne: 'completed' } },
          { assignee: { $null: false } },
        ],
        project: {
          status: 'active',
          team: {
            department: 'Engineering',
          },
        },
      },
    };
    expect(() => QueryFilterSchema.parse(filter)).not.toThrow();
  });

  it('should support content management filtering', () => {
    const filter: QueryFilter = {
      where: {
        $and: [
          { published: true },
          { deletedAt: { $null: true } },
        ],
        $or: [
          { title: { $contains: 'tutorial' } },
          { tags: { name: { $in: ['tutorial', 'guide', 'howto'] } } },
        ],
        author: {
          verified: true,
          role: { $in: ['editor', 'admin'] },
        },
        publishedAt: {
          $gte: new Date('2024-01-01'),
        },
      },
    };
    expect(() => QueryFilterSchema.parse(filter)).not.toThrow();
  });
});

describe('NormalizedFilterSchema', () => {
  it('should accept normalized $and condition', () => {
    const filter = {
      $and: [
        { age: { $eq: 18 } },
        { role: { $eq: 'admin' } }
      ]
    };
    
    expect(() => NormalizedFilterSchema.parse(filter)).not.toThrow();
  });

  it('should accept normalized $or condition', () => {
    const filter = {
      $or: [
        { status: { $eq: 'active' } },
        { status: { $eq: 'pending' } }
      ]
    };
    
    expect(() => NormalizedFilterSchema.parse(filter)).not.toThrow();
  });

  it('should accept normalized $not condition', () => {
    const filter = {
      $not: { deleted: { $eq: true } }
    };
    
    expect(() => NormalizedFilterSchema.parse(filter)).not.toThrow();
  });

  it('should accept nested normalized filters in $and', () => {
    const filter = {
      $and: [
        { age: { $gte: 18 } },
        {
          $or: [
            { role: { $eq: 'admin' } },
            { role: { $eq: 'moderator' } }
          ]
        }
      ]
    };
    
    expect(() => NormalizedFilterSchema.parse(filter)).not.toThrow();
  });

  it('should accept nested normalized filters in $or', () => {
    const filter = {
      $or: [
        { status: { $eq: 'active' } },
        {
          $and: [
            { status: { $eq: 'pending' } },
            { verified: { $eq: true } }
          ]
        }
      ]
    };
    
    expect(() => NormalizedFilterSchema.parse(filter)).not.toThrow();
  });

  it('should accept nested normalized filter in $not', () => {
    const filter = {
      $not: {
        $and: [
          { deleted: { $eq: true } },
          { archived: { $eq: true } }
        ]
      }
    };
    
    expect(() => NormalizedFilterSchema.parse(filter)).not.toThrow();
  });

  it('should accept complex deeply nested normalized filters', () => {
    const filter = {
      $and: [
        { active: { $eq: true } },
        {
          $or: [
            { type: { $eq: 'premium' } },
            {
              $and: [
                { type: { $eq: 'basic' } },
                { credits: { $gte: 100 } }
              ]
            }
          ]
        }
      ]
    };
    
    expect(() => NormalizedFilterSchema.parse(filter)).not.toThrow();
  });

  it('should accept multiple operators in $and', () => {
    const filter = {
      $and: [
        { age: { $gte: 18 } },
        { age: { $lte: 65 } },
        { role: { $in: ['user', 'admin'] } }
      ]
    };
    
    expect(() => NormalizedFilterSchema.parse(filter)).not.toThrow();
  });

  it('should accept empty optional operators', () => {
    const filter = {};
    expect(() => NormalizedFilterSchema.parse(filter)).not.toThrow();
  });

  it('should accept combination of all logical operators', () => {
    const filter = {
      $and: [
        { active: { $eq: true } }
      ],
      $or: [
        { role: { $eq: 'admin' } },
        { role: { $eq: 'moderator' } }
      ],
      $not: {
        deleted: { $eq: true }
      }
    };
    
    expect(() => NormalizedFilterSchema.parse(filter)).not.toThrow();
  });
});

// ============================================================================
// parseFilterAST Tests
// ============================================================================

describe('parseFilterAST', () => {
  it('should return undefined for null/undefined input', () => {
    expect(parseFilterAST(null)).toBeUndefined();
    expect(parseFilterAST(undefined)).toBeUndefined();
  });

  it('should return undefined for empty array', () => {
    expect(parseFilterAST([])).toBeUndefined();
  });

  it('should pass through object filters as-is', () => {
    const filter = { status: 'active' };
    expect(parseFilterAST(filter)).toEqual({ status: 'active' });
  });

  it('should pass through FilterCondition with $and/$or as-is', () => {
    const filter = { $and: [{ priority: 'high' }, { status: 'active' }] };
    expect(parseFilterAST(filter)).toEqual(filter);
  });

  it('should convert simple equality comparison', () => {
    expect(parseFilterAST(['status', '=', 'active'])).toEqual({ status: 'active' });
  });

  it('should convert == equality comparison', () => {
    expect(parseFilterAST(['status', '==', 'active'])).toEqual({ status: 'active' });
  });

  it('should convert != comparison', () => {
    expect(parseFilterAST(['status', '!=', 'deleted'])).toEqual({ status: { $ne: 'deleted' } });
  });

  it('should convert <> comparison', () => {
    expect(parseFilterAST(['status', '<>', 'deleted'])).toEqual({ status: { $ne: 'deleted' } });
  });

  it('should convert > comparison', () => {
    expect(parseFilterAST(['age', '>', 18])).toEqual({ age: { $gt: 18 } });
  });

  it('should convert >= comparison', () => {
    expect(parseFilterAST(['age', '>=', 18])).toEqual({ age: { $gte: 18 } });
  });

  it('should convert < comparison', () => {
    expect(parseFilterAST(['age', '<', 65])).toEqual({ age: { $lt: 65 } });
  });

  it('should convert <= comparison', () => {
    expect(parseFilterAST(['age', '<=', 65])).toEqual({ age: { $lte: 65 } });
  });

  it('should convert in operator', () => {
    expect(parseFilterAST(['role', 'in', ['admin', 'editor']])).toEqual({ role: { $in: ['admin', 'editor'] } });
  });

  it('should convert not_in operator', () => {
    expect(parseFilterAST(['role', 'not_in', ['guest']])).toEqual({ role: { $nin: ['guest'] } });
  });

  it('should convert contains/like operator', () => {
    expect(parseFilterAST(['name', 'contains', 'John'])).toEqual({ name: { $contains: 'John' } });
    expect(parseFilterAST(['name', 'like', 'John'])).toEqual({ name: { $contains: 'John' } });
  });

  it('should convert notcontains/not_contains operator', () => {
    expect(parseFilterAST(['name', 'notcontains', 'spam'])).toEqual({ name: { $notContains: 'spam' } });
    expect(parseFilterAST(['name', 'not_contains', 'spam'])).toEqual({ name: { $notContains: 'spam' } });
  });

  it('should convert startswith operator', () => {
    expect(parseFilterAST(['name', 'startswith', 'A'])).toEqual({ name: { $startsWith: 'A' } });
    expect(parseFilterAST(['name', 'starts_with', 'A'])).toEqual({ name: { $startsWith: 'A' } });
  });

  it('should convert endswith operator', () => {
    expect(parseFilterAST(['name', 'endswith', '.pdf'])).toEqual({ name: { $endsWith: '.pdf' } });
    expect(parseFilterAST(['name', 'ends_with', '.pdf'])).toEqual({ name: { $endsWith: '.pdf' } });
  });

  it('should convert between operator', () => {
    expect(parseFilterAST(['age', 'between', [18, 65]])).toEqual({ age: { $between: [18, 65] } });
  });

  it('should convert nin operator (MongoDB alias)', () => {
    expect(parseFilterAST(['role', 'nin', ['guest']])).toEqual({ role: { $nin: ['guest'] } });
  });

  it('should convert is_null operator', () => {
    expect(parseFilterAST(['deleted_at', 'is_null', null])).toEqual({ deleted_at: { $null: true } });
  });

  it('should convert is_not_null operator', () => {
    expect(parseFilterAST(['deleted_at', 'is_not_null', null])).toEqual({ deleted_at: { $null: false } });
  });

  it('should convert AND logical node', () => {
    const input = ['and', ['priority', '=', 'high'], ['status', '=', 'active']];
    expect(parseFilterAST(input)).toEqual({
      $and: [{ priority: 'high' }, { status: 'active' }],
    });
  });

  it('should convert OR logical node', () => {
    const input = ['or', ['role', '=', 'admin'], ['role', '=', 'editor']];
    expect(parseFilterAST(input)).toEqual({
      $or: [{ role: 'admin' }, { role: 'editor' }],
    });
  });

  it('should handle nested logical operators', () => {
    const input = ['and', ['status', '=', 'active'], ['or', ['priority', '=', 'high'], ['priority', '=', 'critical']]];
    expect(parseFilterAST(input)).toEqual({
      $and: [
        { status: 'active' },
        { $or: [{ priority: 'high' }, { priority: 'critical' }] },
      ],
    });
  });

  it('should unwrap single-child logical nodes', () => {
    const input = ['and', ['status', '=', 'active']];
    expect(parseFilterAST(input)).toEqual({ status: 'active' });
  });

  it('should handle case-insensitive logical operators', () => {
    const input = ['AND', ['status', '=', 'active'], ['priority', '=', 'high']];
    expect(parseFilterAST(input)).toEqual({
      $and: [{ status: 'active' }, { priority: 'high' }],
    });
  });

  it('should handle legacy flat array of conditions', () => {
    const input = [['status', '=', 'active'], ['priority', '=', 'high']];
    expect(parseFilterAST(input)).toEqual({
      $and: [{ status: 'active' }, { priority: 'high' }],
    });
  });

  it('should handle real-world browser filter example from issue', () => {
    const input = ['and', ['priority', '=', 'high'], ['status', '=', 'active']];
    const result = parseFilterAST(input);
    expect(result).toEqual({
      $and: [{ priority: 'high' }, { status: 'active' }],
    });
    // Validate the result is a valid FilterCondition
    expect(() => FilterConditionSchema.parse(result)).not.toThrow();
  });

  it('should produce valid FilterCondition for complex nested AST', () => {
    const input = [
      'and',
      ['status', '!=', 'deleted'],
      ['or', ['priority', '=', 'high'], ['age', '>', 18]],
      ['role', 'in', ['admin', 'editor']],
    ];
    const result = parseFilterAST(input);
    expect(result).toEqual({
      $and: [
        { status: { $ne: 'deleted' } },
        { $or: [{ priority: 'high' }, { age: { $gt: 18 } }] },
        { role: { $in: ['admin', 'editor'] } },
      ],
    });
    expect(() => FilterConditionSchema.parse(result)).not.toThrow();
  });
});

// ============================================================================
// isFilterAST — structural validation
// ============================================================================

describe('isFilterAST', () => {
  it('should return false for null/undefined/empty', () => {
    expect(isFilterAST(null)).toBe(false);
    expect(isFilterAST(undefined)).toBe(false);
    expect(isFilterAST([])).toBe(false);
  });

  it('should return false for non-array types', () => {
    expect(isFilterAST('not an array')).toBe(false);
    expect(isFilterAST(42)).toBe(false);
    expect(isFilterAST(true)).toBe(false);
    expect(isFilterAST({ status: 'active' })).toBe(false);
  });

  it('should detect valid comparison node', () => {
    expect(isFilterAST(['status', '=', 'active'])).toBe(true);
    expect(isFilterAST(['age', '>', 18])).toBe(true);
    expect(isFilterAST(['age', '>=', 18])).toBe(true);
    expect(isFilterAST(['role', 'in', ['admin', 'editor']])).toBe(true);
    expect(isFilterAST(['name', 'contains', 'John'])).toBe(true);
    expect(isFilterAST(['name', 'notcontains', 'spam'])).toBe(true);
    expect(isFilterAST(['name', 'not_contains', 'spam'])).toBe(true);
    expect(isFilterAST(['name', 'like', 'John'])).toBe(true);
    expect(isFilterAST(['created_at', 'between', ['2024-01-01', '2024-12-31']])).toBe(true);
    expect(isFilterAST(['deleted_at', 'is_null', null])).toBe(true);
  });

  it('should detect valid logical nodes', () => {
    expect(isFilterAST(['and', ['status', '=', 'active'], ['priority', '=', 'high']])).toBe(true);
    expect(isFilterAST(['or', ['role', '=', 'admin'], ['role', '=', 'editor']])).toBe(true);
    expect(isFilterAST(['AND', ['status', '=', 'active']])).toBe(true);
    expect(isFilterAST(['OR', ['a', '=', 1], ['b', '=', 2]])).toBe(true);
  });

  it('should detect legacy flat array format', () => {
    expect(isFilterAST([['status', '=', 'active'], ['priority', '=', 'high']])).toBe(true);
  });

  it('should reject invalid arrays that are not filter ASTs', () => {
    // Arbitrary number arrays
    expect(isFilterAST([1, 2, 3])).toBe(false);
    // Array of strings that aren't a valid comparison
    expect(isFilterAST(['hello', 'world'])).toBe(false);
    // Array where second element is not a known operator
    expect(isFilterAST(['field', 'UNKNOWN_OP', 'value'])).toBe(false);
    // Mixed array types
    expect(isFilterAST([true, false, null])).toBe(false);
  });

  it('should reject "and"/"or" with no children', () => {
    expect(isFilterAST(['and'])).toBe(false);
    expect(isFilterAST(['or'])).toBe(false);
  });

  it('should reject "and"/"or" with non-array children', () => {
    expect(isFilterAST(['and', 'not-an-array'])).toBe(false);
    expect(isFilterAST(['or', 123])).toBe(false);
  });

  it('should recursively validate children of logical nodes', () => {
    // Valid: children are valid AST nodes
    expect(isFilterAST(['and', ['status', '=', 'active'], ['age', '>', 18]])).toBe(true);
    // Invalid: children are arrays but not valid AST nodes
    expect(isFilterAST(['and', [1, 2, 3]])).toBe(false);
    // Nested valid AST
    expect(isFilterAST(['and', ['or', ['a', '=', 1], ['b', '=', 2]], ['c', '>', 3]])).toBe(true);
  });

  it('should recursively validate legacy flat array children', () => {
    // Valid: all children are valid comparison nodes
    expect(isFilterAST([['status', '=', 'active'], ['age', '>', 18]])).toBe(true);
    // Invalid: children are arbitrary arrays
    expect(isFilterAST([[1, 2], [3, 4]])).toBe(false);
  });
});

// ============================================================================
// VALID_AST_OPERATORS constant
// ============================================================================

describe('VALID_AST_OPERATORS', () => {
  it('should contain all standard comparison operators', () => {
    const expected = ['=', '==', '!=', '<>', '>', '>=', '<', '<=', 'in', 'nin', 'not_in',
      'contains', 'notcontains', 'not_contains', 'like', 'startswith', 'starts_with', 'endswith', 'ends_with',
      'between', 'is_null', 'is_not_null'];
    for (const op of expected) {
      expect(VALID_AST_OPERATORS.has(op)).toBe(true);
    }
  });
});
