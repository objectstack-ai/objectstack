// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The cross-field comparison-class family, both arms in one entry: #20347
// refuses the comparison where it is authored (the lint rules behind
// os validate, and the permission save door), and #20355 refuses it where the
// row-level write check evaluates it. One classification decides both —
// crossFieldComparisonVerdict in @objectstack/spec/data, lifted from
// driver-sql's #5222 read boundary, which driver-sql now reads too. Recorded as
// its own entry because the surface an author rewrites is a CEL predicate string.
export const entry: SemanticMigration = {
  id: 'rls-predicate-cross-class-field-comparison-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'security.PermissionSet rowLevelSecurity[].using and .check, and sharingRules[].condition — a '
    + 'CEL predicate comparing a field with another field (==, !=, >, >=, <, <=) where the two '
    + 'declared columns share no comparison class: text against a number, a date against a '
    + 'datetime, a boolean against text, and any column against a file field (file, image, avatar, '
    + 'video, audio) or a formula field. In a filter passed to matchesFilterCondition together with '
    + 'the object\'s declared columns (options.fields), a { $field } comparison under $eq, $ne, $gt, '
    + '$gte, $lt or $lte between two such columns, and between a column and a json or multiple '
    + 'field',
  replacement:
    'a comparison between two columns of one comparison class: a number with a number (number, '
    + 'currency, percent, rating, slider, progress, summary), text with text (the string types, '
    + 'autonumber, a single select or radio, a single lookup or user, a master_detail or a tree), a '
    + 'boolean with a boolean, a date with a date, a datetime with a datetime, a time of day with a '
    + 'time of day. '
    + 'A file field and a formula field cannot be compared with another column at all: compare the '
    + 'field with a literal or test it for null. If the two columns do hold comparable values, one '
    + 'of them is declared with the wrong type, so correct that declaration rather than the '
    + 'predicate. Comparisons between two columns of one class lower and evaluate exactly as before',
  reason:
    'A column-to-column comparison has one meaning only within one comparison class: across '
    + 'classes SQLite orders every TEXT above every INTEGER while the in-process evaluator coerces '
    + '("open" > 5 is false). A formula field is virtual, with no stored column to reference. The '
    + 'file family is refused by name, whatever the deployment stores: during the ADR-0104 '
    + 'dual-encoding window one media column can hold a bare id and another the JSON-quoted form of '
    + 'the same id, so no comparison against the family is provably one answer on every path. '
    + 'driver-sql has refused such a comparison on the read since it first compiled a { $field } '
    + 'reference to a column-to-column comparison (a text column ordered against a number answered '
    + 'differently on SQLite than in memory, so the pushdown refused it), so a policy written '
    + 'record.status != record.amount (text and a number), record.status != record.photo (text and '
    + 'an image) or record.status != record.is_open (text and a formula field) got three answers, '
    + 'measured through the real plugin-security on driver-sql, on SQLite and PostgreSQL: '
    + 'os validate called it valid, every read it scoped answered INVALID_FILTER / 400 and every '
    + 'by-id update or delete it scoped 403, and an insert or update its check judged, or its using '
    + 'standing in as the check, was admitted and stored, because the write check compared the two '
    + 'raw values. The classification is now exported once from @objectstack/spec/data '
    + '(crossFieldComparisonVerdict) and read by every judge. The authoring arm: the '
    + 'rls-predicate-unenforceable rule refuses the comparison in using and check, on every '
    + 'operation, at os validate, build and lint and at the metadata save door for a permission '
    + 'set, and the sharing-rule-unlowerable-condition rule refuses it in a sharing-rule condition '
    + 'at os validate, build and lint. The write-check arm: the row-level write gate hands '
    + 'matchesFilterCondition the object\'s declared columns, and a comparison the classification '
    + 'does not define is refused INVALID_FILTER / 400 for every insert and update the check judges, '
    + 'before any record is read, with nothing stored; the message withholds the columns and the '
    + 'server log names the policy and both. A comparison against a json or multiple field is now '
    + 'refused by its declared type on the write too, where the earlier refusal of an array '
    + 'comparand under $ne judged it by the value each '
    + 'record held. driver-memory, a test driver with no field-reference arm, still reads such a '
    + 'comparison as a literal. Shipped producers were counted before the change: no shipped '
    + 'row-level policy or sharing-rule condition compares two fields of different classes. '
    + 'Metadata AT REST is not rewritten and this entry adds no D2 conversion: the platform cannot '
    + 'tell which comparison the author meant, and rewriting it on the author\'s behalf would change '
    + 'which rows and writes the policy admits, which is the policy author\'s decision. '
    + 'ADR-0058 D4 / ADR-0087 / ADR-0112.',
  acceptanceCriteria:
    'Run os validate over your stack: it names every row-level or sharing-rule predicate that '
    + 'compares two fields of different comparison classes, with both declarations. Rewrite each as '
    + 'the replacement says. A policy that never passed os validate (stored before the authoring '
    + 'arm, or written by another path) is refused at request time instead: every read it scopes '
    + 'answers 400 on the SQL drivers, and so does every insert or update its check judges, so '
    + 're-check what each such policy is meant to admit rather than assuming the writes it admitted '
    + 'before were right.',
};
