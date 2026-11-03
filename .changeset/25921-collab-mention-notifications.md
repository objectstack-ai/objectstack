---
'@object-ui/collaboration': patch
'@object-ui/types': patch
---

refactor(collaboration, types)!: retire the zero-consumer `useMentionNotifications` hook and the `MentionNotification` interface

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/collaboration#useMentionNotifications, @object-ui/collaboration#MentionNotificationsConfig, @object-ui/collaboration#MentionNotificationsResult, @object-ui/types#MentionNotification) the retired operands are a React hook that kept an in-memory list of mention notifications, its two TypeScript config and result interfaces, and the `MentionNotification` interface of `@object-ui/types` that only the hook read; nothing in the workspace or in hotcrm imports any of them (the console bell reads the server inbox through `useInboxBell`), and no packages/spec schema, registered node type, conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports `useMentionNotifications`, `MentionNotificationsConfig` or `MentionNotificationsResult` from `@object-ui/collaboration`, or the type `MentionNotification` from `@object-ui/types`. The hook held a client-side list of mention notifications with read flags; no console surface used it, because mention notifications are server records (`sys_notification`, topic `collab.mention`) that the console bell reads from the inbox feed. `CommentEntry` and `ActivityEntry` stay exported unchanged. The `CommentSearchResult` entry of this release said `MentionNotification` stays exported; it leaves here.

- FROM `useMentionNotifications` TO a local hook in your own code, or read the server inbox (`GET /api/v1/notifications`) as the console bell does.
- FROM `MentionNotificationsConfig` TO a local interface in your own code: `{ currentUserId: string; initialNotifications?: MentionNotification[]; onDeliver?: (notification: MentionNotification) => void | Promise<void> }`.
- FROM `MentionNotificationsResult` TO a local interface in your own code, typed by what your own hook returns.
- FROM `MentionNotification` TO a local interface in your own code: `{ id: string; type: 'mention'; recipientId: string; commentId: string | number; mentionedBy: string; commentText: string; objectName?: string; recordId?: string; createdAt: string; read?: boolean; channels?: Array<'in_app' | 'email' | 'push'> }`.
