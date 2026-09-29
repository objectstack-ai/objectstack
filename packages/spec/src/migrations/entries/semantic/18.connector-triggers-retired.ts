// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0049 enforce-or-remove — the D3 entry of the connector triggers family:
// `connector.triggers`, the whole `ConnectorTrigger` array, retired as one
// batch by ruling (ADR-0041 unchanged: connector-event triggers stay in its
// third tier, as their own trigger package). One D3 entry per retirement
// family, even when D2 is lossless (ruling B on #17152): the D2 conversion
// `connector-triggers-removed` repairs the data, and this entry carries what
// only the author can judge. It also names the CHAIN through the same protocol
// step: `connector-health-and-trigger-durations-unit-in-key` used to rename
// `triggers[].interval` to `intervalSeconds`; that half was absorbed here (the
// breaker half already was, by the `health` removal), so the rename left the
// table, and this family's former rename entry left with it.
export const entry: SemanticMigration = {
  id: 'connector-triggers-retired',
  surface: 'connector.triggers — the ConnectorTrigger array (key / label / description / type / '
    + 'intervalSeconds, and the interval spelling it was renamed from), on a connector and on a '
    + 'stack connectors[] entry',
  replacement: '(removed — nothing replaces a connector trigger.) Start the work from a flow that '
    + 'calls the connector\'s action in a `connector_action` node: an external event starts an '
    + '`api` flow that the event\'s sender calls, and a scheduled pull is a `schedule` flow.',
  reason: 'The D2 conversion `connector-triggers-removed` deletes `triggers` from every connector, '
    + 'stack entry and stored connector row, one notice per connector, and the delete is lossless: '
    + 'the automation engine registered a connector\'s actions only, no polling loop read an '
    + 'interval, no receiver was driven by a `webhook` trigger, and no provider derived one — so a '
    + 'declared trigger never started a flow, before or after the upgrade. Three judgements '
    + 'remain. First, any part of the deployment designed around a connector trigger firing has '
    + 'never been running, so the author decides which of those triggers should now exist as '
    + 'flows: a `polling` trigger becomes a `schedule` flow whose `connector_action` node calls '
    + 'the connector\'s read action, and a `webhook` trigger becomes an `api` flow that the '
    + 'external sender calls. The conversion STRIPS the array and never writes a flow, because '
    + 'a flow that runs STARTS work that never happened before — its cadence, its action and '
    + 'what it does with the result are the author\'s. Second, a polling cadence is in SECONDS: '
    + 'the key was renamed from `interval` to `intervalSeconds` earlier in this same protocol '
    + 'step because the bare `interval` means milliseconds elsewhere in this spec, so a trigger '
    + 'written `interval: 60000` for one minute asked for once every sixteen hours or so — carry '
    + 'the intended cadence, not the stored number, into the schedule. Third, turning a '
    + '`webhook` trigger into an `api` flow opens an inbound endpoint that never existed before '
    + '(the trigger declared no receiver and no verification), and the platform refuses an `api` '
    + 'flow with no per-flow secret and verifies a signature on every call — so whether the '
    + 'external sender can sign its calls decides whether that flow can receive them directly. '
    + 'The chain: '
    + 'in this same protocol step, `connector-health-and-trigger-durations-unit-in-key` no '
    + 'longer renames `triggers[].interval` — the whole array that key lived in is removed, so an '
    + 'author holding either spelling ends with no key at all.',
  acceptanceCriteria: 'No connector and no stack connector entry carries `triggers` in any '
    + 'spelling; the parse refuses the key with its prescription, and no code imports '
    + 'ConnectorTrigger or ConnectorTriggerSchema. Every connector registers and dispatches its '
    + 'actions exactly as it did before the upgrade. Each connector trigger the author still '
    + 'wants is a flow that is observed running: a scheduled pull as a `schedule` flow whose '
    + '`connector_action` node calls the connector\'s action at the intended cadence in seconds, '
    + 'and an external event as an `api` flow observed starting when the sender calls it.',
};
