---
'@objectstack/spec': minor
---

feat(spec)!: `RealtimeEventType` names the realtime events the runtime emits — `data.record.*` and `data.records.*`; `record.created` / `record.updated` / `record.deleted` / `field.changed` retired (#20288)

Clause-②: yes (narrowing)

**BREAKING** — shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by
this banner, the `(narrowing)` arm above and the ADR-0087 disposition below,
never by the level). The enum both gains and loses values: it gains the five
names the runtime emits and loses the four it never emitted.

`RealtimeEventType` (`@objectstack/spec/api`) types `SubscriptionEvent.type`, so
it is the event vocabulary of `Subscription.events[]` and
`RealtimeConfig.subscriptions[].events[]`, and the generated API reference
published it as such. None of its four values was ever emitted by anything. The
ObjectQL engine publishes `data.record.created` / `data.record.updated` /
`data.record.deleted` for each written record and `data.records.updated` /
`data.records.deleted` for a predicate write (`multi: true`), and it parses every
event through `DataEventSchema` / `BulkDataEventSchema` before publishing. A
subscription written with the names the reference showed could never fire.
The runtime's published event names do not change; the enum moves to them.

- **Accepted now:** exactly `DataEventType` + `BulkDataEventType` —
  `data.record.created`, `data.record.updated`, `data.record.deleted`,
  `data.records.updated`, `data.records.deleted`. Metadata change events
  (`metadata.{type}.{action}`) are not members: a subscription event is
  record-shaped, and metadata events keep their own `MetadataEventType` contract
  and `subscribeMetadata` client primitive.
- **Refused now:** `record.created`, `record.updated`, `record.deleted` and
  `field.changed`, each with its own prescription. Any other unknown value keeps
  zod's own message, which lists the legal names.

```
FROM  SubscriptionSchema.parse({ id, transport: 'websocket', events: [{ type: 'record.created', object: 'account' }] })
      -> parsed; nothing ever published 'record.created', so the subscription never fired
TO    -> ZodError at events[0].type (invalid_value): `record.created` was removed from
         `RealtimeEventType` in @objectstack/spec 17.5.0 (ADR-0049 enforce-or-remove) — … Write
         `data.record.created` — the same event, spelled the way the engine publishes it.

FROM  { type: 'record.updated' }   ->  TO  { type: 'data.record.updated' }
      (add { type: 'data.records.updated' } to also hear predicate writes, which carry a count, not records)
FROM  { type: 'record.deleted' }   ->  TO  { type: 'data.record.deleted' }
      (add { type: 'data.records.deleted' } to also hear predicate writes)
FROM  { type: 'field.changed' }    ->  TO  { type: 'data.record.updated' }
      (read the field from the DataEvent payload's `changes`; no event is published per field)
```

**Fix.** Rename each value as mapped above. `tsc` refuses the old values at a
`RealtimeEventType` / `SubscriptionEvent` position (the type no longer contains
them), and a `SubscriptionSchema`, `SubscriptionEventSchema` or
`RealtimeConfigSchema` parse refuses them with the prescription. A handler keyed
on an old name never ran, so the rename changes behaviour only by making it fire.
Nothing in the open framework parses a subscription today — it mounts no realtime
transport — so no running deployment changes behaviour.

### The kit

- **Schema.** `RealtimeEventType` lists the five emitted names; its error map
  gives each retired value its own prescription (the `HookBodyCapability`
  precedent for a removed enum value). `realtime.test.ts` pins the enum equal to
  `DataEventType` + `BulkDataEventType`, and pins each refusal's code, path and
  first sentence through `SubscriptionSchema`.
- **ADR-0087.** The D3 entry `realtime-event-type-unemitted-values-retired`
  carries the prescription to `os migrate meta` and the upgrade guide. No D2
  conversion and no `RETIRED_KEYS_BY_MAJOR` row: an enum value is not a key, and
  a subscription is neither a stack collection member nor a stored row, so no
  conversion seam would ever see one.
- **Docs.** The `realtime` reference page is regenerated; the
  `RealtimeEventPayload.type` and `RealtimeEvent.type` examples name emitted
  events.

<!-- adr-0087: registered realtime-event-type-unemitted-values-retired -->
