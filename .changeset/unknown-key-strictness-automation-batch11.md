---
'@objectstack/spec': major
---

Close nine authorable automation shapes against unknown keys (#4001 batch 11, ADR-0078)

zod's default is `.strip`: a key a schema does not declare is silently discarded
and the parse still succeeds. On an authoring surface that is the worst failure
mode — the author (increasingly, an AI) gets a success envelope and ships
metadata that quietly ignores what they wrote. This batch closes the nine
remaining shapes in `automation/`'s main body.

**BREAKING.** Each of these now raises a named, fixable error instead of dropping
the key. The rejection carries the surface, the offending key, and — where the
word is recognisable — the canonical spelling.

**`flow.zod.ts` — the six NESTED blocks.** The four outer shapes (flow / node /
edge / variable) were closed earlier; their inner blocks were not, so the gate
rejected `nodee:` at node level while `connectorConfig: { connectorID }` — one
capital letter — parsed clean and dispatched the action against an undefined
connector id. Now strict: `FlowNode.connectorConfig`, `.position`,
`.inputSchema` (each parameter declaration), `.waitEventConfig`,
`.boundaryConfig`, and `Flow.errorHandling`.

Renames the rejections offer, each one a real spelling of the same knob on a
neighbouring surface in this repo:

| you wrote | write instead | where the other word comes from |
|---|---|---|
| `connectorConfig.params` / `parameters` / `arguments` / `payload` | `input` | script-node `config.inputs`, integration products |
| `waitEventConfig.event` / `signal` / `duration` / `delay` | `eventType` / `signalName` / `timerDuration` | — |
| `boundaryConfig.attachedToRef` / `cancelActivity` | `attachedToNodeId` / `interrupting` | BPMN 2.0's own attribute names |
| `errorHandling.backoffMs` | `retryDelayMs` | `shared/retry-policy.zod.ts` (#4661) |
| `errorHandling.initialDelayMs` / `maxDelayMs` | `retryDelayMs` / `maxRetryDelayMs` | connector `RetryConfig` |
| `errorHandling.retries` / `attempts` / `onError` | `maxRetries` / `strategy` | — |

Two are prescriptions rather than renames, because a rename would be wrong:
`inputSchema`'s `optional` is the opposite polarity of `required` (write
`required: false`), and `errorHandling.maxAttempts` counts the first attempt
while `maxRetries` counts the ones after it (write `maxRetries: maxAttempts - 1`).

**Deliberately still open**, both now pinned in code and in tests so a later
sweep stops rather than "finishing" the file: the flow node `config` slot
(ADR-0018 — the plugin node-type namespace, owned by each executor's
`configSchema`) and `FlowVersionHistorySchema` (emitted on publish, never
authored; the flow *inside* a history record is still gated by `FlowSchema`).

**`time-relative-trigger.zod.ts`.** `config.timeRelative` sits under the open
node `config` slot, so this schema is the only key gate it has — and it is
`safeParse`d at BIND time, not only at authoring. `{ …valid, offsetDay: 7 }`
used to bind a sweep that ran daily with the author's narrowing discarded, and
reported itself configured; it now refuses to bind and says why. `field` →
`dateField`, `filters` → `filter`, `objectName` → `object`, `limit` →
`maxRecords`; `schedule` and `runAs` get pointed at the layer that owns them.

**`flow-function.zod.ts`.** `{ handler, effect }` in `defineStack({ functions })`.
This binds at authoring only — the boot path reads entries with
`normalizeFlowFunctionEntry`, not a parse — which is exactly why it matters:
that reader takes two keys and ignores the rest by construction, so a misspelled
`effect` was dropped at the schema and then not looked for. The function still
registered, still ran, and its writes were still counted as none, keeping
#4354's broken-sweep query silent on the one run that needed it.

**`webhook.zod.ts`.** `object_name` → `object` and `active` → `isActive` (the
`sys_webhook` column names, for anyone re-authoring from a row), `events` →
`triggers`, `endpoint` → `url`; the five props #3494 removed now reject with
their reason instead of vanishing. Strictness also rides `.extend()` onto the
connector `WebhookConfigSchema`.

**`webhook` also gains the ADR-0010 protection envelope** (`protection`, plus
the loader-set `_lock` / `_lockReason` / `_lockSource` / `_provenance` /
`_packageId` / `_packageVersion` / `_lockDocsUrl`). This is not a separate
feature: both metadata load paths call `applyProtection` on every type, so a
package-loaded webhook already carried those keys when `plugin-webhooks`
re-parsed it at boot. Closing the shape without declaring them would have turned
every package-shipped webhook into a skipped subscription after a redeploy.

<!-- adr-0087: registered authoring-schemas-strict-unknown-keys -->
