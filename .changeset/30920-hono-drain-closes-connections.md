---
'@objectstack/plugin-hono-server': patch
---

fix(plugin-hono-server): a graceful `close()` now finishes when the last in-flight request ends, not a keep-alive window later

Clause-②: no
Metadata-protocol: none

`HonoHttpServer.close()` released idle keep-alive sockets only once, at the start of the drain. A connection whose request was still running at that moment became an idle keep-alive socket after its response ended, and `close()` then waited for the client to drop it: about 3 s with `fetch` and 4 s with the `node:http` / `node:https` agent, or the server's own keep-alive timeout. During a drain, a response that has not written its headers yet now goes out with `Connection: close`, and a response that had already sent keep-alive headers closes its own connection once every byte of it has been flushed. Other connections are not touched when one response ends. The drain window still force-closes whatever outlasts it.
