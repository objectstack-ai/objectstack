---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a session stores its client address in RFC 5952 text, and is born with `last_activity_at`

Clause-②: yes (widening)
Metadata-protocol: none

Setup › Sessions printed a localhost session's IP as `0000:0000:0000:0000:0000:0000:0000:0000` and left Last Activity empty until the session's first request. Both are fixed in the data a sign-in stores; the list still prints the columns as plain text.

- **The address is the client's, in RFC 5952 text.** `sys_session.ip_address` is now the address the server established for the request (the client-address trust rule: forwarded headers only under `server.trustProxy`, the connection's peer otherwise), with IPv6 compressed — `::1`, `2001:db8::1` — and IPv4 unchanged. better-auth's own reader used to fill the column with its rate-limit bucket instead: every IPv6 address expanded to eight groups and masked to its /64 network, so `::1` read as `0000:…:0000` and `2001:db8::1` as `2001:0db8:0000:0000:0000:0000:0000:0000`. An IPv4-mapped address is stored as the IPv4 address it maps (`::ffff:203.0.113.7` → `203.0.113.7`), so an IPv4 client reads the same whether a dual-stack or an IPv4 listener accepted it; `last_login_ip` and the refused-sign-in audit rows, which carried the mapped text, now carry that one too. A session minted with no established address (a programmatic `auth.api.*` call) keeps better-auth's value, in the same text. An unparseable value is stored as it came.
- **One text on every row of a sign-in.** The `login_failed` / `account_locked` audit rows and `sys_user.last_login_ip` carry the same text as the session row and its `login` row. `signInClientFingerprint(ctx, establishedAddress?)` takes the established address as an optional second argument.
- **`last_activity_at` is written at creation**, equal to `created_at`. The activity heartbeat is unchanged; its first write now comes on the first request more than a minute after sign-in rather than on the very first request.
- **Unchanged:** better-auth's per-address rate limiter still keys on its own bucket, the ADR-0069 D5 allow-list still judges the trust rule's answer as it came, and existing session rows are not rewritten.
