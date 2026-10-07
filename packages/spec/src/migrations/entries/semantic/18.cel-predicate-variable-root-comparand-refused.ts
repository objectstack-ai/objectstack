// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The variable-ROOT sibling of cel-predicate-list-comparand-refused, one
// comparand kind over: the same pushdown compiler, the same consumers, the same
// fail-closed path. Recorded as its own entry because the surface an author
// rewrites is a different comparand, with a different replacement.
export const entry: SemanticMigration = {
  id: 'cel-predicate-variable-root-comparand-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'security.PermissionSet rowLevelSecurity[].using and .check, and sharingRules[].condition — a '
    + 'CEL predicate comparing with != or == against the bare current_user root, the variable with '
    + 'no key named after it, whether the other side is a field or a literal, and the negation of '
    + 'such a comparison. For a caller of the published compiler that binds its own variables, also '
    + 'a variable that resolves to an object',
  replacement:
    'the key of current_user the comparison means: record.owner_id == current_user.id, or '
    + 'current_user.organization_id, or current_user.email. A membership test is in: '
    + 'record.owner_id in current_user.org_user_ids. Scalar keys, membership sets under in, '
    + 'literals, null and field-to-field comparisons lower exactly as before',
  reason:
    'The @objectstack/formula pushdown compiler resolved the bare root to the whole caller context '
    + 'object, every kernel-resolved key at once with the membership arrays included, and lowered '
    + 'the comparison to a $ne carrying that object, to a bare-object equality, or to a $not around '
    + 'one; a constant comparison such as current_user != "guest" folded to no restriction. A '
    + 'strict compare never equals an object, so through the real SecurityPlugin on driver-sql a '
    + 'check written != against the root, or its negated ==, admitted and stored every insert and '
    + 'by-id update it was written to refuse, a USING-only such policy admitted every insert on '
    + 'the write pass, and explain reported the read as narrowed with the caller membership sets '
    + 'echoed in its readFilter. ADR-0058 D2 declares the operand opposite a field as a literal, a '
    + 'current_user scalar or a pre-resolved current_user set, and the published $eq / $ne '
    + 'contract declares a literal or a { $field } reference; the root is none of them. The '
    + 'compiler now refuses it with reason unsupported in both of its modes, so the authoring lint '
    + 'reports it (rls-predicate-unenforceable on either clause, sharing-rule-unlowerable-condition '
    + 'on a sharing condition), and the RLS compiler drops the policy and fails closed when no '
    + 'other policy applies: reads under it return no rows, check writes are refused 403, and '
    + 'explain answers denies. A declared sharing rule with such a condition is skipped at '
    + 'bootstrap as it already was, now with reason unsupported instead of unresolved-variable. '
    + 'Metadata AT REST is not rewritten and this entry adds no D2 conversion: the platform cannot '
    + 'tell which key the author meant, and a policy rewritten on the author\'s behalf would change '
    + 'which rows it admits. ADR-0058 D2 / ADR-0087.',
  acceptanceCriteria:
    'Grep the rowLevelSecurity using and check predicates of your permission sets, and the '
    + 'condition of your sharing rules, for != or == whose other side is current_user with no key '
    + 'after it, then rewrite each against the key it means (current_user.id, '
    + 'current_user.organization_id or current_user.email), or with in against a membership set.',
};
