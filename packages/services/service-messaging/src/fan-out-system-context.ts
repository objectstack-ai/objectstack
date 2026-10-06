// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21913] The execution context the emit FAN-OUT's own reads and writes run
 * under: the explicit system opt-in.
 *
 * Carried by `MessagingService.writeEvent` (the `sys_notification` row), the
 * inbox channel's `send` (the `sys_inbox_message` row, the recipient's locale
 * read, and `writeDeliveredReceipt`'s `sys_notification_receipt` row),
 * `PreferenceResolver.loadRows` (`sys_notification_preference`) and
 * `RecipientResolver.resolveEmail` (`sys_user`).
 *
 * `emit()` takes no caller context. The door in front of an emitting caller
 * has already decided whether it may notify, and every row these calls read or
 * write belongs to a RECIPIENT, not to the emitter — so no caller's grants
 * could decide them. Without this they reach the data engine with no principal
 * and no system opt-in, which is the principal-less hand-off ADR-0096 D5
 * closes.
 *
 * ⚠️ The reads are made on another principal's behalf. What they return — a
 * user id for an address, a locale, a preference row — is consumed inside the
 * fan-out. `emit()` answers the notification id, counts and per-delivery
 * outcomes; the one read-derived value in those is a delivery's recipient id,
 * resolved from an address the emitter itself named, and no in-repo caller of
 * `emit()` relays the outcomes to a door. Keep it that way. A read under this
 * context whose result reaches the caller would widen what that caller can see.
 */
export const FAN_OUT_SYSTEM_CONTEXT = { isSystem: true } as const;
