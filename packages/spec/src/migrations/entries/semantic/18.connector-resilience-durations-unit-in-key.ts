// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #15680 (stack card of #14478, maintainer ruling B: a duration key carries its
// unit in its NAME) — the D3 entry of the
// `connector-health-and-trigger-durations-unit-in-key` family (ruling B on
// #17152: one D3 entry per retirement family, even when D2 is lossless). The
// family was two keys in one authored document and one conversion:
// `health.circuitBreaker.monitoringWindow` → `monitoringWindowMs` and
// `triggers[].interval` → `intervalSeconds`.
//
// ⚠️ Reconciled with the connector resilience retirement (ADR-0049, the same
// unreleased protocol step): the whole `health` block was then removed, so the
// breaker half of this rename was ABSORBED — the renamed key is itself retired,
// and the conversion now carries only the trigger half. This entry says so,
// rather than prescribing a rename to a key the parse refuses next; the
// removal's own judgement is the D3 entry `connector-resilience-keys-retired`.
// `triggers[].interval` is still unread (the liveness ledger records it dead,
// `liveness/connector.json`): the rename is an honesty fix to the declaration,
// and the entry says so rather than implying a live engine.
export const entry: SemanticMigration = {
  id: 'connector-resilience-durations-unit-in-key',
  surface: 'connector.triggers[].interval — the connector duration whose name carried no unit '
    + '(and, until the whole `health` block was retired, connector.health.circuitBreaker.monitoringWindow)',
  replacement: '`intervalSeconds` (seconds) — rename the key; the value is unchanged. There is no '
    + 'replacement for `monitoringWindow`: its renamed spelling `monitoringWindowMs` was retired with '
    + 'the rest of `connector.health` — delete the block (see `connector-resilience-keys-retired`).',
  reason: 'The D2 conversion `connector-health-and-trigger-durations-unit-in-key` renames '
    + '`triggers[].interval` in `connectors[]` and on stored connector rows, keeping the value; the '
    + 'rename is lossless because the key always meant seconds. It used to rename the breaker\'s '
    + '`monitoringWindow` too, but that half was absorbed by `connector-resilience-keys-removed`, '
    + 'which strips the whole `health` block — so an author holding either `monitoringWindow` or '
    + '`monitoringWindowMs` ends with no key at all, and must not re-add `monitoringWindowMs`: the '
    + 'parse refuses the block. Two judgments remain for the trigger. First, the unit was easy to '
    + 'get wrong: the bare token `interval` means MILLISECONDS elsewhere in this same spec while a '
    + 'trigger interval meant SECONDS — so a trigger written `interval: 60000` for one minute asked '
    + 'for once every sixteen hours or so, and the rename keeps 60000. Second, the key drives no '
    + 'engine today: no polling loop reads a trigger interval, so an author who relied on it for '
    + 'behaviour has not been getting it, before or after this rename.',
  acceptanceCriteria: 'No connector carries `triggers[].interval`; the parse refuses it with the '
    + 'rename, and every `intervalSeconds` value is the cadence the author intends in seconds — a '
    + 'trigger meant to poll every minute reads `intervalSeconds: 60`. No connector carries '
    + '`health` in any spelling (`monitoringWindow` or `monitoringWindowMs` included). No part of '
    + 'the deployment\'s design depends on a connector polling on that interval or tripping on a '
    + 'breaker window: where it did, the author has moved that need to a mechanism that runs.',
};
