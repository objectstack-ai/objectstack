# @objectstack/connector-imap

The IMAP connector of ObjectStack's inbound mail: a **read-only IMAP4rev1 session** (RFC 3501) and the **mail account and credential** abstraction a mailbox sync connects through. Protocol and authentication only — what a message means (parsing, dedupe, association, the unassociated pool, auto-reply suppression) and where the folder cursor is kept belong to `@objectstack/service-mailbox`, its consumer.

It registers no `connector_action` handlers and ships no plugin: nothing in a flow calls IMAP; the mailbox service does.

**TypeScript:** use `moduleResolution` `node16`, `nodenext` or `bundler`. The legacy `node10` resolution (`"node"`) ignores `exports`, so it cannot resolve this package's subpath imports and is not supported. See [Module resolution](https://objectstack.ai/docs/plugins/development#module-resolution).

## What it provides

- **`openImapSession({ account, credentials, timeoutMs?, maxLiteralBytes?, maxCommandBytes? })`** — connects, reads the greeting, learns the server's capabilities, resolves the credential and authenticates. The session it answers:
  - `examine(folder)` opens a folder **read-only** (`EXAMINE`, never `SELECT`) and answers its `uidValidity`, `uidNext` and `exists`. A server that reports no UIDVALIDITY is refused: its UIDs could not be trusted across sessions;
  - `listMessages(fromUid)` answers the UIDs and sizes from `fromUid` up, ascending;
  - `fetchMessages(uids)` answers those messages byte for byte, with their `INTERNALDATE`, fetched with `BODY.PEEK[]` — so nothing the session does sets `\Seen` or changes the mailbox;
  - `logout()` ends the session politely; `close()` drops it.
- **`MailAccount`** — an account is an identity with its own endpoint and login (`{ id, username, imap: { host, port?, security? } }`), never a process-wide setting, so many accounts coexist.
- **`MailCredentialProvider`** — the credential is resolved per account, each time a session opens, and never stored on the account or cached by the connector. That is what lets a per-user mailbox later read a user's own stored credential and refresh an OAuth token without the connector changing. `staticCredentials(credential)` answers one fixed credential — the shared mailbox whose host supplies it at composition.
- **`ImapError`** — every failure, with a `kind`: `configuration`, `connection`, `timeout`, `authentication`, `refused`, `protocol` or `oversized`. A message never carries the credential.
- **Bounds against an untrusted server** — a line above 4 MiB, a literal above `maxLiteralBytes` (64 MiB by default), a response of more than 32 literals and more than `maxCommandBytes` of responses to one command (128 MiB by default, each response charged 256 bytes beyond its own, and the response being read charged at each literal's announcement, before its octets are read) are refused as `oversized` before the excess is kept, and the connection is closed. The silence bound (`timeoutMs`) is an inactivity bound; these are what stop a server that trickles forever.

## Authentication

| Credential | Sent as |
|:---|:---|
| `{ type: 'password', password }` | `AUTHENTICATE PLAIN` (RFC 4616) when the server offers it, otherwise `LOGIN`. A server that announces `LOGINDISABLED` and offers no `PLAIN` is refused before anything is sent. |
| `{ type: 'oauth2', accessToken }` | `AUTHENTICATE XOAUTH2`, the mechanism Gmail and Microsoft 365 accept. Obtaining and refreshing the token is the provider's job. |

`SASL-IR` is used when the server offers it. A password that quoting cannot carry is sent as a synchronizing literal.

## Transport security

`security: 'tls'` (the default) is implicit TLS from the first byte (RFC 8314, port 993), with the certificate verified against the host name. `security: 'none'` — plaintext — is accepted **only to a loopback host** (a local test server, a sidecar): to any other host the credential would cross the network unencrypted, so the session is refused before a socket opens. `STARTTLS` is not offered.

## Usage

```typescript
import { openImapSession, staticCredentials } from '@objectstack/connector-imap';

const session = await openImapSession({
  account: { id: 'sales', username: 'sales@corp.example', imap: { host: 'imap.corp.example' } },
  credentials: staticCredentials({ type: 'password', password: process.env.OS_MAILBOX_SALES_PASSWORD! }),
});
try {
  const folder = await session.examine('INBOX');
  const sizes = await session.listMessages(1);
  const messages = await session.fetchMessages(sizes.map((m) => m.uid));
  console.log(folder.uidValidity, messages.length);
} finally {
  await session.logout();
}
```

## Testing

`@objectstack/connector-imap/testing` exports **`ImapServerDouble`**, an in-process IMAP server on loopback for tests of anything that reads a mailbox. It is its own implementation of the server side — it shares no parser or encoder with the client — and it is strict where a client must be careful: a literal is accepted only after its continuation, and a body fetched with `BODY[]` under `SELECT` is marked `\Seen`, the one state change a fetch makes (RFC 3501: `BODY.PEEK[]` never sets it, and nothing changes a folder opened with `EXAMINE`). A client that keeps to `EXAMINE` and `BODY.PEEK[]` is proved read-only by the commands it sends (`server.commands`). It can also play a hostile or lying server (`hostile`, `sizeReport`) for tests of a client's bounds.

```typescript
import { ImapServerDouble } from '@objectstack/connector-imap/testing';

const server = new ImapServerDouble({ users: { user: { password: 'secret' } } });
const { host, port } = await server.listen();
server.append('INBOX', 'From: a@acme.test\r\nSubject: Hi\r\n\r\nHello\r\n');
// … connect with { host, port, security: 'none' } …
await server.close();
```
