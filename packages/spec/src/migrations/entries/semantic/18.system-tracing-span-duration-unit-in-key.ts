// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'system-tracing-span-duration-unit-in-key',
  surface: 'Span.duration, the emitted trace-span length whose name carried no unit '
    + '(system/tracing.zod.ts)',
  replacement: 'durationMs — rename the key; the value is unchanged',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): the unit of a duration-shaped z.number() lives in the key NAME or in a unit-carrying value, never only in the describe prose, and no existing offender is grandfathered. '
    + 'It stands alone because it is the only offender on its file and the only one in this '
    + 'card that is a pure runtime-emitted measurement: a span is written by an exporter and '
    + 'read by a backend, never authored by hand. That is also why it is a rename and not an '
    + 'externalVocabulary mirror, which is the exemption a tracing shape would most plausibly '
    + 'claim: OpenTelemetry, whose model this schema follows, carries span length as a '
    + 'start/end nanosecond PAIR and declares no key named duration at all, so there is no '
    + 'external spelling for the marker to point at. The shape already spells its two '
    + 'instants startTime and endTime, so the bare duration was the one measurement on the '
    + 'span that did not say what it was. Tombstoned with retiredKey(); the shape is not '
    + 'strict, so a bare deletion would strip in silence and an exporter emitting the old '
    + 'spelling would lose the value without an error. Why a semantic entry and not a D2 '
    + 'conversion: an emitted span is never a stack collection member and never a stored '
    + 'sys_metadata row — the same disposition every runtime-emitted measurement in this '
    + 'stack has taken. #15679, #14478, ADR-0087.',
  acceptanceCriteria:
    'Every exporter that BUILDS a Span spells durationMs, and every consumer that reads a '
    + 'span length reads durationMs. Authoring duration fails to compile (input type `never`) '
    + 'and fails to parse with the rename prescription rather than silently dropping the '
    + 'measurement. Behaviour is unchanged: durationMs: 150 is the same 150 milliseconds, and '
    + 'the non-negative bound rides along with the renamed key so a negative span length is '
    + 'still refused. Note the sibling instants startTime and endTime are ISO-8601 strings, '
    + 'not numbers, and are untouched by this rename.',
};
