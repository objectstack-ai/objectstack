// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The CEL-lowering face of the list-comparand refusal: the pushdown compiler
// every row-level policy and declared sharing rule compiles through, plus the
// driver-mongodb face that answered the lowered shape. Recorded as its own entry
// because the surface an author rewrites is a CEL predicate string, and on
// MongoDB a stored query filter.
export const entry: SemanticMigration = {
  id: 'cel-predicate-list-comparand-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'security.PermissionSet rowLevelSecurity[].using and .check, and sharingRules[].condition — a '
    + 'CEL predicate comparing a field with != or == against a list, either a list literal or a '
    + 'current_user membership set the runtime resolves to an array (org_user_ids, positions, '
    + 'accessible_org_ids, or a key staged into rlsMembership), and the negation of such a '
    + 'comparison. On driver-mongodb, also a query filter carrying $ne with an array comparand, at '
    + 'any depth under $and / $or / $not',
  replacement:
    'the list operator the comparison was standing in for. "One of these values" is in: '
    + 'record.status in ["open", "pending"], or record.reviewer_id in current_user.org_user_ids. '
    + '"None of these values" is the negated in: !(record.status in ["closed", "archived"]). In a '
    + 'query filter, $in and $nin. Scalar != and ==, null, in, and field-to-field comparisons lower '
    + 'exactly as before',
  reason:
    'The @objectstack/formula pushdown compiler lowered such a comparison to a $ne carrying the '
    + 'array, to a bare-array equality, or to a $not around one. A row-level using clause is '
    + 'composed into the query after the engine\'s comparand-shape check, and driver-mongodb passed '
    + 'the shape to the server: measured through mingo, the named proxy for MongoDB query '
    + 'semantics, $ne against an array and the $nor that a negated equality becomes selected every '
    + 'row storing a scalar, so the read returned the rows the policy was written to hide. A check '
    + 'written != against a membership set admitted and stored every write, on driver-sql as on '
    + 'driver-mongodb. The compiler now refuses the comparison with reason unsupported, so the RLS '
    + 'compiler drops the policy and fails closed: reads under it return no rows and check writes '
    + 'are refused 403. A declared sharing rule with such a condition is skipped at bootstrap and '
    + 'never seeded. The authoring lint reports a list literal as rls-predicate-unenforceable; a '
    + 'membership set holds its value only per request, so that form is refused at request time. '
    + 'driver-mongodb refuses $ne with an array comparand with INVALID_FILTER / 400, as driver-sql '
    + 'and driver-memory already do. Metadata AT REST is not rewritten and this entry adds no D2 '
    + 'conversion: the platform cannot tell which list operator a list comparison was standing in '
    + 'for, and a policy rewritten on the author\'s behalf would change which rows it admits, which '
    + 'is the policy author\'s decision. ADR-0058 D4 / ADR-0087.',
  acceptanceCriteria:
    'Grep the rowLevelSecurity using and check predicates of your permission sets, and the '
    + 'condition of your sharing rules, for != or == whose other side is a list literal or a '
    + 'current_user membership set, and for the negation of such an ==, then rewrite each with in '
    + 'or its negation. On driver-mongodb, '
    + 'grep stored query filters for $ne with an array value and rewrite each with $nin.',
};
