// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'system-object-storage-durations-unit-in-key',
  surface: 'the two object-storage durations whose name carried no unit: '
    + 'AccessControlConfig.maxAge and StorageConnection.timeout '
    + '(system/object-storage.zod.ts)',
  replacement: 'maxAgeSeconds and timeoutMs — rename each key; both values are unchanged',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): the unit of a duration-shaped z.number() lives in the key NAME or in a unit-carrying value, never only in the describe prose, and no existing offender is grandfathered. '
    + 'AccessControlConfig.maxAge is the one key in this stack where the two structural '
    + 'exemptions and the rename look alike from a distance, so the reasoning is recorded '
    + 'rather than assumed. It was CONSIDERED for an externalVocabulary marker and demoted on '
    + 'evidence: every bucket-CORS standard the value is forwarded to spells the field WITH '
    + 'its unit — S3 MaxAgeSeconds, GCS maxAgeSeconds, Azure MaxAgeInSeconds — so marking it '
    + 'would have exempted a DEVIATION from the cited standard rather than a mirror of it, '
    + 'which is the opposite of what the marker declares. Its twin shared/CorsConfig.maxAge '
    + 'DID get the marker and keeps its bare name, because the Fetch response header that one '
    + 'mirrors, Access-Control-Max-Age, genuinely carries no unit token. Two maxAge keys on '
    + 'opposite sides of the same line; the asymmetry is the point and must not be '
    + 'harmonised. StorageConnection.timeout rides along as the plain case on the same file. '
    + 'Both are retiredKey() tombstones; the shapes are not strict, so a bare deletion would '
    + 'strip in silence. Why a semantic entry and not a D2 conversion: stack.zod.ts declares '
    + 'no objectStorage collection, and neither shape is a registered metadata kind stored as '
    + 'a sys_metadata row. #15679, #14478, ADR-0087.',
  acceptanceCriteria:
    'Every bucket access-control block spells maxAgeSeconds and every storage connection '
    + 'spells timeoutMs. Authoring either old spelling fails to compile (input type `never`) '
    + 'and fails to parse with the rename prescription. Behaviour is unchanged: '
    + 'maxAgeSeconds: 3600 caches a preflight for an hour exactly as maxAge: 3600 did, and '
    + 'the non-negative bounds ride along with the renamed keys. The migration is proved '
    + 'correct when shared/CorsConfig.maxAge is STILL spelled maxAge — a find-and-replace '
    + 'that renamed both has destroyed a declared external-vocabulary mirror, and the gate '
    + 'will not catch it because the marker exempts the key either way.',
};
