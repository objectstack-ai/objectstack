---
"@objectstack/spec": minor
"@objectstack/runtime": patch
"@objectstack/service-i18n": patch
---

fix(spec,runtime,service-i18n): the dispatcher domains and their service contracts describe the same surface (#4127)

#4087 retired a `/storage` bridge that called `upload(key, data, options?)` as
`upload(file, { request })` — a shape no implementation has. Sweeping the other
dispatcher domains against `packages/spec/src/contracts/*` found the mirror-image
gap in three places: the call site and the implementation agreed, and the
**contract** was the thing that had never been written down. Each one was worked
around at the call site with `typeof x.foo === 'function'` — a duck-type is what
"the contract does not cover this" looks like when nobody fixes the contract.

Fixed at the contract, per Prime Directive #12.

**`INotificationService` — the inbox half.** `listInbox` / `markRead` /
`markAllRead` now exist, with `InboxQuery` / `InboxNotification` /
`InboxListResult` / `MarkReadResult`. Three SDK-expressed routes
(`notifications.list` / `.markRead` / `.markAllRead`) have rested on them all
along, implemented by `service-messaging`, while this contract described only
`send`. The cost was not theoretical: the dev notification stub implements
exactly `send` and `sendBatch` **because it followed the contract**, so the one
implementation written to spec was the one the dispatcher had to duck-type past.

They are optional, and the probe stays: an inbox needs a durable store, and a
send-only provider (SMTP, Twilio, a Slack webhook) fills the slot legitimately
without one. `handlerReady` cannot express that — the slot is serveable, one
capability of it is absent. The `/notifications` domain now takes
`INotificationService` instead of `as any`, and each write route probes its own
method rather than riding the entry `listInbox` check (they are separately
optional, so "has an inbox to read" never implied "has read-state to write").

**`II18nService.getFieldLabels`.** Both serving surfaces — the dispatcher's
`/i18n/labels/:object/:locale` and service-i18n's own mount — probed for it and
both documented it as "optional on `II18nService`", which was not true. It is
now. service-i18n's probe loses two casts with it (one through
`Record<string, unknown>`, one re-declaring the signature inline).

**`IAutomationService.getFlowRuntimeStates`** + the `FlowRuntimeState` type.
`GET /automation/_status` (and the CLI boot summary, and the
`kernel:bootstrapped` audit) already called it while the contract stopped at
`listFlows(): string[]`. The dispatcher's inline cast declared it as
`{ name, enabled, bound }` — a third copy of the shape and a narrower one than
the engine returns, dropping the `status` / `triggerType` / `object` fields that
say WHY a flow is unbound.

Two runtime fixes fell out of the same sweep:

- **`POST /automation/trigger/:name` now builds a real `AutomationContext`.**
  It passed the raw HTTP body to `execute(name, body)`, so the
  `{ recordId, objectName, params }` translation never ran and — the sharper
  half — no caller identity was forwarded. A flow's default `runAs` is `'user'`,
  and a `runAs:'user'` run whose trigger resolved no user has its data
  operations REFUSED (#3760, fail-closed), so `client.automation.trigger()`
  could not run a data-touching flow at all while `POST /:name/trigger` could.
  service-automation's own comment claims "most trigger surfaces (REST action /
  trigger endpoint) already resolve the full envelope"; for this endpoint it was
  not true. Both routes share one context builder now.
- **The dead `automationService.trigger(...)` probe is gone.** Nothing in the
  repo has ever implemented `trigger` on the automation slot and the contract
  never declared it, so the branch was unreachable on every deployment and its
  `execute` "fallback" was the route. Declaring `trigger?` would have blessed a
  second name for `execute`; the dead branch is deleted instead.

No migration. Every added contract member is optional, so existing
implementations stay valid; the two runtime fixes only make routes that were
failing or degraded behave like their working twins.
