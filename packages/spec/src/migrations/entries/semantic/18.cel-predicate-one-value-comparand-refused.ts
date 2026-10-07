// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// Stage 2d of #19886: the comparisons ruling A's letter (a list under != and in
// the equality slot) did not name, each measured admitting and storing writes a
// row-level check was written to refuse. Two faces refuse them: the CEL pushdown
// compiler every row-level policy and declared sharing rule compiles through,
// and the @objectstack/formula evaluator the write check runs. Recorded as its
// own entry because the surface an author rewrites is a CEL predicate string.
export const entry: SemanticMigration = {
  id: 'cel-predicate-one-value-comparand-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'security.PermissionSet rowLevelSecurity[].using and .check, and sharingRules[].condition — a '
    + 'CEL predicate whose comparison is handed something other than one value: an ordering '
    + 'operator (>, >=, <, <=) against a list literal or a current_user membership set; an in '
    + 'list with a member that is itself a list; a comparison with no field at all against a '
    + 'membership set (current_user.org_user_ids != "x"); an ordering operator against the '
    + 'current_user root or a key that resolves to an object; and a field compared with another '
    + 'field (==, !=, or an ordering operator) where either column holds a list or an object on '
    + 'the record, as a json column or a multiple lookup does. In a filter passed to '
    + 'matchesFilterCondition, also $gt / $gte / $lt / $lte with an array, and $in / $nin with an '
    + 'array member',
  replacement:
    'the comparison the predicate was standing in for. "One of these values" is in: '
    + 'record.status in ["open", "pending"], or record.reviewer_id in current_user.org_user_ids; '
    + '"none of these values" is !(record.status in ["closed", "archived"]), with the list flat. '
    + 'An ordering takes one bound: record.status > "m", and a range is two comparisons joined by '
    + '&&. A comparison against the caller names one key: record.reviewer_id > current_user.id. '
    + 'A field compared with a json or multiple field has no pushdown form: compare with a '
    + 'single-valued column, or move the condition into a validation rule or hook. One-value '
    + 'comparisons, flat in lists, and field-to-field comparisons between single-valued columns '
    + 'lower and evaluate exactly as before',
  reason:
    'Ruling A of 2026-09-24 refused a list under != and in the equality slot, holding both to '
    + 'the declared comparand — a literal or a `{ $field }` reference; stage 2d closes the '
    + 'same fault one position over, measured through the real plugin-security on driver-sql and '
    + 'driver-memory. !(record.status in [["closed", "archived"]]) lowered to a negated $in whose '
    + 'only member was a list, which the strictly comparing write-check evaluator matched on no '
    + 'record, so the negation admitted and stored every write, and driver-memory returned every '
    + 'row on a read. record.status > ["m"] compared the list as the string "m". '
    + 'current_user.org_user_ids != "x" and current_user.org_user_ids > "a" folded to "no '
    + 'restriction": every write admitted and every row read. record.reviewer_id > current_user '
    + 'compared the whole caller object as a string. record.status != record.tags, with tags a '
    + 'json or multiple field, matched every post-image, so the check admitted and stored every '
    + 'write. The CEL compiler now refuses the first four with reason unsupported, so the RLS '
    + 'compiler drops the policy and fails closed when no other policy applies (reads return no '
    + 'rows, check writes are refused 403, the analytics read scope is the deny scope) and a '
    + 'declared sharing rule is skipped at bootstrap; the authoring lint reports what the source '
    + 'shows (a list literal, the current_user root). The compiler cannot see a column\'s type, so '
    + 'the last is refused by the write-check evaluator on the record whose compared column holds '
    + 'a list or an object: INVALID_FILTER / 400, nothing stored. Metadata AT REST is not '
    + 'rewritten and this entry adds no D2 conversion: the platform cannot tell which comparison a '
    + 'predicate was standing in for, and rewriting it on the author\'s behalf would change which '
    + 'writes and rows it admits, which is the policy author\'s decision. ADR-0058 D4 / ADR-0087 / '
    + 'ADR-0112.',
  acceptanceCriteria:
    'Grep the rowLevelSecurity using and check predicates of your permission sets, and the '
    + 'condition of your sharing rules, for an ordering operator next to a list or to '
    + 'current_user alone, for an in list that nests a list, for a comparison with no record '
    + 'field against a current_user membership key, and for a field compared with a json or '
    + 'multiple field; rewrite each as the replacement says. Then re-check what each policy is '
    + 'supposed to admit rather than assuming what it admitted before was right: several of these '
    + 'admitted every write, and two folded to no restriction at all.',
};
