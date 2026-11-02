// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Aggregation" section of `SqlDriver`: the bodies of
 * `foldEmptyAggregateAnswers` moved out of `sql-driver.ts` whole by
 * `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * No body reads a `SqlDriver` member, so each method calls its function
 * directly. `index.ts` re-exports nothing from this module.
 */


/** The body of `SqlDriver#foldEmptyAggregateAnswers`; the method's docblock there is its contract. */
export function foldEmptyAggregateAnswers(rows: any, identities: Map<string, number>): any {
    if (identities.size === 0 || !Array.isArray(rows)) return rows;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      for (const [column, identity] of identities) {
        if (row[column] === null) row[column] = identity;
      }
    }
    return rows;
  }
