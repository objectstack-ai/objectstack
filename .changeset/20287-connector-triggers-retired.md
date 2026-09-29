---
'@objectstack/spec': minor
---

feat(spec)!: retire the connector `triggers` array — the `ConnectorTrigger` shape nothing ever registered, polled or received (#20287)

**BREAKING** — `connector.triggers` (the `ConnectorTrigger` array: `key`, `label`,
`description`, `type: 'polling' | 'webhook'`, `intervalSeconds`) is removed from
`ConnectorSchema` and `DeclarativeConnectorEntrySchema` — so from `defineConnector`,
`stack.connectors[]`, the `PUT /api/v1/meta/connector/:name` door and
`AutomationEngine.registerConnector` — and the `ConnectorTriggerSchema` /
`ConnectorTrigger` exports leave `@objectstack/spec/integration` with it. ADR-0049
enforce-or-remove, ruled RETIRE on the maintainer's criterion for a
declared-but-unenforced family; ADR-0041 is unchanged: connector-event triggers stay
in its third tier, as their own trigger package, promoted when real projects ask for
them — and then in the mainstream shape (subscribe / unsubscribe lifecycle,
signature verification, a dedupe cursor), which these five keys could not carry.

Measured before removal: `registerConnector` walks a connector's `actions` only and
stores the rest of the def unread; the engine's trigger registry holds FLOW trigger
kinds (`record_change`, `time_relative`, `schedule`, `api`) and no connector trigger
ever entered it; no polling loop read `intervalSeconds`; no receiver was driven by a
`webhook` trigger; and no connector package, provider or example declared one. A
declared trigger parsed clean and never started a flow.

### FROM → TO

| removed | what to write instead |
| --- | --- |
| `connector.triggers` with a `type: 'polling'` trigger (`intervalSeconds`, or the pre-rename `interval`) | delete the key, and write a `schedule` flow whose `connector_action` node calls the connector's action — at the cadence you meant, in seconds. |
| `connector.triggers` with a `type: 'webhook'` trigger | delete the key, and write an `api` flow that the external sender calls, with a `connector_action` node calling the connector's action. It opens an inbound endpoint that never existed before: an `api` flow is refused without a per-flow secret and every call must carry its signature, so the sender must be able to sign. |
| `ConnectorTriggerSchema`, `ConnectorTrigger` | no replacement — nothing parsed or constructed a connector trigger. |

**The one-line fix: delete `triggers:` from every connector.**
`os migrate meta --from 17` lists the mechanical edits for existing sources.

⚠️ Runtime behaviour is deliberately **unchanged**: no connector trigger ever started
anything. What changes is the answer an author gets — the key is refused at parse
with a prescription naming the two shapes that work, and in `tsc` (its input type is
`never`), instead of being saved with no effect.

### The retirement kit

- **Tombstone.** `triggers` is a `retiredKey()` tombstone on the private
  `ConnectorBaseSchema` both published carriers wrap (the schema is not `.strict()`,
  so a bare deletion would be a silent strip, ADR-0104).
  `RETIRED_KEYS_BY_MAJOR[18]`: `integration/Connector:triggers` and
  `integration/DeclarativeConnectorEntry:triggers`. The key had no default, so no
  retired-default residue is owed.
- **The provider-bound refusal is gone.** `DeclarativeConnectorEntrySchema` used to
  refuse `triggers` on a provider-bound instance, reasoned "the provider derives them
  from the upstream at boot" — untrue, since no provider ever derived a trigger. The
  tombstone refuses every value on every carrier, so that rule became unreachable and
  was deleted rather than re-reasoned; a provider-bound instance now meets the
  retirement prescription.
- **The def leaves whole** (`RETIRED_DEFS_BY_MAJOR[18]`: `integration/ConnectorTrigger`).
- **D2 conversion `connector-triggers-removed`** (step 18, retired from the load path):
  strips the array from `connectors[]` and from stored `sys_metadata` connector rows
  (the rehydration seam replays it), one notice per connector, as a lossless delete.
  A trigger is stripped, never turned into a flow.
- **The chain.** In the same step, `connector-health-and-trigger-durations-unit-in-key`
  renamed `triggers[].interval` to `intervalSeconds`. That trigger half is absorbed by
  this removal, as its breaker half already was by the `health` removal, so with neither
  half left the rename conversion is gone from the table and from step 18; an author
  holding either spelling ends with no `triggers` at all. The retired-key row
  `integration/ConnectorTrigger:interval` stays as the record.
- **D3 entry `connector-triggers-retired`** carries the family's judgement: which
  triggers should exist now as flows, the cadence in seconds, and whether an external
  sender can sign the calls a signed `api` flow requires. The absorbed rename's own D3 entry
  (`connector-resilience-durations-unit-in-key`) is gone with its
  conversion.
- **No deprecation window**, per the project's startup-stage posture.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec` is
published, so this is breaking for consumers no telemetry was consulted for.

Clause-②: no (narrowing)

<!-- adr-0087: registered connector-triggers-removed, connector-triggers-retired -->
