---
"@objectstack/service-messaging": minor
---

**Feature:** `MessagingService` gains a plugin-facing inbox write door scoped to the **authenticated caller** — `markReadAsCaller(caller, ids)` and `markAllReadAsCaller(caller)` (#10753).

A plugin that pushes an "…awaiting your approval" message through `emit()` had no legitimate way to close it out again once the work was done, so the Console bell's unread badge stayed lit through a full page reload until the user hit "mark all read". The reporting project carries 30+ business hooks in that shape.

What it was reaching for instead is the shape this closes. `markRead(userId, ids)` is the REST door's contract method (`INotificationService.markRead?`), and on that path its `userId` is trustworthy because `runtime/src/domains/notifications.ts` binds it to an already-authenticated session and answers 401 when there is none. But the service is also a kernel service, and the kernel hands every plugin ONE shared `PluginContext` whose `getService` carries no caller identity — so for an in-process caller that same parameter is a free string. **Any plugin could mark any user's inbox messages read**, and the receipt lands context-lessly on an `engine-owned` object (ADR-0103), so no engine permission check saw it either. This release is therefore both an API widening and the first tightening of in-process power on that path.

The new pair takes **no target user at all**. The recipient is derived from the caller's `ExecutionContext.userId`, so "mark someone else's inbox read" has no spelling on this surface — it is unrepresentable rather than discouraged. That fits the case it was asked for exactly: the approver who clears a request *is* the recipient whose badge is stuck.

`userId` is read, and nothing that merely resembles one:

- `attributedUserId` is **attribution only** — its own contract states that nothing in the authorization path reads it, and a context carrying only it authorizes as anonymous (ADR-0118 D2). A `userId ?? attributedUserId` fallback would read as working and clear the wrong person's badge.
- `actor` is a service-principal label (`svc:<name>`), not a `sys_user` id.
- `isSystem: true` with no user is refused rather than elevated: the system has no inbox to be the recipient of.

Each refusal throws `InboxCallerError` carrying the ADR-0112 envelope pair a boundary reads — `status: 401` and the registered `code: 'UNAUTHENTICATED'` — and the refusal is evaluated **before** the empty-`ids` and no-data-engine short-circuits, which return `{ success: true, readCount: 0 }`. Reaching one of those with no authenticated caller would report success for a write that was never authorized, which is the silent-success shape this door exists to replace.

Honest about what it is: a **discipline** boundary, not a security boundary. An in-process plugin already holds the data engine and can write `sys_notification_receipt` directly; nothing at this layer stops trusted code that means to. What changes is that the correct pattern is the only one the plugin-facing surface expresses, and the incorrect one now fails loudly at the call site.

Nothing existing changes behaviour: `markRead` / `markAllRead` / `listInbox` keep their signatures (they are the published `INotificationService` contract the REST door needs), and no schema, column or object declaration moves.
