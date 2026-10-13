// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Inbound-mail objects owned by `@objectstack/service-mailbox` (ADR-0029 D1/D2):
 * registered only where an app requires the `mailbox` capability.
 */

export { SysMailbox } from './sys-mailbox.object.js';
export { SysMailMessage } from './sys-mail-message.object.js';
export { SysMailAssociation } from './sys-mail-association.object.js';
