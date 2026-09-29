// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The authoring half of ADR-0137 D2 for one shape: a field-level predicate that
// reads THROUGH a reference field. The runtime already refuses the writes such a
// predicate reaches (or, for an option, never enforces it); what moved is that
// `objectstack validate` now says so before deploy. No D2 conversion — see
// `reason`.
//
// No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
// span already, and a nested backtick would close it.
export const entry: SemanticMigration = {
  id: 'field-predicate-reference-traversal-refused',
  surface:
    'the field-level predicates objects[].fields[].requiredWhen and objects[].fields[].readonlyWhen, '
    + 'and a select option\'s objects[].fields[].options[].visibleWhen, whose CEL reads THROUGH a '
    + 'reference field (a lookup, master_detail, user or tree field): record.account.tier where '
    + 'account is such a field; likewise previous.account.tier, and parent.account.tier on a '
    + 'master-detail line item whose master declares account. Refused wherever objects are '
    + 'validated as authored: objectstack validate, build and lint over defineStack({ objects }) '
    + 'sources and exported stacks',
  replacement:
    'the check as a `validations[]` rule of `type: \'script\'` — the one predicate the server reads one '
    + 'hop through a reference (the related record is loaded before it runs) — whose `condition` states '
    + 'the FAILURE. For `requiredWhen: P` on field F: P and F empty, e.g. '
    + '`record.account.tier == \'enterprise\' && (record.po_number == null || record.po_number == \'\')`. '
    + 'For `readonlyWhen: P` on F: P and F changed, on updates only (`events: [\'update\']`), e.g. '
    + '`record.account.tier == \'gold\' && record.discount != previous.discount`. For an option gated by '
    + 'P: that option picked while P does not hold — the option is then offered to everyone and refused '
    + 'on save. Or read a column the object itself declares (denormalise the related value onto it). '
    + 'A read through `previous` or `parent` has no hydrated seam at all, a validation rule included: '
    + 'read a column the bound record declares instead',
  reason:
    'Triage routed this on 2026-09-25 to remedy A: refuse the traversal at authoring, with a '
    + 'prescription. The field level is never hydrated: '
    + '`rule-validator.ts` evaluates `requiredWhen` / `readonlyWhen` / an option\'s `visibleWhen` '
    + 'against the record alone, so a reference there holds the related record\'s bare id and every '
    + 'read through it faults, on every row. Measured on the engine before this change: a traversing '
    + '`requiredWhen` refused every insert and every update that reached it, a traversing '
    + '`readonlyWhen` refused every update that wrote its field (an insert is exempt), and an option '
    + 'gated through a reference was admitted whatever the related record said (option visibility is '
    + 'fail-open) — while `objectstack validate` passed a stack carrying all three, exit 0. ADR-0137 D2 '
    + 'made the runtime fail closed; the defect was that authoring did not say so first (NORTH-STAR '
    + 'priority rule 4). The same traversal inside a `validations[]` `script` rule is served, one hop '
    + 'deep, and stays accepted. ⚠️ No D2 conversion, and the reason is the judgment this entry delegates: '
    + 'moving a field predicate into a validation rule turns a condition into a FAILURE condition, '
    + 'moves an option from hidden to offered-then-refused, and the right `events` scope depends on '
    + 'what the author meant — none of it mechanical. Hydrating the field level instead is a '
    + 'capability of its own and is not done here. ADR-0087, ADR-0137.',
  acceptanceCriteria:
    'Run `objectstack validate` over the stack. Each such predicate is refused as '
    + '`expression-invalid`, located at `object \'O\' · field \'F\' requiredWhen` (or `readonlyWhen`, '
    + 'or `option \'V\' visibleWhen`), and the message names the reference path read through '
    + '(`through record.account`) and the repair — that is the TODO\'s locator. Rewrite each per the '
    + '`replacement` note until validate is clean. Then prove the behaviour on a running stack: a '
    + 'write meeting the condition is refused by the new rule (`rule_violation` carrying its '
    + '`message`), and one that does not is accepted — where before, every write reaching the field '
    + 'predicate was refused with `could not be evaluated … write rejected`, or the option was '
    + 'admitted unchecked. ⚠️ An object already stored in `sys_metadata` is not re-validated by this '
    + 'change: its writes keep being refused at run time exactly as before, and that refusal names '
    + 'the reference for a `record` read — its own locator.',
};
