// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0049 enforce-or-remove on `ConnectorSchema.triggers` — the connector
// triggers family, ruled RETIRE on the maintainer's criterion for a
// declared-but-unenforced family, with ADR-0041 left as it is (connector-event
// triggers stay in its third tier, as their own trigger package, promoted only
// when real projects ask for them). The `ConnectorTrigger` array (`key`,
// `label`, `description`, `type: 'polling' | 'webhook'`, `intervalSeconds`) was
// read by NOTHING. Measured on `origin/main` before the removal:
// `AutomationEngine.registerConnector` walks `parsed.actions` only and stores the
// rest of the def unread; the engine's trigger registry is keyed by FLOW trigger
// kind (`record_change`, `time_relative`, `schedule`, `api` — a closed set) and
// no connector trigger ever entered it; no polling loop read `intervalSeconds`;
// no receiver was driven by a `webhook` trigger; and across every `.ts`, `.tsx`
// and `.json` file outside `packages/spec` (tests excluded) at `288611e3e5`, the
// 15 authorings of a `triggers:` key were all webhook `triggers`, a plugin
// grouping or form-label translations — none a connector trigger — while
// `actions`, the lit control on the same def, is walked by `registerConnector`
// and handler-checked there.
//
// The one runtime touch was a REFUSAL of `triggers` on a provider-bound
// declarative instance, reasoned "the provider derives them from the upstream at
// boot" — untrue, since no provider ever derived a trigger. The tombstone makes
// that rule unreachable (every carrier refuses every value), so the rule left
// with it rather than being re-reasoned.
//
// Tombstoned with `retiredKey()` (non-strict schema, ADR-0104); the orphaned
// `integration/ConnectorTrigger` leaves via `RETIRED_DEFS_BY_MAJOR[18]`. The key
// carried no default, so no retired-default residue is owed. Sources and stored
// rows are rewritten by the D2 conversion `connector-triggers-removed`, which
// STRIPS the array and never turns a trigger into a flow — that is the author's
// decision, carried by the D3 entry `connector-triggers-retired`.
export const entry = 'integration/Connector:triggers';
