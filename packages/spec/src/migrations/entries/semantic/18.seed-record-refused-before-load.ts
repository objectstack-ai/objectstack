// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of a seed record `os validate` and `os build` now
// refuse because the seed load would drop it: a record its object's own
// validation rule refuses, or a keyed record with a blank key field. The load's
// verdicts are unchanged (`seed-key-blank-record-refused` is the load half of
// the second); what moves is that the authoring doors say it first. No
// conversion: only the author knows whether the record or the rule is wrong.
export const entry: SemanticMigration = {
  id: 'seed-record-refused-before-load',
  surface:
    'data.Seed.records (a seed dataset in `defineStack({ data })`, `defineSeed`, or a package body\'s seed), judged by '
    + '`os validate` and `os build`: a record one of its object\'s own validation rules refuses (any active, '
    + 'error-severity rule that judges inserts, every type but `state_machine`), judged on the record\'s own literal '
    + 'values; and a record of a keyed dataset (`ignore`, `upsert`, `update`) that leaves a field of its `externalId` '
    + 'blank (no value, null or an empty string)',
  replacement:
    'Correct the record so its rule admits it, change the rule if the record is right, or give the record a value '
    + 'for each `externalId` field. The refusal names where the record sits (`data[0].records[1]`), its object, its '
    + 'index and the refusing rule\'s name or the blank field',
  reason:
    'A seed write is held to the object\'s own validation rules, and a record a rule refuses is dropped from the load '
    + 'while every other record lands, so the environment still boots. Nothing at authoring judged a seed record '
    + 'against those rules: `os validate` and `os build` passed, and the first sign was a boot log line saying '
    + 'records were dropped, carrying the rule\'s message but not its name, or `os verify` failing without naming a '
    + 'rule. Both doors now run the write path\'s own evaluator over each seed record, one rule at a time, and refuse '
    + 'the config (exit 1, the refusals in `--json` too). A record and rule pair is judged only when the record\'s '
    + 'own values decide it: a rule that reads a value the load decides (a reference, a roll-up, formula or '
    + 'autonumber field, a default, a platform-injected column, an expression value, a `beforeInsert` hook\'s write, '
    + 'or the stored row of an `update` dataset) is counted in one note and left to the load. A keyed record with a '
    + 'blank key field, which the load already refuses, is refused here with the load\'s own sentence. There is no '
    + 'mechanical rewrite: whether the record or the rule is wrong is the author\'s call',
  acceptanceCriteria:
    '`os validate` and `os build` exit 0 with no "Seed records the seed load refuses" block; after a boot the seed '
    + 'load result carries no record dropped by a validation rule or refused for a blank key field, and `os verify` '
    + 'reports no dropped seed row.',
};
