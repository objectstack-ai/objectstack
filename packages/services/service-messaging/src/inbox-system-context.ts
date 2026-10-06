// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21908] The execution context the inbox's own read-state calls run under:
 * the explicit system opt-in, taken INSIDE this service (maintainer ruling Q1).
 *
 * Carried by `MessagingService.listInbox` (the `sys_inbox_message` window and
 * `countUnreadTotal`'s total), `readReceiptStates`
 * (`sys_notification_receipt`), and mark-read / mark-all-read:
 * `unreadNotificationIds`, `upsertReadReceipt` (its read, its update and its
 * insert) and `notificationOrganization`.
 *
 * Before this, each of those calls reached the data engine with no context at
 * all — no principal and no opt-in — and passed the security middleware only
 * through its principal-less hand-off (ADR-0096 E1), which D5 closes. Carrying
 * the caller's principal instead is not open: `member_default` grants a member
 * READ ONLY on `sys_inbox_message` / `sys_notification_receipt` (the inbox
 * channel is their writer), so mark-read would break.
 *
 * ## The boundary is this service's own user scope
 *
 * RLS does not read these calls, and it did not read them before either. What
 * keeps them to the caller's own rows is the user id the REST door derives
 * from the authenticated session (`runtime/src/domains/notifications.ts`), or
 * that `*AsCaller` derives from the caller's execution context:
 *
 *  - every read of the user's rows is keyed `where: { user_id }`;
 *  - the receipt it inserts is stamped with that `user_id`;
 *  - the receipt it updates is addressed by the id that a `user_id`-keyed read
 *    of the SAME call returned, and by nothing else;
 *  - `notificationOrganization` reads one `sys_notification` EVENT row (which
 *    names no recipient) by id, projecting `id` and `organization_id`, and its
 *    only use is the organization stamp on the caller's own receipt.
 *
 * ⛔ Never let a call under this context drop the `user_id` term or address a
 * row a `user_id`-keyed read did not return: here that term IS the isolation.
 */
export const INBOX_SYSTEM_CONTEXT = { isSystem: true } as const;
