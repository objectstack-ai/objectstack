---
"@objectstack/service-messaging": patch
---

docs(service-messaging): mark the `sys_notification_subscription` expansion not-yet-wired and align the `principal` description with the resolver (#9807)

The object header described a live routing control that does not exist: "where a
producer emits with `audience: 'subscribers'` … the resolver expands the topic's
subscriptions into recipients". Nothing implements that. `AudienceSpec`
(`messaging-service.ts`) has no `'subscribers'` member, `EmitInput.audience` is
required, and `RecipientResolver` has no branch that reads
`sys_notification_subscription` — the literal `'subscribers'` occurs exactly once
in the repo, in that sentence. Every delivery today comes from the explicit
`audience` a producer passes to `emit()`, so the Setup "Notification
Subscriptions" grid is admin-authored data, not a live routing control. The
header now says so, per the maintainer ruling on #9807 (annotate now; the
ADR-0030 Layer-3 expansion stays future work, deferred on measured zero pull).

The `principal` field description shipped a four-form list (`'role:x'` |
`'team:x'` | `'user:id'` | bare user id) narrower than what
`RecipientResolver.resolveOne()` accepts for the same string shape; it now also
names `'owner_of:object:id'` and the email form (matched against `sys_user`).
This is a user-visible string: it ships into `dist/` and into the generated `en`
translation bundle as the field's help text in the Setup grid.
