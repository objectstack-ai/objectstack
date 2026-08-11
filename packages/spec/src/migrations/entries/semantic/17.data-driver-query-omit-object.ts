// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'data-driver-query-omit-object',
  surface:
    'contracts.IDataDriver query parameter — find / findOne / count / updateMany / '
    + 'deleteMany / explain',
  replacement:
    '`DriverQuery` (`Omit<QueryAST, "object">`): delete the redundant `object:` key from the '
    + 'query literal at the call site — the object name is already the FIRST argument',
  reason:
    'Every one of these methods takes the object name as its first argument, and then '
    + 'required a `QueryAST` that lists `object` as mandatory — the same fact demanded twice, '
    + 'with two places for it to disagree. The layers above had already paid for that '
    + 'ambiguity: the objectql engine deliberately writes its key order as `{ ...query, '
    + 'object }` so a smuggled `query.object` cannot override the resolved name, and the wire '
    + 'layer spends a named 400 (`QUERY_OBJECT_MISMATCH`) refusing the inconsistency. The '
    + 'driver side paid in blanket casts: a direct caller holding only a `where` could not '
    + 'name the type, wrote `as any`, and switched off checking for `where` / `orderBy` / '
    + '`fields` along with it — 20 such sites measured in cloud#1053, and cloud#1030\'s '
    + '`$like` reached runtime through exactly that hole. This is a TS contract surface with '
    + 'no authored source for the chain to rewrite, which is why it is a semantic entry and '
    + 'not a D2 conversion; for a typed caller the compiler names every site (TS2353 '
    + '`\'object\' does not exist in type \'DriverQuery\'`), and for an untyped JS caller '
    + 'there is no constrained channel at all, which is exactly why this ledger entry must '
    + 'exist. Neither side is forced to move: a caller holding a `QueryAST` VALUE passes it '
    + 'unchanged (excess properties are only rejected on fresh literals), and an '
    + 'implementation still declaring `query: QueryAST` keeps compiling under parameter '
    + 'bivariance. What an implementation may no longer do is READ `query.object` — callers '
    + 'are now entitled to omit it. Registered by the #6350 stock reconciliation. #5181 was '
    + 'the audit\'s CONTROL sample, drawn to show that not every flagged candidate is an '
    + 'omission, and it was one: the seven `IDataDriver` hits in the ledger are all prose '
    + 'inside other entries, and the only subject-level hit on this interface is '
    + '`data-driver-find-stream-retired` — a DIFFERENT member. Two later, smaller driver '
    + 'call-parameter changes (#6321, #6083) both registered, and both cite #5181 as '
    + 'background; the larger sibling they derive from never got its own entry. ADR-0087, '
    + '#5181 (backfilled #6350).',
  acceptanceCriteria:
    'No `IDataDriver` call site passes an inline literal carrying `object:` — `driver.find('
    + '"account", { object: "account", where: … })` becomes `driver.find("account", { where: '
    + '… })`. `tsc` is the verify loop for typed callers and reports every remaining site by '
    + 'name; an untyped JS caller must be swept by hand, because nothing will report it. Any '
    + 'driver IMPLEMENTATION that read `query.object` is rewritten to use the object-name '
    + 'argument instead — that read now yields `undefined` whenever a caller exercises its '
    + 'new right to omit the key, and it fails at runtime rather than at compile time, so it '
    + 'is the one change on this surface a type check cannot find for you.',
};
