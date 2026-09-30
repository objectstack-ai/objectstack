// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The D3 entry of the `time-default-utc-suffix-dropped` family: the stored form
// of a `time` value (`ClockTimeValueSchema`) no longer admits a zone, so the
// literal defaults it judges move with it.
export const entry: SemanticMigration = {
  id: 'time-default-zone-refused',
  surface: 'a literal `defaultValue` with a `Z` or a UTC offset on a `time` field, or on an '
    + 'action param typed `time`',
  replacement: 'the wall clock itself, `HH:MM` or `HH:MM:SS` with no zone, or a `datetime` field '
    + 'when the value is an instant. The conversion drops a `Z` or a zero offset, which names the '
    + 'same wall clock. It does not touch a non-zero offset (`08:00+08:00`): whether that meant '
    + '08:00 or the UTC 00:00 only the author knows, so rewrite it by hand',
  reason:
    'A `time` value is a zone-less wall clock (ADR-0053 D-C1), and the record validator already '
    + 'refuses a zone-suffixed time of day on write. The stored form still admitted one, so a '
    + 'field default such as `10:00Z` parsed clean and every insert that fell back to it was then '
    + 'refused `invalid_time` on a field the caller never sent, and an action param default or '
    + 'submitted value passed the dispatcher. The stored form now refuses the zone, so the field '
    + 'and action-param default gates refuse it when it is authored and the dispatcher refuses it '
    + 'at submit.',
  acceptanceCriteria:
    'No `time` field or `time` action param declares a literal default with a zone. Zone-less '
    + 'defaults, the `NOW()` token and expression defaults parse as before. A stored `sys_metadata` '
    + 'row whose default carried a `Z` or a zero offset loads with the zone dropped; one with a '
    + 'non-zero offset keeps loading as stored, is listed by `os migrate meta --stored` as a TODO '
    + 'naming the field or param, and fails the schema wherever it is parsed until it is rewritten.',
  conversionIds: ['time-default-utc-suffix-dropped'],
};
