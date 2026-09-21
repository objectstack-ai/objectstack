// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'data-file-value-duration-unit-in-key',
  surface: 'FileValue.duration, the media length on the expanded file/image/avatar/video/audio '
    + 'read shape, whose name carried no unit (data/field-value.zod.ts)',
  replacement: 'durationSeconds — rename the key; the value is unchanged, and a fractional '
    + 'second is still legal',
  reason:
    'Maintainer ruling A on #18669 (2026-09-17, decision batch #151 item 4): rename the key and '
    + 'record an ADR-0087 conversion-layer entry, with no new closed type and no narrowing of '
    + 'anything already stored. '
    + 'This key declared its unit in NO channel at all — no `.describe()`, no JSDoc, no unit '
    + 'token in the name — so the published reference page printed a bare number and the '
    + 'authoring site printed nothing. What makes the bare name worth a registry row is the '
    + 'company it kept: the only other number on FileValue is `size`, a BYTE count, so the one '
    + 'member that measured time was indistinguishable from a count at the very site an author '
    + '(very often a model, ADR-0033) writes it. `durationSeconds` rather than a mechanical '
    + '`durationSec` or `lengthSeconds`: this spec already spells a length of time '
    + '`durationSeconds` in SIX places, and they are ENUMERATED rather than counted because a '
    + 'bare number in shipped prose cannot be re-checked against the tree — '
    + 'ai/conversation.zod.ts ConversationAnalytics.durationSeconds; and on system/metrics.zod.ts '
    + 'MetricAggregationConfig.window.durationSeconds, ServiceLevelIndicator.window.durationSeconds, '
    + 'ServiceLevelObjective.period.durationSeconds, '
    + 'ServiceLevelObjective.errorBudget.burnRateWindows[].durationSeconds and '
    + 'MetricsConfig.retention.durationSeconds. The media length is therefore the SEVENTH '
    + 'spelling of one vocabulary, not the first of a second one. The retired-key tombstone '
    + 'entry data/FileValue:duration carries the same six keys in the same order, so the two '
    + 'surfaces that state one fact cannot drift apart. '
    + 'The value type is deliberately UNCHANGED at `z.number().optional()`: a fractional second '
    + 'is the ordinary shape of a media length, so the closed `DurationSeconds` type '
    + '(`.int().nonnegative()`, #18122) was considered and REFUSED by the ruling, and so was an '
    + '`.int()` floor. That refusal is the load-bearing half — this row is one of the six the '
    + '#18122 unit set was derived from, and it is the one that takes a NAME instead of a TYPE. '
    + 'Tombstoned with retiredKey(); FileValueSchema is the one deliberate z.looseObject in this '
    + 'file, so a bare deletion would wave the old spelling through as an unrecognised extra key '
    + 'and the prescription would never be spoken. '
    + 'Why a semantic entry and not a D2 conversion: FileValueSchema is the ADR-0104 D3 wave-2 '
    + 'EXPANDED READ form, derived at read time from a sys_file id — the STORED form is '
    + 'FileReferenceIdValueSchema, an opaque string — so a file value is never authored as this '
    + 'shape and never persisted as a sys_metadata row, and the conversion chain has no seam '
    + 'that would ever see one. '
    + '#18669, #14478, #18122, ADR-0104, ADR-0087.',
  acceptanceCriteria:
    'Every producer that BUILDS an expanded file value spells durationSeconds, and every '
    + 'consumer that reads a media length reads durationSeconds. Authoring duration fails to '
    + 'compile (input type `never`) and fails to parse with the rename prescription rather than '
    + 'riding through the loose shape as an unrecognised extra. Behaviour is unchanged: '
    + 'durationSeconds: 12 is the same twelve seconds duration: 12 was, the key stays optional, '
    + 'and durationSeconds: 12.34 still PARSES — a sweep that added .int() or adopted '
    + 'DurationSeconds has narrowed a value the ruling refused to narrow, and is the one '
    + 'over-application to look for. The five sibling members — url, name, size, mimeType, alt — '
    + 'are untouched; `size` in particular is a BYTE count, not a duration, so a sweep that '
    + 'suffixed it has read a count as a length of time.',
};
