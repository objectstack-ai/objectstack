---
"@objectstack/plugin-hono-server": patch
"@objectstack/plugin-auth": patch
"@objectstack/hono": patch
"@objectstack/trigger-api": patch
"@objectstack/plugin-webhooks": patch
"@objectstack/plugin-approvals": patch
"@objectstack/client": patch
---

fix(deps)!: hono moves to ^4.13.16 and @hono/node-server to ^2.1.6, the releases that fix seven public advisories; a request path holding a backslash is answered 400

Clause-②: yes (narrowing) — `@hono/node-server` 2.1.6 answers `400 Bad Request` to a request whose path (the part before `?`) holds a backslash, before any route runs. Up to 2.1.5 the backslash was rewritten to `/` and the request reached the route that path names. A backslash after `?` is query data and answers as before. One more edge moves in the same transport: a streamed response whose body stream errors within its first two reads used to be sent as a truncated `200`, and is now a `500` (`text/plain`) with the socket closed. Of ours, only a raw stream passthrough (the AI and MCP stream results) can meet it; the SSE path and the adapter's stream writer never error their stream. No other status, header, body or error text of ours moves; the request-body limit (`413 PAYLOAD_TOO_LARGE`) answers as before.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` and no page under `content/docs/**` teaches request-path spelling at the HTTP door; the moved answer is the transport refusing a malformed request line.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value, metadata type, stored row or export is added, removed, renamed or re-shaped. What moves is the Node transport refusing a request line whose path holds a backslash, so there is nothing for an author or an operator to migrate. -->

**BREAKING** for a client that sends a backslash inside a URL path, such as `GET /api/v1/data\account`: the Node server now answers `400 Bad Request` where it used to route the request as `/api/v1/data/account`. Browsers and WHATWG-URL clients (`fetch`, undici) already turn a backslash into `/` before sending; other clients, `curl` among them, send it as written and meet this. Send the path with `/`.

The fixed advisories: `hono` GHSA-3gg2-335m-rxc6, GHSA-46wx-v44x-9hh2, GHSA-4h7h-rv7c-7m2v, GHSA-4m76-xfj5-7975 and GHSA-h7mg-cq63-vhpq (fixed in 4.13.16); `@hono/node-server` GHSA-jpvv-r467-5p4w and GHSA-qv5m-9pm6-hqp3 (fixed in 2.1.6). The declared ranges move so that a downstream install, which never sees this workspace's overrides, lands on the fixed releases too. The `@objectstack/hono` peer range on `hono` stays `^4.12.8`.
