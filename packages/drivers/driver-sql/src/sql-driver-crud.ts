// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "CRUD — IDataDriver core" section of `SqlDriver`: the
 * bodies of `sequenceKeyHash` moved out of `sql-driver.ts` whole by
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

import { createHash } from 'node:crypto';

/** The body of `SqlDriver#sequenceKeyHash`; the method's docblock there is its contract. */
export function sequenceKeyHash(object: string, tenantId: string, field: string, scope: string): string {
    return createHash('sha256')
      .update(`${object}\u001f${tenantId}\u001f${field}\u001f${scope}`)
      .digest('hex');
  }
