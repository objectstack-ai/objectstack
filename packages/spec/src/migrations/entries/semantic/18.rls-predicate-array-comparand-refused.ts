// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The row-level-security face of ruling A on #19886 (stage 2a): the formula
// evaluator plugin-security runs a policy's check against. Recorded as its own
// entry because the surface an author rewrites is the RLS predicate, a CEL
// string, not a filter object they wrote by hand.
export const entry: SemanticMigration = {
  id: 'rls-predicate-array-comparand-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'security.PermissionSet rowLevelSecurity[].check (and .using, where the explain engine '
    + 'attributes a record) — a CEL predicate comparing a field with != or == against a list, '
    + 'a list literal or a current_user membership array, and the negation of such an ==. They '
    + 'lower to { field: { $ne: [...] } }, { field: [...] } and { $not: { field: [...] } }, which '
    + 'the @objectstack/formula evaluator matchesFilterCondition now refuses, together with '
    + '{ field: { $eq: [...] } }, at any depth under $and / $or / $not, the empty array included',
  replacement:
    'the list operator the comparison was standing in for. "One of these values" is in: '
    + 'record.status in ["open", "pending"]. "None of these values" is the negated in: '
    + '!(record.status in ["closed", "archived"]). Scalar != and ==, null, Date comparands and '
    + '{ $field } references evaluate exactly as before',
  reason:
    'Ruling A on #19886 refuses an array comparand under $ne, and the equality slot is ruling '
    + '乙 on #19757; stage 2a of #19886 lands both on the formula face, the evaluator '
    + 'plugin-security runs against the post-image of an insert or update to enforce a '
    + 'row-level check. It compared strictly, and no stored value ever equals an array, so a '
    + 'check written record.status != ["closed", "archived"], or != against a current_user '
    + 'membership array, matched EVERY post-image, and a check written '
    + '!(record.status == ["closed", "archived"]) did the same: every write such a policy was '
    + 'written to refuse was admitted and stored. The positive record.status == ["open", '
    + '"pending"] refused every write (403). All of these shapes now fail the write with '
    + 'INVALID_FILTER / 400 before any record is judged, the envelope driver-sql and '
    + 'driver-memory already give the same shape on the read side, and the explain engine\'s '
    + 'record attribution refuses too. The message withholds the field, the operator and the '
    + 'value, because the filter is usually an access policy the caller did not write and the '
    + 'comparand may be a resolved membership set. Metadata AT REST is not rewritten and this '
    + 'entry adds no D2 conversion: the platform cannot tell which list operator a list '
    + 'comparison was standing in for, and a policy rewritten on the author\'s behalf would '
    + 'change which writes it admits (the negated forms would start refusing writes they '
    + 'admitted, the positive form would start admitting writes it refused), which is the '
    + 'policy author\'s decision. ADR-0058 D4 / ADR-0087 / ADR-0112.',
  acceptanceCriteria:
    'Grep the rowLevelSecurity check and using predicates of your permission sets for != or == '
    + 'whose right-hand side is a list literal or a current_user membership array, and for the '
    + 'negation of such an ==, then rewrite each with in or !(... in ...). A check that still '
    + 'carries the shape refuses every write it governs with INVALID_FILTER / 400, allowed '
    + 'values included, so one allowed write under each policy finds every such check left. '
    + 'Then re-check what each policy is supposed to refuse rather than assuming the writes it '
    + 'admitted before were right: before this change a != or a negated == against a list '
    + 'admitted every write.',
};
