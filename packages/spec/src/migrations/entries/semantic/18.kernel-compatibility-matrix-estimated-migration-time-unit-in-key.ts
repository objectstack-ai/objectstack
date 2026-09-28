// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'kernel-compatibility-matrix-estimated-migration-time-unit-in-key',
  surface: 'CompatibilityMatrixEntry.estimatedMigrationTime, the migration effort estimate whose '
    + 'unit lived only in a source JSDoc (kernel/plugin-versioning.zod.ts)',
  replacement: 'estimatedMigrationTimeHours — rename the key AND state the unit in the '
    + 'describe; the value (hours) is unchanged',
  reason:
    'Maintainer ruling A of 2026-09-17 on the last two duration keys no closed duration type '
    + 'could express (this one in hours, the other in fractional seconds): rename the key and '
    + 'record an ADR-0087 conversion-layer entry, with no new closed type and no narrowing of '
    + 'anything already stored. '
    + 'The key said "Estimated migration time in hours" in a source JSDoc and carried no '
    + '.describe() at all — the JSDoc-channel shape (a unit stated only in a source comment '
    + 'the reference page never prints), one def over. The JSDoc '
    + 'stops at the source file; .describe() is what content/docs/references/** renders, so the '
    + 'published page printed a bare number directly beside migrationComplexity, whose scale IS '
    + 'named (trivial/simple/moderate/complex/major). A reader comparing "major" with "40" had '
    + 'no way to know whether 40 was minutes, hours or days. '
    + 'The remedy is BOTH halves, and the second is not optional: renaming alone would leave the '
    + 'two channels that name the unit — the key name and a source comment — agreeing about '
    + 'something the published page does not print, which check:duration-unit-keys refuses as '
    + 'unit-in-jsdoc-not-in-describe (that agreement shape — a unit in the key name and the '
    + 'JSDoc, none in the describe — was ruled an offence on 2026-09-18). So the unit moves '
    + 'INTO the describe and the key name carries it too. '
    + 'HOURS is kept rather than converted to seconds: the value is unchanged, the ruling '
    + 'forbade narrowing, and an effort estimate is authored in hours by the human who writes '
    + 'the plugin manifest. Tombstoned with retiredKey(): CompatibilityMatrixEntrySchema is a '
    + 'plain z.object, not strict, so a bare deletion would strip the old spelling in silence '
    + 'and a manifest would lose its one effort figure with no error anywhere. '
    + 'Why a semantic entry and not a D2 conversion: a compatibility matrix is a plugin-published '
    + 'version manifest — stack.zod.ts declares no collection of them and it is not a registered '
    + 'metadata kind stored as a sys_metadata row — so the chain has no seam that sees one. '
    + 'ADR-0087.',
  acceptanceCriteria:
    'Every plugin manifest that declares a migration estimate spells estimatedMigrationTimeHours '
    + 'and every consumer reads that key. Authoring estimatedMigrationTime fails to compile '
    + '(input type `never`) and fails to parse with the rename prescription rather than a bare '
    + 'unrecognized-key error. Behaviour is unchanged: estimatedMigrationTimeHours: 8 is the '
    + 'same eight hours estimatedMigrationTime: 8 was, the key stays optional and stays a bare '
    + 'z.number() — a sweep that added .int() or adopted a closed duration type has narrowed a '
    + 'value the ruling refused to narrow. The migration is proved correct when the reference '
    + 'page for CompatibilityMatrixEntry prints the unit rather than a bare number, and when '
    + 'check:duration-unit-keys reports the key as satisfied rather than listing it unjudged. '
    + 'testCoverage on the same shape is a PERCENTAGE, not a duration, and does not move.',
};
