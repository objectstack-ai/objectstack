// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two inputs of a request signature that are not the request or the key:
 * the instant and the single-use nonce. Injected so a vendor's worked example
 * can be reproduced byte for byte; a production signer takes the defaults (the
 * wall clock, and random bytes from `node:crypto`).
 */
export interface RequestSigningClock {
    readonly now?: () => Date;
    readonly nonce?: () => string;
}
