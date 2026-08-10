---
"@objectstack/service-messaging": patch
---

fix(service-messaging): close `DeliveryPayload.severity` to `'info' | 'warning' | 'critical'` (#7174)

`DeliveryPayload.severity` was declared `'info' | 'warning' | 'critical' | string`.
TypeScript absorbs a literal union member into the wider primitive it is unioned
with, so this was exactly `string` — the three names read as a closed vocabulary
but enforced nothing. `severity: 'urgent'` (or `''`) type-checked with no error,
even though the value flows into `inbox-channel.ts`'s `n.severity ?? 'info'` and
the `sys_inbox_message.severity` select column, whose options are the three
names, and even though this package's three sibling declarations of the same
concept — `MessagingService['emit']`'s `EmitInput.severity`
(`messaging-service.ts`), `MessagingChannel`'s `Notification['severity']`
(`channel.ts`), and the `inbox-message` object's `severity` select field — are
already closed to exactly this set.

Dropping the trailing `| string` makes the type mean what it says. No runtime
behaviour changes — every real producer already writes `input.severity ?? 'info'`
where `input.severity` is itself the already-closed `EmitInput.severity`, so no
in-repo construction site changes shape. This is the type-level twin of #7086
(`NotifyConfigSchema.severity`, closed in PR #7192): a construction site that
would previously narrow silently through the collapsed union now gets a
compiler refusal instead, named as a `@ts-expect-error` pin.

This is a narrowing of a publicly exported type
(`packages/services/service-messaging/src/outbox.ts`), so a consumer assigning
an out-of-vocabulary literal directly to `DeliveryPayload.severity` would newly
fail to compile — hence `patch`, following the #7140 precedent for a type-side
enforcement tightening with no runtime behaviour change.
