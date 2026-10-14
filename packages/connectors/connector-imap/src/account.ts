// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The mail account and its credential — the abstraction every mailbox sync
 * connects through (design record on #8998, decision 4).
 *
 * It is shaped for the PER-USER mailbox from the start, although phase 1's only
 * implementor is a shared mailbox:
 *
 *  - an account is an identity with its own endpoint and login, never a
 *    process-wide setting, so many accounts (one per user, later) coexist;
 *  - its credential is resolved per account, at the moment a connection opens,
 *    through a {@link MailCredentialProvider} — never stored on the account and
 *    never cached here. A per-user provider can therefore read a user's own
 *    stored credential and refresh an OAuth access token, and the connector is
 *    not rewritten for it.
 *
 * The endpoint sits under `imap` so one account can later name its other
 * endpoints (a calendar server) beside it: the design record shares one
 * account and credential between the mail and calendar sync engines.
 */

/** How the connection to the server is protected. */
export type ImapSecurity = 'tls' | 'none';

/** The IMAP server of an account. */
export interface ImapEndpoint {
  /** Host name or IP address. */
  host: string;
  /** TCP port. Default: 993 under `tls`, 143 under `none`. */
  port?: number;
  /**
   * `tls` (the default): implicit TLS from the first byte (RFC 8314), with the
   * server certificate verified against the host name.
   *
   * `none`: a plaintext connection, accepted ONLY to a loopback host (a local
   * test server or a sidecar). The credential would cross the network in clear
   * text otherwise, so any other host is refused before a socket opens.
   */
  security?: ImapSecurity;
}

/** One mail account. */
export interface MailAccount {
  /** A stable id: the key a {@link MailCredentialProvider} resolves the credential by. */
  id: string;
  /** The login identity (often the address itself). */
  username: string;
  /** Where its mail is read from. */
  imap: ImapEndpoint;
}

/**
 * A credential, as the server is handed it.
 *
 *  - `password` — `AUTHENTICATE PLAIN` (RFC 4616) when the server offers it,
 *    otherwise `LOGIN` (RFC 3501 §6.2.3);
 *  - `oauth2` — an OAuth 2.0 bearer access token, sent with
 *    `AUTHENTICATE XOAUTH2` (the mechanism Gmail and Microsoft 365 accept).
 *    Obtaining and refreshing the token is the provider's job, not the
 *    connector's.
 */
export type MailCredential =
  | { type: 'password'; password: string }
  | { type: 'oauth2'; accessToken: string };

/** Resolves an account's credential when a connection opens. */
export interface MailCredentialProvider {
  credentialFor(account: MailAccount): Promise<MailCredential>;
}

/**
 * A provider that answers the same credential for every account it is asked
 * about — a shared mailbox whose host hands its credential over at
 * composition, the way every other open connector takes a static credential.
 */
export function staticCredentials(credential: MailCredential): MailCredentialProvider {
  const held: MailCredential = { ...credential };
  return { credentialFor: async () => held };
}
