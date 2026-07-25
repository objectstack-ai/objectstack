---
"@objectstack/service-automation": patch
"@objectstack/trigger-record-change": patch
"@objectstack/lint": patch
---

fix(automation): array-form flow `triggerType` fails loudly instead of silently never firing (#3481)

An array `triggerType` on a flow start node — the shape an author (or an AI
authoring pass) naturally reaches for to fire on more than one event, e.g.

```ts
config: { objectName: 'app_task', triggerType: ['record-after-create', 'record-after-delete'] }
```

was accepted everywhere and armed nowhere. Multi-event unions are deliberately
unsupported (only the single tokens plus the `record-after-write` create-OR-update
union exist — see #3457), but nothing said so: `defineFlow` passed the array
(start-node `config` is an open record), the engine's `typeof === 'string'` check
folded it to no trigger and misclassified the flow as **manual**, so it never
entered the trigger-binding audit, and the flow-trigger-readiness lint used the
same `typeof` narrowing and produced no finding. The flow bound to nothing and
never fired, with zero output at any layer — the same silent-never-fire class as
#3427 / #3472, and the last authoring shape still slipping past every guard.

This is a **defensive** fix — arrays remain unsupported; they now fail loudly:

- **lint** (`validate-flow-trigger-readiness`): an array `triggerType` containing
  any `record-*` element now yields a `flow-trigger-unknown-event` warning at
  `os validate` time, steering to `record-after-write` (for created-or-updated) or
  one flow per event.
- **engine** (`resolveTriggerBinding`): such an array is routed to the
  `record_change` trigger — exactly as an unmappable single token is — instead of
  being folded to a manual flow, so it reaches the trigger's bind-time rejection.
- **trigger** (`record-change`): the bind-time rejection detects the array shape
  and emits a targeted warning (naming the flow, pointing at `record-after-write`
  and #3457) rather than the generic unknown-token line.
