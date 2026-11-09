---
'@objectstack/plugin-hono-server': patch
---

fix(plugin-hono-server): a graceful `close()` no longer cuts off a response that has ended but is still being sent to a slow client

Clause-②: no
Metadata-protocol: none

When `HonoHttpServer.close()` started, Node's own `server.close()` released idle keep-alive connections first thing, and counted a response as done as soon as it had called `end()`, before its bytes were sent. A large response still flushing to a slow client at that moment was destroyed mid-body, so the client got a truncated download. The release of idle connections now waits until no ended response is still flushing; each such response closes its own connection once every byte has been sent, and idle connections are released right after. The drain window still force-closes whatever outlasts it.
