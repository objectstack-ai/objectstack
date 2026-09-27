// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #15680 (stack card of #14478, maintainer ruling B: a duration key carries its
// unit in its NAME) — the D3 entry of the
// `connector-health-and-trigger-durations-unit-in-key` family (ruling B on
// #17152: one D3 entry per retirement family, even when D2 is lossless). The
// two keys share one authored document and one conversion, so they share one
// entry. Both renamed keys are still unread (the liveness ledger records each
// as dead, `liveness/connector.json`): the rename is an honesty fix to the
// declaration, and the entry says so rather than implying a live engine.
export const entry: SemanticMigration = {
  id: 'connector-resilience-durations-unit-in-key',
  surface: 'connector.health.circuitBreaker.monitoringWindow and connector.triggers[].interval — '
    + 'the two connector durations whose name carried no unit',
  replacement: '`monitoringWindowMs` (milliseconds) and `intervalSeconds` (seconds) — rename each '
    + 'key; both values are unchanged.',
  reason: 'The D2 conversion `connector-health-and-trigger-durations-unit-in-key` renames both keys '
    + 'in `connectors[]` and on stored connector rows, keeping each value, with a separate notice '
    + 'per key so an operator sees which of its own keys moved; the rename is lossless because '
    + 'each key always meant the unit its new name states. Two judgments remain. First, the units '
    + 'were easy to get wrong in opposite directions: `monitoringWindow` (milliseconds) sat one '
    + 'key below `resetTimeoutMs`, and the bare token `interval` means MILLISECONDS elsewhere in '
    + 'this same spec while a trigger interval meant SECONDS — so a trigger written '
    + '`interval: 60000` for one minute asked for once every sixteen hours or so, and the rename '
    + 'keeps 60000. Second, neither key drives an engine today: no polling loop reads a trigger '
    + 'interval, and no circuit breaker exists for connectors, so nothing reads the monitoring '
    + 'window. An author who relied '
    + 'on either for behaviour has not been getting it, before or after this rename.',
  acceptanceCriteria: 'No connector carries `health.circuitBreaker.monitoringWindow` or '
    + '`triggers[].interval`; the parse refuses both with the rename. Every `monitoringWindowMs` '
    + 'value is the window the author intends in milliseconds and every `intervalSeconds` value '
    + 'the cadence the author intends in seconds — a trigger meant to poll every minute reads '
    + '`intervalSeconds: 60`. No part of the deployment\'s design depends on a connector polling '
    + 'on that interval or tripping on that window: where it did, the author has moved that need '
    + 'to a mechanism that runs.',
};
