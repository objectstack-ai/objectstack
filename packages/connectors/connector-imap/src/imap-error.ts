// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What went wrong talking to an IMAP server.
 *
 *  - `configuration` — the account cannot be connected as given (a plaintext
 *    connection to a host that is not loopback, a mechanism the credential
 *    needs and the server does not offer). Nothing was sent.
 *  - `connection` — the socket could not be opened, or closed under a command.
 *  - `timeout` — the server went silent for longer than the session allows.
 *  - `authentication` — the server refused the credential.
 *  - `refused` — the server answered a command `NO` or `BAD`.
 *  - `protocol` — the server sent something this client cannot read, or more
 *    than it accepts (an oversized literal or line).
 */
export type ImapErrorKind = 'configuration' | 'connection' | 'timeout' | 'authentication' | 'refused' | 'protocol';

/** A failure of the IMAP connector. */
export class ImapError extends Error {
  constructor(
    readonly kind: ImapErrorKind,
    message: string,
    /** The server's own response line, when one caused it (never a credential). */
    readonly response?: string,
  ) {
    super(message);
    this.name = 'ImapError';
  }
}
