// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// Stage 2e of #19886: the mirror of stage 2d's ordering refusal, with the list on
// the RECORD's side. The shape is legal, a field ordered against one bound; what
// the write-check evaluator now refuses is the VALUE the record holds there, a
// list or an object, the way driver-sql's read already refuses the same
// comparison on a column it stores as JSON text. Recorded as its own entry
// because the surface an author rewrites is a CEL predicate string.
export const entry: SemanticMigration = {
  id: 'rls-predicate-stored-list-ordering-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'security.PermissionSet rowLevelSecurity[].check, and .using where it stands in as the check — '
    + 'a CEL predicate ordering a field against a bound (>, >=, <, <=) where the field holds a list '
    + 'or an object on the record being written, as a json column or a multiple lookup does, or as '
    + 'a list written into a text or number field does. In a filter passed to matchesFilterCondition, '
    + '$gt / $gte / $lt / $lte and $between on a field whose value on the record is a list or a plain '
    + 'object, whatever the comparand',
  replacement:
    'a comparison that names one value. Order a single-valued column (record.priority > 2), or test '
    + 'membership in the list with in (record.status in ["open", "pending"]); a json or multiple '
    + 'field has no ordering. A record whose json column holds one scalar is compared exactly as '
    + 'before, and so are null and Date values, and every equality (==, !=, in) against a stored '
    + 'list',
  reason:
    'The mirror, with the list on the record\'s side, of the earlier refusal of an ordering '
    + 'operator against an array comparand (one of the same-class leaks that followed the '
    + '2026-09-24 ruling refusing an array under $ne), measured '
    + 'through the real plugin-security on driver-sql and driver-memory. record.tags > "a", with '
    + 'tags a json column holding ["m"], lowered to { tags: { $gt: "a" } }, and the write-check '
    + 'evaluator compared the list\'s JavaScript string form ("m" > "a"), so the check admitted and '
    + 'stored the write; record.meta < "a" with meta holding { a: 1 } compared "[object Object]" and '
    + 'did the same, and so did a multiple lookup. driver-sql\'s read refuses every ordering '
    + 'comparison, and $between, on a column it stores as JSON text, by declared type (400), because '
    + 'such a comparison can never mean what the caller wrote; the in-process write check now '
    + 'follows it, per record: INVALID_FILTER / 400 and nothing stored, on an insert and on a by-id '
    + 'update, including one that edits another field of a row whose stored column holds a list. '
    + 'A list written into a text or number field under an ordering check, admitted before and '
    + 'stored as the text "[500]" by driver-sql, is refused the same way. driver-memory, a test '
    + 'driver, still compares a stored list element by element on a read, so there the write and '
    + 'the read part. Shipped producers were counted before the change: no shipped row-level or '
    + 'sharing-rule predicate orders a field at all. '
    + 'Metadata AT REST is not rewritten and this entry adds no D2 conversion: the platform cannot '
    + 'tell which comparison an ordering over a list was standing in for, and rewriting it on the '
    + 'author\'s behalf would change which writes it admits, which is the policy author\'s decision. '
    + 'ADR-0058 D4 / ADR-0087 / ADR-0112.',
  acceptanceCriteria:
    'Grep the rowLevelSecurity check predicates of your permission sets, and the using predicates '
    + 'of policies that declare no check, for >, >=, < or <= whose field is a json field or a '
    + 'multiple lookup, and rewrite each as the replacement says. Then write a record through each '
    + 'such policy: a write whose compared field holds a list now answers 400 rather than being '
    + 'admitted by string comparison, so re-check what the policy is supposed to admit.',
};
